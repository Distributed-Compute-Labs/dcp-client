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
 *  After the first run of the work function, more JavaScript can be run with only two kinds of events: A macro task
 *  becomes ready or the stack is empty and a micro task is put onto the stack. If we time each function that executes
 *  on the macro task and micro task queue, then we will know how much CPU resource they utilized. 
 *
 *  Timing macrotasks are easy, within the environment of web workers, we have explicit control over the macro tasks that
 *  can occur, webGPU and the Timeout functions being the two macrotask sources. We can time the callback functions to these
 *  directly for accurate measurements of macrotasks.
 *
 *  A microtask is created via call to the Promise constructor, and while we can time most microtasks, those created using 
 *  async functions cannot be wrapped (without running babel on all work functions to convert async functions to Promises).
 *  In order to accurately measure all microtasks, we recognize that all microtasks must run directly after a macrotask, queue
 *  for directly after the macrotask finishes (see https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model).
 *  With this, to time a macrotasks and all microtasks it creates, we can:
 *    1. start a timer
 *    2. Add an event onto the macrotask queue, to run after this current macrotask
 *    3. Run the macrotask
 *    4. <All microtasks will run>
 *    5. When the event we put onto the macrotask queue is executed, stop our timer
 *  At this point, we have an accurate measurement of the total CPU time of our computation for that pass of the event loop. The next
 *  macrotask can be run, repeating this cycle until the work function resolves.
 *
 *  Since no IO is allowed in work function as of Feb 2024, the only source of this error is Timeouts have no CPU workloads
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
        // flush all commands that were already enqueued
        if (protectedStorage.webGPU)
          await protectedStorage.webGPU.waitAllCommandToFinish();

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
