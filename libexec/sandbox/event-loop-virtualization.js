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
 *
 *  How does this guarantee the timing is correct?
 *
 *  After the first run of the work function. More javascripts can be run with only two kinds of events. A macro task
 *  becomes ready or the stack is empty and a micro task is put onto the stack. If we time each function that executes
 *  on the macro task and micro task queue, then we will know how much CPU resource they utilized. 
 *
 *  Timing macrotasks are easy, within the environment of web workers, the only macro tasks that occur are setTimeout
 *  and their friends, we simply make every function time itself.
 *
 *  Timing microtasks would also be easy with one exception. A microtask is created via call to the Promise constructor,
 *  which we can just time that. A promise's that depend on the completion of another promise is either crated with the
 *  call to the promise constructor---which we time, or via `then`. The callback of `then` is effectively what will get
 *  put onto the stack when empty, this is guaranteed by the fact that promise crated `then` will be run asynchronously
 *  even if the previous promise is already resolved when called. If we timed that, we will have tracked all CPU resource
 *  usage.
 *
 *  `async` (not `await`, `await` is fine) presents a challenge, although you can await any thennable. The promise crated
 *  via the async keyword will always be the native `Promise` class even if you erase `Promise` from `globalThis`. This 
 *  could be solved via running babel on all work functions and convert them into using Promise and then instead of `async`.
 *  This could be considered in the future but a more brute force strategy is used right now. We simply take the wall time
 *  measurement, and put anything we can't explain into the CPU time.
 *
 *  Since no IO is allowed in work function as of May 2023, the only source of this error is Timeouts have no CPU workloads
 *  at the same time, causing the JS thread to wait. Which means the error should be small. Once the IO is allowed, as long
 *  as IO are tracked well, the error should remain small.
 *
 *              Ryan Saweczko, ryansaweczko@kingsds.network
 *              Liang Wang, liang@distributive.network
 *  @date       May 2023
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


    // stash a copy so we don't end up recursively calling with no base case
    // optional chaining used here to get around the issue of old platforms having such symbols defined, the end effect
    // is all the operations performed on them become no-ops
    const realSubmit = globalThis.GPUQueue?.prototype?.submit;
    const realOnSubmittedWorkDone = globalThis.GPUQueue?.prototype?.onSubmittedWorkDone;
    const realGPUDeviceDestory = globalThis.GPUDevice?.prototype?.destroy;
    /**
     * @class WebGPUQueueRegistry
     * @property {Array<GPUQueue>} queues - list of all tracked instances of `GPUQueue`
     * @property {TimeThing} webGPUIntervals - collection of time slice for time spent on GPU
     * @property {Array<EventTarget>} eventTargets - list of the event targets used to book keep the usage of GPU
     * @function add
     * @function addSubmission
     * @function unsafePopQueue
     * @function waitAllCommandToFinish
     * @function reset
     *
     * Each elem of queues with index `i` should have its corresponding EventTarget at eventTargets[i]. Entity component
     * system style.
     */
    class WebGPUQueueRegistry
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

        // Lock to prevent webGPU work from occurring after the work function promise resolves
        this.locked = false;
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
        if (this.locked)
          throw new Error('Attempted to submit webGPU queue after work function resolved');
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
       * any new commands submitted. It will *not* reset the webGPU time duration lists! It simply removes the `queue` 
       * from tracking.
       */
      unsafePopQueue(queue)
      {
        const idx = this.queues.indexOf(queue);
        if (idx === -1)
          return;

        // remove the listener and drop all references to the `EventTarget`, GC will clean it up
        eventTarget.removeEventListener('submission', this.#recordCommandDuration);
        this.queues.splice(idx);
        this.eventTargets.splice(idx);
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

      lock()
      {
        this.locked = true;
      }

      unlock()
      {
        this.locked = false;
      }
    }


    /**
     * @class GlobalTrackers
     * @property {WebGPUQueueRegistry} webGPUQueueRegistry
     * @property {TimeThing} webGPUIntervals
     * @property {TimeThing} cpuIntervals
     * @property {TimeThing} webGLIntervals
     * @function getMetrics
     * @function reset
     * @function resetRecordedTime
     */
    class GlobalTrackers
    {

      /**
       * @constructor
       * @returns {GlobalTrackers}
       */
      constructor()
      {
        this.webGPUIntervals = new TimeThing();
        this.cpuIntervals    = new TimeThing();
        this.webGLIntervals  = new TimeThing();
        this.webGPUQueueRegistry = new WebGPUQueueRegistry(this.webGPUIntervals);

        /** @type {Array<GPUDevice>} */
        // Why is this a list?
        // Because you can get more than one devices by requesting with different adapter options
        // 
        // Why do we need to keep track of it?
        // So we can call `destroy` on it when we wish to reset our tracking state 
        this.gpuDevices = [];
      }

      /**
       * Reset all the tracked time intervals. Unfinished intervals are simply dropped without a concern why they
       * were not finished
       *
       * SAFETY:
       * You must only call this *after* the work function has completed, because this will invalidate all gpu resources.
       * @async
       * @function reset
       */
      async reset()
      {
        // remove them first before clearing the commands
        // this is safe when webGPU symbols are not defined, because the queue will be empty, so the body is never
        // called, hence it's safe
        for (const device of this.gpuDevices)
          realGPUDeviceDestory.call(device);
        this.gpuDevices = [];

        // very important that this is called before resetting the intervals themselves since the registry hold
        // references to the intervals below
        this.webGPUQueueRegistry.reset();

        // it's *very* important that we delegate the work of resetting to the intervals rather than just assigning each
        // of them with new instances. These `TimeThing`s are being shared to different modules, if we just re-assign,
        // they all end up with stales copies and the entire state becomes corrupted
        /** @todo it is probably a design smell such that we have this pit of subtle bug to easily fall into */
        this.webGPUIntervals.reset();
        this.cpuIntervals.reset();
        this.webGLIntervals.reset();
      }


      /**
       * Only reset the recorded time intervals but do not remove any recources from tracking. This function pretty much
       * only exists for resetting the time used for feature detection. Try not to abuse it, it's not a good API.
       * @function resetRecordedTime
       */
      resetRecordedTime()
      {
        this.webGPUIntervals.reset();
        this.cpuIntervals.reset();
        this.webGLIntervals.reset();
      }

      /** @typedef {Object} ResourceUsageMetric 
       *  @property {number} webGPU - time spent in both device and queue timeline
       *  @property {number} CPU - time spent in "user time" of the CPU
       *  @property {number} webGL - time spent in webGL logic
       */

      /**
       * Obtain the current metrics of our tracked resources, mostly about timings.
       * @async
       * @function getMetrics
       * @returns {ResourceUsageMetric}
       */
      async getMetrics()
      {
        // remove them first before clearing the commands
        for (const device of this.gpuDevices)
          realGPUDeviceDestory.call(device);

        // flush all commands that were already enqueued
        await this.webGPUQueueRegistry.waitAllCommandToFinish();

        const webGPUTime = this.webGPUIntervals.duration();
        const webGLTime = this.webGLIntervals.duration();
        const cpuTime = this.cpuIntervals.duration();

        return {
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

    const cpuTimer = protectedStorage.bigBrother.globalTrackers.cpuIntervals;
    const events = [];
    events.serial = 0;
    let timersLocked = false;

    protectedStorage.realSetTimeout = realSetTimeout;
    protectedStorage.lockTimers = function lockTimers() { timersLocked = true; }
    protectedStorage.unlockTimers = function unlockTimers() { timersLocked = false; }

    function sortEvents() {
      events.sort(function (a, b) { return a.when - b.when; });
    }

    /*
     * Assumption: serviceEvents must only be triggered if there is an event waiting to
     * be run. If there are no pending events (or the last one is removed), the trigger 
     * to call serviceEvents next should be removed.
    */
    function serviceEvents()
    {
      serviceEvents.timeout = null;
      serviceEvents.nextTimeout = null;
      serviceEvents.servicing = true;
      serviceEvents.sliceIsFinished = false;

      serviceEvents.interval = new protectedStorage.TimeInterval();
      cpuTimer.push(serviceEvents.interval);

      sortEvents();
      const event = events.shift();
      if (event.eventType === 'timer')
      {
        serviceEvents.executingTimeout = realSetTimeout(event.fn, 0, event.args);
        if (event.recur)
        {
          event.when = Date.now() + event.recur;
          events.push(event);
          sortEvents();
        }
      }
      // Can add handles for events to the event loop as needed (ie messages)

      // Measure the time on the event loop after everything has executed
      serviceEvents.measurerTimeout = realSetTimeout(endOfRealEventCycle,1);
      function endOfRealEventCycle()
      {
        serviceEvents.servicing = false;
        serviceEvents.interval.stop();

        if (!serviceEvents.sliceIsFinished && events.length)
        {
          serviceEvents.nextTimeout = events[0].when
          serviceEvents.timeout = realSetTimeout(serviceEvents, events[0].when - Date.now());
        }
      }
    }

    /** Execute callback after at least timeout ms. 
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    timeout           {int} integer containing the minimum time to fire callback in ms
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the timeoutId parameter of clearTimeout()
     */
    setTimeout = function eventLoop$$Worker$setTimeout(callback, timeout, arg) {
      // Work function has resolved, Don't let client init any new timeouts.
      if (timersLocked)
        return {};

      timeout = timeout || 0;
      let timer, args;
      if (typeof callback === 'string')
      {
        let code = callback;
        callback = function eventLoop$$Worker$setTimeout$wrapper() {
          let indirectEval = eval;
          return indirectEval(code);
        }
      }

      // if user supplies arguments, apply them to the callback function
      if (arg)
      {
        args = Array.prototype.slice.call(arguments); // get a plain array from function arguments
        args = args.slice(2);                         // slice the first two elements (callback & timeout), leaving an array of user arguments
        let fn = callback;
        callback = () => fn.apply(fn, args);          // apply the arguments to the callback function
      }

      events.serial = +events.serial + 1;
      timer = {
        eventType: 'timer',
        fn: callback,
        when: Date.now() + (+timeout || 0),
        serial: events.serial,
        valueOf: function () { return this.serial; }
      }
      events.push(timer);
      sortEvents();
      if (!serviceEvents.servicing)
      {
        if (!serviceEvents.nextTimeout)
        {
          realSetTimeout(serviceEvents, events[0].when - Date.now());
        }
        else
        {
          if (serviceEvents.nextTimeout > events[0].when)
          {
            realClearTimeout(serviceEvents.timeout);
            realSetTimeout(serviceEvents, events[0].when - Date.now())
          }
        }
      }
      return timer;
    }

    /** Ensure our trampoline setTimeout in bravojs-env will have the proper setTimeout, don't allow clients to see or overwrite to prevent measuring time */
    protectedStorage.setTimeout = setTimeout;

    /** Remove a timeout from the list of pending timeouts, regardless of its current
     *  status.
     * 
     *  @param    timeoutId         {object} The value, returned from setTimeout(), identifying the timer.
     */
    clearTimeout = function eventLoop$$Worker$clearTimeout(timeoutId)
    {
      function checkService()
      {
        if (!serviceEvents.servicing)
        {
          if (events.length)
          {
            realClearTimeout(serviceEvents.timeout);
            realSetTimeout(serviceEvents, events[0].when - Date.now())
          }
          else
            realClearTimeout(serviceEvents.timeout);
        }
      }
      if (typeof timeoutId === "object")
      {
        let i = events.indexOf(timeoutId);
        if (i !== -1)
          events.splice(i, 1);
        if (i === 0)
          checkService()
      }
      else if (typeof timeoutId === "number")
      { /* slow path - object has been reinterpreted in terms of valueOf() */
        for (let i = 0; i < events.length; i++)
        {
          if (events[i].serial === timeoutId)
          {
            events.splice(i, 1);
            if (i === 0)
              checkService()
            break;
          }
        }
      }
    }

    /** Execute callback after at least interval ms, regularly, at least interval ms apart.
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    timeout           {int} integer containing the minimum time to fire callback in ms
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the intervalId paramter of clearInterval()
     */
    setInterval = function eventLoop$$Worker$setInterval(callback, interval, arg)
    {
      let timer = setTimeout(callback, +interval || 0, arg);
      timer.recur = interval;
      return timer;
    }
    /** Execute callback after 0 ms, immediately when the event loop allows.
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the intervalId paramter of clearImmediate()
     */
    setImmediate = function eventLoop$$Worker$setImmediate(callback, arg)
    {
      let timer = setTimeout(callback, 0, arg);
      return timer;
    }

    /** queues a microtask to be executed at a safe time prior to control returning to the event loop
     * 
     *  @param    callback          {function} Callback function to fire
     */
    self.queueMicrotask = function eventLoop$$Worker$queueMicrotask(callback) {
      Promise.resolve().then(callback);
    };

    /**
     * Clear all pending timeouts, including those ones generated via setInterval
     */
    function clearAllTimeouts()
    {
      events.length = 0;
      realClearTimeout(serviceEvents.timeout);
      realClearTimeout(serviceEvents.measurerTimeout);
      realClearTimeout(serviceEvents.executingTimeout);
      serviceEvents.timeout = null;
      serviceEvents.nextTimeout = null;
      serviceEvents.servicing = false;
      serviceEvents.sliceIsFinished = false;
    }
    protectedStorage.clearAllTimeouts = clearAllTimeouts;

    protectedStorage.timedQueueMicrotask = queueMicrotask;
  })(self.setTimeout, self.setInterval, self.setImmediate, self.clearTimeout, self.clearInterval, self.clearImmediate, self.queueMicrotask, protectedStorage);
});
