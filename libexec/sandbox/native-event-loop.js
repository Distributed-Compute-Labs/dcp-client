/**
 *  @file       event-loop-virtualization.js
 *              
 *  File that creates an event loop using a reactor pattern
 *  for handling timers on the event loop. This is made to
 *  be similar to the event loops in nodejs and browsers with respect
 *  to timers 
 * 
 *  The node and web worker evaluators already have an event loop, along with
 *  their own timer functions, so only the v8 evaluator needs to be modified. Before
 *  this, it has only the following primitive functions:
 *  - ontimer             will be invoked by the reactor when there are timers that
 *                        should need servicing based on the information provided to nextTimer().    
 *  - nextTimer()         sets when the next timer will be fired (in ms)
 *  
 *  Once this file has run, the following methods will be
 *  available on the global object for every evaluator:
 *  - setTimeout()        execute callback after minimum timeout time in ms
 *  - clearTimeout()      clear the timeout created by setTimeout
 *  - setInterval()       recurringly execute callback after minimum timeout time in ms
 *  - clearInterval()     clear the interval created by setInterval
 *  - setImmediate()       execute callback after 0ms, immediately when the event loop allows
 *  - clearImmediate()     clear the Immediate created by setImmediate
 *  - queueMicrotask()    add a microtask to the microtask queue, bypassing 4ms timeout clamping 
 *
 *  @author     Parker Rowe, parker@kingsds.network
 *              Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       August 2020
 * 
 *  @note       Unusual function scoping is done to eliminate spurious symbols
 *              from being accessible from the global object, to mitigate
 *              certain classes of security risks.  The global object here is
 *              the top of the scope chain (ie global object) for all code run
 *              by hosts in this environment.
 */
/* globals self, ontimer, nextTimer, evalTimer */

