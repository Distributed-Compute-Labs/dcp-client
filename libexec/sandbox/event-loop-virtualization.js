/**
 *  @file       event-loop-virtualization.js
 *              
 *  File that takes control of our regular evaluator event loops.
 *  This gives DCP introspection capability to see how long a job
 *  should take, and how we can pay DCCs accordingly.
 * 
 *  All evaluators have their own implementation of the event loop at this
 *  point, with corresponding timeout functions for their loop. This file will
 *  create a wrapper for each of the timeouts, with a virtual event loop
 *  to control code execution. 
 *
 *              Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       January 2022
 * 
 */
/* globals self */

self.wrapScriptLoading({ scriptName: 'event-loop-virtualization' }, function eventLoopVirtualization$$fn(protectedStorage, ring0PostMessage)
{
  (function privateScope(realSetTimeout, realSetInterval, realSetImmediate, realClearTimeout, realClearInterval, realClearImmediate, realQueueMicrotask, protectedStorage)
  {
    /** @typedef {import("./timer-classes.js").TimeThing} TimeThing */
    const TimeThing = protectedStorage.TimeThing;
    /** @typedef {import("./timer-classes.js").TimeInterval} TimeInterval */
    const TimeInterval = protectedStorage.TimeInterval;


    // TODO: hide this better
    // TODO: perhaps we should grab it not via gloablThis
    // stash a copy so we don't end up recursively calling with no base case
    /** @todo optional chaining used here to get around the issue of old platforms having such symbols defined, think of a cleaner way */
    const realSubmit = globalThis.GPUQueue?.prototype?.submit;
    const realOnSubmittedWorkDone = globalThis.GPUQueue?.prototype?.onSubmittedWorkDone;

    /**
     *
     * @class GPUQueueRegistery
     */
    class WebGPUQueueRegistery
    {
      /**
       * @constructor
       * @param {TimeThing} webGPUIntervals
       * @returns {GPUQueueRegistery}
       */
      constructor(webGPUIntervals)
      {
        /** @type Array<GPUQueue> */
        this.queues = [];

        /** @type TimeThing */
        this.webGPUIntervals = webGPUIntervals;

        // slaps roof, this thing can act as so many different concurrency primitives
        /** @type Array<EventTarget> */
        this.eventTargets = [];
      }

      /**
       * Add a queue to the registry, returns the newly registered queue.
       * @param {GPUQueue} queue
       * @returns {GPUQueue}
       */
      add(queue)
      {
        this.queues.push(queue);

        const eventTarget = new EventTarget();
        eventTarget.addEventListener('submission', this.#recordCommandDuration);
        this.eventTargets.push(eventTarget);

        return queue;
      }

      async #recordCommandDuration(customEvent)
      {
        const {submittedAt, gpuQueue, timeIntervals} = customEvent.detail;
        // Since the standard guarantees this promise resolves in FIFO in line with submit, and we always queue up this
        // promise immediately after someone submits, we are guaranteed to resolve to the promise corresponding to the
        // commands they just submitted.
        // When the user calls `onSubmittedWorkDone` from their work function, our promise will have already been
        // resolved and theirs just resolves as soon as the event loop is free, they don't know anything had happened.
        await realOnSubmittedWorkDone.call(gpuQueue);

        const completedAt = performance.now();
        const duration = new TimeInterval();
        duration.overrideInterval(submittedAt, completedAt);

        timeIntervals.push(duration);
      }

      /**
       * Add a submission to the registry.
       *
       * @param {GPUQueue} queue the Queue you wish to submit to
       * @param {GPUCommandBuffer[]} commandBuffers the command buffers you wish to submit
       * @returns {undefined}
       */
      addSubmission(queue, commandBuffers)
      {
        // we assume the queue is always already in the registry, should be enforced by changing all the
        // places where a queue can be created to use the registry
        const idx = this.queues.indexOf(queue);
        const eventTarget = this.eventTargets.at(idx);

        const submittedAt = performance.now();
        // actually submit on the underlying queue
        realSubmit.call(queue, commandBuffers);

        // queues up a promise that calls `onSubmittedWorkDone` on the promise and record how long the command took
        eventTarget.dispatchEvent(new CustomEvent('submission', {
          detail: {
            submittedAt: submittedAt,
            gpuQueue: queue,
            timeIntervals: this.webGPUIntervals,
          }
        }));
      }

      /** 
       * *Immediately* removes the queue from metric tracking, it's *your* responsibility to ensure that there won't be
       * any new commands submitted.
       */
      unsafePopQueue(queue)
      {
        const idx = this.queues.indexOf(queue);
        /** @todo most likely a bug, consider logging */
        if (idx === -1)
          return;

        // remove the listener and drop all references to the `EventTarget`, GC will clean it up
        eventTarget.removeEventListener('submission', this.#recordCommandDuration);
        this.queues.splice(idx);
        this.eventTargets.splice(idx);

        /** @todo it's really not great, we are calling reset() in both places, and they only don't crap themselves
         * because of the careful ordering, definitely need a better design
         */
        /** @todo do we event want this????? */
        // this.webGPUIntervals.reset();
      }

      async waitAllCommandToFinish()
      {
        return await Promise.allSettled(this.queues.map((q) => q.onSubmittedWorkDone()));
      }

      reset()
      {
        // why are we making a copy? Because popQueue modifies the queue and if you just do a naive raw loop you end
        // up with modification during iteration
        const queues = [...this.queues];

        for (const queue in queues)
          this.unsafePopQueue(queue);
      }
    }

    /** @todo optional chaining used here to get around the issue of old platforms having such symbols defined, think of a cleaner way */
    const realGPUDeviceDestory = globalThis.GPUDevice?.prototype?.detroy;

    /**
     * @class GlobalTrackers
     * @property {WebGPUPromiseRegistry} webGPUPromiseRegistry
     * @property {WebGPUQueueRegistery} webGPUQueueRegistery
     * @property {TimeThing} webGPUIntervals
     * @property {TimeThing} cpuIntervals
     * @property {TimeThing} webGLIntervals
     * @property {TimeThing} wasmIntervals
     * @function {getMetrics}
     */
    class GlobalTrackers
    {

      /**
       * @constructor
       * @returns {GlobalTrackers}
       */
      constructor()
      {
        /** @type {TimeThing} */
        this.webGPUIntervals = new TimeThing();
        
        /** @type {TimeThing} */
        this.cpuIntervals = new TimeThing();

        // TODO: actually make them record stuff
        /** @type {TimeThing} */
        this.webGLIntervals = new TimeThing();

        /** @type {TimeThing} */
        this.wasmIntervals = new TimeThing();

        // TODO: decouple this
        this.webGPUQueueRegistery = new WebGPUQueueRegistery(this.webGPUIntervals);

        /** @type {Array<GPUDevice>} */
        // Why is this a list?
        // Because you can get more than one devices by requesting with different adapter options
        // 
        // Why do we need to keep track of it?
        // So we can call `destroy` on it when we wish to reset our tracking state 
        this.gpuDevices = [];
      }

      /**
       * Reset the all the tracked time intervals. Unfinished intervals are simply dropped without a concern why they
       * were not finished
       *
       * SAFETY:
       * You must only call this *after* the work function has completed, because this will invalidate all gpu resources.
       * @function {reset}
       */
      async reset()
      {
        // remove them first before clearing the commands
        /** @todo this is safe when webGPU symbols are not defined, only because the queue will be empty, yuck! */
        for (const device of this.gpuDevices)
          realGPUDeviceDestory.call(device);
        this.gpuDevices = [];

        /** @todo not true anymore if we go with the new design, consider removing the comments */
        // very important that this is called before resetting the intervals themselves since the registry hold
        // references to the intervals below
        this.webGPUQueueRegistery.reset();

        // it's *very* important that we delegate the work of resetting to the intervals rather than just assigning each
        // of them with new instances. These `TimeThing`s are being shared to different modules, if we just re-assign,
        // they all end up with stales copies and the entire state becomes corrupted
        /** @todo it is probably a design smell such that we have this pit of subtle bug to easily fall into */
        this.webGPUIntervals.reset();
        this.cpuIntervals.reset();
        this.webGLIntervals.reset();
        this.wasmIntervals.reset();
      }

      // TODO: specifiy down the return type
      /**
       * Obtain the current metrics of our tracked resources, mostly about timings.
       * @async
       * @function {getMetrics}
       */
      async getMetrics()
      {
        // remove them first before clearing the commands
        for (const device of this.gpuDevices)
          realGPUDeviceDestory.call(device);

        // flush all commands that were already enqueued
        await this.webGPUQueueRegistery.waitAllCommandToFinish();

        // TODO: Ryan said CPU should also include the WASM time
        const webGPUTime = this.webGPUIntervals.duration();
        const webGLTime = this.webGLIntervals.duration();
        const wasmTime = this.wasmIntervals.duration();
        const cpuTime = this.cpuIntervals.duration() + wasmTime;

        /** @todo total time is defined as the wall time, not the sum of "user times" */
        const totalTime = webGPUTime + cpuTime + webGLTime;

        return {
          total: totalTime,
          webGPU: webGPUTime,
          CPU: cpuTime,
          webGL: webGLTime,
        };
      }
    }

    protectedStorage.bigBrother = {
      ...protectedStorage.bigBrother,
      globalTrackers: new GlobalTrackers()
    };

    // TODO: hide this for the final few layers that should not be allowed to see it
    // TODO: create a nice intereface so we're not just pulling the guts out all the time
    const cpuTimer = protectedStorage.bigBrother.globalTrackers.cpuIntervals;
    let timersLocked = false;

    protectedStorage.lockTimers = function lockTimers() { timersLocked = true; }
    protectedStorage.unlockTimers = function unlockTimers() { timersLocked = false; }


    /** @todo think about a place to cancel all of them once the work function is finished */


    /** Execute callback after at least timeout ms. 
     * 
     *  @todo update doc
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    timeout           {int} integer containing the minimum time to fire callback in ms
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the timeoutId parameter of clearTimeout()
     */
    self.setTimeout = function eventLoop$$Worker$setTimeout(callback, timeout, ...arg)
    {
      // Work function has resolved, Don't let client init any new timeouts.
      if (timersLocked)
      {
        protectedStorage.console.warn("timeout request after the event loop is locked");
        return {};
      }

      callback = (() => {
        if (typeof callback === 'string')
        {
          const indirectEval = eval;
          return () => indirectEval(callback);
        }
        else
        {
          return callback;
        }
      })();

      /** @todo think about the stupid `this`  */
      const timedCallback = () => {
        const duration = new TimeInterval();
        const ret = callback(...arg);
        duration.stop();
        cpuTimer.push(duration);
        return ret;
      };

      return realSetTimeout(timedCallback, timeout);
    }

    /** Ensure our trampoline setTimeout in bravojs-env will have the proper setTimeout, don't allow clients to see or overwrite to prevent measuring time */
    protectedStorage.setTimeout = setTimeout;

    /** Execute callback after at least interval ms, regularly, at least interval ms apart.
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    timeout           {int} integer containing the minimum time to fire callback in ms
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the intervalId paramter of clearInterval()
     */
    self.setInterval = function eventLoop$$Worker$setInterval(callback, interval, ...arg)
    {
      // Work function has resolved, Don't let client init any new timeouts.
      if (timersLocked)
      {
        protectedStorage.console.warn("timeout request after the event loop is locked");
        return {};
      }

      callback = (() => {
        if (typeof callback === 'string')
        {
          const indirectEval = eval;
          return () => indirectEval(callback);
        }
        else
        {
          return callback;
        }
      })();

      /** @todo think about the stupid `this`  */
      const timedCallback = () => {
        const duration = new TimeInterval();
        const ret = callback(...arg);
        duration.stop();
        cpuTimer.push(duration);
        return ret;
      };

      return realSetInterval(timedCallback, interval);
    }
    /** Execute callback after 0 ms, immediately when the event loop allows.
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the intervalId paramter of clearImmediate()
     */
    self.setImmediate = function eventLoop$$Worker$setImmediate(callback, ...arg)
    {

      // Work function has resolved, Don't let client init any new timeouts.
      if (timersLocked)
      {
        protectedStorage.console.warn("timeout request after the event loop is locked");
        return {};
      }

      callback = (() => {
        if (typeof callback === 'string')
        {
          const indirectEval = eval;
          return () => indirectEval(callback);
        }
        else
        {
          return callback;
        }
      })();

      /** @todo think about the stupid `this`  */
      const timedCallback = () => {
        const duration = new TimeInterval();
        const ret = callback(...arg);
        duration.stop();
        cpuTimer.push(duration);
        return ret;
      };

      return realSetImmediate(timedCallback);
    }

    /** queues a microtask to be executed at a safe time prior to control returning to the event loop
     * 
     *  @param    callback          {function} Callback function to fire
     */
    self.queueMicrotask = function eventLoop$$Worker$queueMicrotask(callback)
    {
      const timedCallback = () => {
        const duration = new TimeInterval();
        const ret = callback();
        duration.stop();
        cpuTimer.push(duration);
        return ret;
      };

      return realQueueMicrotask(timedCallback);
    }

    // TODO: yes the name is very stupid
    protectedStorage.bonaFideSetTimeout = realSetTimeout;
    protectedStorage.timedQueueMicrotask = queueMicrotask;
  })(self.setTimeout, self.setInterval, self.setImmediate, self.clearTimeout, self.clearInterval, self.clearImmediate, self.queueMicrotask, protectedStorage);
});
