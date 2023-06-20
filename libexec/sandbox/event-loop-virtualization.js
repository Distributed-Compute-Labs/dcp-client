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
  // the JS way of thinking just because funtions are first class objects means they can confuse types and values is 
  // driving me insane, the following should be viewed as a type
  const TimeThing = protectedStorage.TimeThing;

  /**
   * All webGPU promises are to be placed in this global registry. So we can await them all.
   * 
   * @class WebGPUPromiseRegistry
   */
  class WebGPUPromiseRegistry
  {
    /**
     * @constructor
     * @returns {WebGPUPromiseRegistry}
     */
    constructor()
    {
      this.promises = [];
    }

    /**
     * Add a promise to the registry, returns the newly registered promise.
     *
     * @param {Promise} promise
     * @returns {Promise}
     */
    add(promise)
    {
      this.promises.push(promise);
      return promise;
    }

    /**
     * Wait for all promises in the registry to settle, returning the results.
     * @returns {Promise}
     */
    async waitAll()
    {
      return await Promise.allSettled(this.promises);
    }
  }


  /**
   *
   * @class GPUQueueRegistery
   */
  class WebGPUQueueRegistery
  {
    /**
     * @constructor
     * @returns {GPUQueueRegistery}
     */
    constructor()
    {
      /** @type Map<String, GPUQueue> */
      this.queues = new Map();

      /** @type Map<GPUQueue, DOMHighResTimeStamp[]> */
      this.submissionTimeQueue = new Map();
    }

    /**
     * Add a queue to the registry, returns the newly registered queue.
     * @param {GPUQueue} queue
     * @returns {GPUQueue}
     */
    add(queue)
    {
      this.queues.set(queue.label, queue);
      return queue;
    }


    /**
     * Add a submission to the registry.
     *
     * @param {GPUQueue | String} queue the Queue you wish to submit to, or the label of the queue
     * @param {GPUCommandBuffer[]} commandBuffers the command buffers you wish to submit
     * @returns {undefined}
     */
    addSubmission(queue, commandBuffers)
    {
      // we assume the queue is always already in the registry, should be enforced by changing all the
      // places where a queue can be created to use the registery
      if (typeof queue === 'string')
      {
        queue = this.find(queue);
      }

      if (!this.submissionTimeQueue.has(queue))
      {
        this.submissionTimeQueue.set(queue, []);
      }

      this.submissionTimeQueue.get(queue).push(performance.now());
      
      // submit returns undefined but just in case the user does something weird with the return value
      // we return it to it's a drop in replacement
      return queue.submit(commandBuffers);
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
    getLastSubmittedTime(queue)
    {
      if (typeof queue.toString() === 'string')
      {
        queue = this.find(queue);
      }

      const submissionQueue = this.submissionTimeQueue.get(queue);
      return submissionQueue.shift();
    }

    /** 
     * Get a queue from the registry by label. If a queue with the given label is not
     * found, returns undefined.
     *
     * @function find
     * @param {String} label
     * @returns {GPUQueue}
     */
    find(label)
    {
      return this.queues.get(label);
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
      this.webGPUPromiseRegistry = new WebGPUPromiseRegistry();
      this.webGPUQueueRegistery = new WebGPUQueueRegistery();

      /** @type {TimeThing} */
      this.webGPUIntervals = new TimeThing();
      
      /** @type {TimeThing} */
      this.cpuIntervals = new TimeThing();

      // TODO: actually make them record stuff
      /** @type {TimeThing} */
      this.webGLIntervals = new TimeThing();

      /** @type {TimeThing} */
      this.wasmIntervals = new TimeThing();
    }


    // TODO: specifiy down the return type
    /**
     * Obtain the current metrics of our tracked resources, mostly about timings.
     * @async
     * @function {getMetrics}
     */
    async getMetrics()
    {
      // TODO: do a check to see all the two registries are empty
   
      if (
             !this.webGPUIntervals.allSettled()
          || !this.cpuIntervals.allSettled()
          || !this.webGLIntervals.allSettled()
          || !this.wasmIntervals.allSettled()
         )
      {
        throw new Error('Not all intervals have settled');
      }

      // force all webGPU promises to run to completion
      // TODO: maybe we want the results?
      const _results = await this.webGPUPromiseRegistry.waitAll();

      // TODO: Ryan said CPU should also include the WASM time
      const webGPUTime = this.webGPUIntervals.duration();
      const webGLTime = this.webGLIntervals.duration();
      const wasmTime = this.wasmIntervals.duration();
      const cpuTime = this.cpuIntervals.duration() + wasmTime;
      const totalTime = webGPUTime + cpuTime + webGLTime;

      return {
        total: totalTime,
        webGPU: webGPUTime,
        cpu: cpuTime,
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
   * @class       Event
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
  class Event
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

  protectedStorage.Event = Event;
  (function privateScope(realSetTimeout, realSetInterval, realSetImmediate, realClearTimeout, realClearInterval, realClearImmediate, protecedStorage)
  {
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
      if (event.eventType === 'timer')
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
      timer = new Event('timer', callback, args, performance.now() + (Number(timeout) || 0), false, events.serial);
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

  })(self.setTimeout, self.setInterval, self.setImmediate, self.clearTimeout, self.clearInterval, self.clearImmediate, protectedStorage);

  self.setTimeout = setTimeout;
  self.setInterval = setInterval;
  self.setImmediate = setImmediate;
  self.clearTimeout = clearTimeout;
  self.clearInterval = clearInterval;
  self.clearImmediate = clearImmediate;
});