self.wrapScriptLoading({ scriptName: 'native-event-loop' }, function nativeEventLoop$$fn(protectedStorage, ring0PostMessage)
{
  (function privateScope(ontimer, nextTimer) {
    const timers = [];
    timers.serial = 0; /* If this isn't set, it becomes NaN */

    function sortTimers() {
      timers.sort(function (a, b) { return a.when - b.when; });
    }

    /* Fire any timers which are ready to run, being careful not to
     * get into a recurring timer death loop without reactor mediation.
     */
    function fireTimerCallbacks()
    {
      sortTimers();
      let timer = timers.shift();
      let now = Date.now();
      if (!timer)
        throw new Error('Logic error: trying to run timer when no timer exists') /* should be impossible */
      if (timer.when > now)  /* should be impossible, but at least we can handle this */
      {
        timers.unshift(timer);
        nextTimer(timers[0].when);
        return;
      }
      timer.fn.apply(null, timer.args);

      if (timer.recur)
      {
        timer.when = Date.now() + timer.recur;
        timers.push(timer);
      }

      sortTimers();
      if (timers.length)
        nextTimer(timers[0].when);
    }

    ontimer(fireTimerCallbacks);

    /** Execute callback after at least timeout ms. 
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    timeout           {int} integer containing the minimum time to fire callback in ms
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the timeoutId parameter of clearTimeout()
     */
    self.setTimeout = function eventLoop$$Worker$setTimeout(callback, timeout, arg) {
      let timer, args;
      if (typeof callback === 'string') {
        let code = callback;
        callback = function eventLoop$$Worker$setTimeout$wrapper() {
          let indirectEval = eval;
          return indirectEval(code);
        }
      }

      // if user supplies arguments, apply them to the callback function
      if (arg) {
        args = Array.prototype.slice.call(arguments); // get a plain array from function arguments
        args = args.slice(2);                         // slice the first two elements (callback & timeout), leaving an array of user arguments
        let fn = callback;
        callback = () => fn.apply(fn, args);          // apply the arguments to the callback function
      }

      timers.serial = +timers.serial + 1;
      timer = {
        fn: callback,
        when: Date.now() + (+timeout || 0),
        serial: timers.serial,
        valueOf: function () { return this.serial; }
      }
      timers.push(timer);
      if (timer.when <= timers[0].when) {
        sortTimers();
        nextTimer(timers[0].when);
      }
      return timer;
    }

    /** Remove a timeout from the list of pending timeouts, regardless of its current
     *  status.
     * 
     *  @param    timeoutId         {object} The value, returned from setTimeout(), identifying the timer.
     */
    self.clearTimeout = function eventLoop$$Worker$clearTimeout(timeoutId) {
      if (typeof timeoutId === "object") {
        let i = timers.indexOf(timeoutId);
        if (i != -1) {
          timers.splice(i, 1);

          /* if there is a timer at the top of the timers list, set that to be the nextTimer to fire
           * otherwise, tell the event loop that there are no more timers to fire, and end the loop accordingly.
           * this fixes a bug where you clear a timeout, but the program still waits that time before ending,
           * despite never calling the callback function
           * 
           * for example:
           * const timeout = setTimeout(() => console.log("hi"), 10000);
           * clearTimeout(timeout); 
           * 
           * used to still wait 10 seconds before closing the program, despite never printing hi to the console
           */
          if (timers.length) {
            nextTimer(timers[0].when);
          }
          else {
            nextTimer(0);
          }
        }
      } else if (typeof timeoutId === "number") { /* slow path - object has been reinterpreted in terms of valueOf() */
        for (let i = 0; i < timers.length; i++) {
          if (timers[i].serial === timeoutId) {
            timers.splice(i, 1);

            if (timers.length) {
              nextTimer(timers[0].when);
            }
            else {
              nextTimer(0);
            }

            break;
          }
        }
      }
    }

    // Memoise the original setTimeout for use in interval/immediate
    const innerSetTimeout = setTimeout;

    /** Execute callback after at least interval ms, regularly, at least interval ms apart.
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    timeout           {int} integer containing the minimum time to fire callback in ms
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the intervalId paramter of clearInterval()
     */
    self.setInterval = function eventLoop$$Worker$setInterval(callback, interval, arg) {
      let timer = innerSetTimeout(callback, +interval || 0, arg);
      timer.recur = interval;
      return timer;
    }

    /** Execute callback after 0 ms, immediately when the event loop allows.
     * 
     *  @param    callback          {function} Callback function to fire after a minimum callback time
     *  @param    arg               array of arguments to be applied to the callback function
     *  @returns                    {object} A value which may be used as the intervalId paramter of clearImmediate()
     */
    self.setImmediate = function eventLoop$$Worker$setImmediate(callback, arg) {
      let timer = innerSetTimeout(callback, 0, arg);
      return timer;
    }

    /** Remove an interval timer from the list of pending interval timers, regardless of its current
     *  status. (Same as clearTimeout)
     *
     *  @param    intervalId         {object} The value, returned from setInterval(), identifying the timer.
     */
    self.clearInterval = self.clearTimeout;
    self.clearImmediate = self.clearTimeout;

    /** queues a microtask to be executed at a safe time prior to control returning to the event loop
     * 
     *  @param    callback          {function} Callback function to fire
     */
    self.queueMicrotask = function eventLoop$$Worker$queueMicrotask(callback) {
      Promise.resolve().then(callback);
    }

    function clearAllTimers() {
      timers.length = 0;
      nextTimer(0);
    }

    addEventListener('message', async (event) => {
      try {
        if (event.request === 'clearTimers') {
          clearAllTimers();
          ring0PostMessage({
            request: 'clearTimersDone',
          });
        }
      } catch (error) {
        ring0PostMessage({
          request: 'error',
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        });
      }
    });
  })(self.ontimer, self.nextTimer);

  ontimer = nextTimer = evalTimer = undefined;
  delete self.ontimer;
  delete self.nextTimer;
  delete self.evalTimer;
});
