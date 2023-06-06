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

debugger;
self.wrapScriptLoading({ scriptName: 'event-loop-virtualization' }, function eventLoopVirtualization$$fn(protectedStorage, ring0PostMessage)
{
  /** 
   * @class       Event
   * @classdesc   Class that represents an event on the event loop
   * @property {string} eventType - the type of event (timer, immediate, interval)
   * @property {functioon} fn - the function to be executed
   * @property {Array} args - the arguments to be passed to the function
   * @property {number} when - the time at which the event should be executed
   * @property {boolean} recur - whether the event should be executed repeatedly
   * @property {number} serial - the serial number of the event
   */
  class Event
  {
    constructor(eventType, fn, args, when, recur, serial)
    {
      this.eventType = eventType;
      this.fn = fn;
      this.args = args;
      this.when = when;
      this.recur = recur;
      this.serial = serial;
    }
  }

  // TODO: hide this for the final few layers that should not be allowed to see it
  const events = [];


  protectedStorage.Event = Event;
  (function privateScope(realSetTimeout, realSetInterval, realSetImmediate, realClearTimeout, realClearInterval, realClearImmediate, protecedStorage)
  {
    const cpuTimer = protectedStorage.timers.cpu;
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
        serviceEvents.executingTimeout = realSetTimeout(event.fn, 0, event.args);
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

      events.serial = Number(events.serial) + 1;

      timer = new Event('timer', callback, args, performance.now() + (Number(timeout) || 0), events.serial);
      events.push(timer);
      sortEvents();
      if (!serviceEvents.servicing)
      {
        if (!serviceEvents.nextTimeout)
        {
          realSetTimeout(serviceEvents, events[0].when - performance.now());
        }
        else
        {
          if (serviceEvents.nextTimeout > events[0].when)
          {
            realClearTimeout(serviceEvents.timeout);
            realSetTimeout(serviceEvents, events[0].when - performance.now())
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
