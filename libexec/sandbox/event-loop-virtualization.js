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
  (function privateScope(realSetTimeout, realSetInterval, realSetImmediate, realClearTimeout, realClearInterval, realClearImmediate, protecedStorage)
  {
    /** @typedef {import("./timer-classes.js").TimeThing} TimeThing */
    const TimeThing = protectedStorage.TimeThing;
    /** @typedef {import("./timer-classes.js").TimeInterval} TimeInterval */
    const TimeInterval = protectedStorage.TimeInterval;
    /** @typedef {import("./condition-variable.js").ConditionVariable} ConditionVariable */
    const ConditionVariable = protectedStorage.ConditionVariable;


    // TODO: hide this better
    // TODO: perhaps we should grab it not via gloablThis
    // stash a copy so we don't end up recursively calling with no base case
    const realSubmit = globalThis.GPUQueue.prototype.submit;
    const realOnSubmittedWorkDone = globalThis.GPUQueue.prototype.onSubmittedWorkDone;

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

        /** @type Array<DOMHighResTimeStamp[]> */
        this.submissionTimeQueue = [];

        // /** @type Array<number> */
        // this.outstandingCommands = [];

        /** @type Array<ConditionVariable> */
        this.outStandingCommandCondVars = [];

        /** @type TimeThing */
        this.webGPUIntervals = webGPUIntervals;
      }

      /**
       * Add a queue to the registry, returns the newly registered queue.
       * @param {GPUQueue} queue
       * @returns {GPUQueue}
       */
      add(queue)
      {
        const idx = this.queues.length;
        this.queues.push(queue);
        this.submissionTimeQueue.push([]);
        // this.outstandingCommands.push(0);
        this.outStandingCommandCondVars.push(new ConditionVariable());

        // record how long the last submitted commands took. Standards guarantees that `onSubmittedWorkDone` is always
        // in FIFO order.
        const that = this;
        const recordTime = () => {
          // this promise will also resolve immediately if they are no commands outstanding, so we need the condvar to
          // avoid extra wakesups
          const onLastSubmissionComplete = () => realOnSubmittedWorkDone.call(queue);
          const waitUntilNewCommand = () => that.outStandingCommandCondVars.at(idx).wait();

          waitUntilNewCommand()
            .then(onLastSubmissionComplete)
            .then(()=> {
              // get when was the last series of commands submitted
              const lastSubmittedAt = that.popLastSubmittedTime(queue);

              // should be rare but I'm paranoid
              if (!lastSubmittedAt)
                return;

              const duration = (()=> {
                const currentTime = performance.now();
                const interval = new TimeInterval();
                interval.overrideInterval(lastSubmittedAt, currentTime);
                return interval;
              })();
              that.webGPUIntervals.push(duration);
            })
            // a little trick I learned with boost asio, this would *not* cause the stack to blow up. Since we only
            // re-enter once the promise we chain our fate to is resolved, we are actually at most one level deep
            .then(recordTime);
        };

        // mimics a background thread, we opt to use the micro task queue it gets serviced earlier, makes timing
        // hopefully more accurate
        recordTime();
        return queue;
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
        const submissionTimes = this.submissionTimeQueue.at(idx);
        submissionTimes.push(performance.now());

        // actually submit on the underlying queue
        realSubmit.call(queue, commandBuffers);

        // TODO: notifyOne should be enough right??
        this.outStandingCommandCondVars.at(idx).notifyOne();
      }


      /**
       * Get the last submission time for a queue in FIFO order. Our special GPUQueueTimingPromise can use
       * this to determine an upperbournd for when the queue has finished executing the command buffers.
       * 
       * If the queue has not been submitted to, returns undefined.
       * 
       * @param {GPUQueue | String | string} queue the Queue you wish to submit to, or the label of the queue
       * @returns {DOMHighResTimeStamp | undefined} the last submission time for the queue
      */
      popLastSubmittedTime(queue)
      {
        const idx = this.queues.indexOf(queue);
        if (idx === -1)
          return;

        const submissionQueue = this.submissionTimeQueue.at(idx);
        return submissionQueue?.shift();
      }
    }


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
      }


      // TODO: specifiy down the return type
      /**
       * Obtain the current metrics of our tracked resources, mostly about timings.
       * @async
       * @function {getMetrics}
       */
      async getMetrics()
      {
        // TODO: Ryan said CPU should also include the WASM time
        const webGPUTime = this.webGPUIntervals.duration();
        const webGLTime = this.webGLIntervals.duration();
        const wasmTime = this.wasmIntervals.duration();
        const cpuTime = this.cpuIntervals.duration() + wasmTime;
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

    /** 
     * //TODO: figure out how the result slot return interact with if the function throws an error 
     * @class       FauxEvent
     * @classdesc   Class that represents an event on the event loop
     * @property {string} eventType - the type of event (timer, immediate, interval)
     * @property {function} fn - the function to be executed
     * @property {Array} args - the arguments to be passed to the function
     * @property {number} when - the time at which the event should be executed
     * @property {boolean} recur - whether the event should be executed repeatedly
     * @property {number} serial - the serial number of the event
     * @property {any} returnSlot - the result of application of fn(args) is stored here
     * // TODO: figure out how it interact with thrown errors
     * @property {function} callback - the callback to be executed when the event is complete, we only support closures
     * that takes no arguments
     */
    class FauxEvent
    {
      constructor(eventType, fn, args, when, recur, serial, callback)
      {
        this.eventType = eventType;
        this.fn = fn;
        this.args = args;
        this.when = when;
        this.recur = recur;
        this.serial = serial;
        this.returnSlot = undefined;

        // should we ensure the callback is actually a funciton and not something else?
        // yes, we should, but JS is weekly typed and RTTI might not be cheap 
        if (callback === undefined || callback === null)
        {
          // noop
          this.callback = () => {};
        }
        else
        {
          this.callback = callback;
        }
      }
    }

    // TODO: hide this for the final few layers that should not be allowed to see it
    const events = [];
    protectedStorage.events = events;

    protectedStorage.FauxEvent = FauxEvent;
    // TODO: create a nice intereface so we're not just pulling the guts out all the time
    const cpuTimer = protectedStorage.bigBrother.globalTrackers.cpuIntervals;
    events.serial = 0;
    let timersLocked = false;

    protectedStorage.lockTimers = function lockTimers() { timersLocked = true; }
    protectedStorage.unlockTimers = function unlockTimers() { timersLocked = false; }

    function sortEvents()
    {
      events.sort(function(a, b) { return a.when - b.when; });
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

      // todo: there is almost certainly a bug
      if (!event)
        return;
      // debugger;
      if (event.eventType === 'timer' || event.eventType === 'timed-promise-continuation')
      {
        serviceEvents.executingTimeout = realSetTimeout(() => {
          // TODO: someone prove the following interacts correctly with `this` value nonsense
          // store the result of the function in the event so it can be accessed later
          event.returnSlot = event.fn(...event.args);
          if (event.callback)
          {
            event.callback();
          }
        }, 0);
        if (event.recur)
        {
          event.when = performance.now() + event.recur;
          events.push(event);
          sortEvents();
        }
      }
      // Can add handles for events to the event loop as needed (ie messages)

      // Measure the time on the event loop after everything has executed
      serviceEvents.measurerTimeout = realSetTimeout(endOfRealEventCycle, 1);
      function endOfRealEventCycle()
      {
        serviceEvents.servicing = false;
        serviceEvents.interval.stop();

        if (!serviceEvents.sliceIsFinished && events.length)
        {
          serviceEvents.nextTimeout = events[0].when
          serviceEvents.timeout = realSetTimeout(serviceEvents, events[0].when - performance.now());
        }
      }
    }

    // TODO: find a better way to export this
    protectedStorage.serviceEvents = serviceEvents;

    /** Execute callback after at least timeout ms. 
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    timeout           {int} integer containing the minimum time to fire callback in ms
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the timeoutId parameter of clearTimeout()
     */
    setTimeout = function eventLoop$$Worker$setTimeout(callback, timeout, arg)
    {
      // Work function has resolved, Don't let client init any new timeouts.
      if (timersLocked)
        return {};

      timeout = timeout || 0;
      let timer, args;
      if (typeof callback === 'string')
      {
        let code = callback;
        callback = function eventLoop$$Worker$setTimeout$wrapper()
        {
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
      else
      {
        // TODO: else statement considered harmful, simplify
        args = [];
      }

      events.serial = Number(events.serial) + 1;
      timer = new FauxEvent('timer', callback, args, performance.now() + (Number(timeout) || 0), false, events.serial);
      events.push(timer);
      sortEvents();
      

      if (serviceEvents.servicing) return timer;

      if (!serviceEvents.nextTimeout)
      {
        realSetTimeout(serviceEvents, events[0].when - performance.now());
      }
      else
      {
        if (serviceEvents.nextTimeout > events[0].when) {
          realClearTimeout(serviceEvents.timeout);
          debugger;
          realSetTimeout(serviceEvents, events[0].when - performance.now());
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
            realSetTimeout(serviceEvents, events[0].when - performance.now())
          }
          else
            realClearTimeout(serviceEvents.timeout);
        }
      }
      if (typeof timeoutId === 'object')
      {
        let i = events.indexOf(timeoutId);
        if (i !== -1)
          events.splice(i, 1);
        if (i === 0)
          checkService()
      }
      else if (typeof timeoutId === 'number')
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
      let timer = setTimeout(callback, Number(interval) || 0, arg);
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

    /** Remove an interval timer from the list of pending interval timers, regardless of its current
     *  status. (Same as clearTimeout)
     *
     *  @param    intervalId         {object} The value, returned from setInterval(), identifying the timer.
     */
    clearInterval = clearTimeout;
    clearImmediate = clearTimeout

    /** queues a microtask to be executed at a safe time prior to control returning to the event loop
     * 
     *  @param    callback          {function} Callback function to fire
     */
    queueMicrotask = function eventLoop$$Worker$queueMicrotask(callback)
    {
      Promise.resolve().then(callback);
    }

    function clearAllTimers()
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

    protectedStorage.clearAllTimers = clearAllTimers;

    // TODO: yes the name is very stupid
    protectedStorage.bonaFideSetTimeout = realSetTimeout;
  })(self.setTimeout, self.setInterval, self.setImmediate, self.clearTimeout, self.clearInterval, self.clearImmediate, protectedStorage);

  self.setTimeout = setTimeout;
  self.setInterval = setInterval;
  self.setImmediate = setImmediate;
  self.clearTimeout = clearTimeout;
  self.clearInterval = clearInterval;
  self.clearImmediate = clearImmediate;
});
