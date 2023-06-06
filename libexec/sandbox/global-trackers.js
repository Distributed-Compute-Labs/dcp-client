self.wrapScriptLoading({ scriptName: 'global-trackers' }, function globalTrackers$$fn(protectedStorage) {
  /**
   * @typedef {import ('./timer-classes.js').TimeThing} TimeThing
   * @typedef {import ('./timer-classes.js').TimeInterval} TimeInterval
   */
  
  const TimeThing = protectedStorage.timers.TimeThing;
  const TimeInterval = protectedStorage.timers.TimeInterval;


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
  class GlobalTrackers {

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
        throw new Error("Not all intervals have settled");
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


  /**
   * @class WebGPUOnComplete
   */
  class WebGPUOnComplete
  {
    /**
     * @constructor
     * @param {String} queueLabel
     * @returns {WebGPUOnComplete}
     */
    constructor(queueLabel)
    {
      this.queueLabel = queueLabel;
    }
  }

  const originalPromiseConstructor = Promise;
  const originalPromiseThen = Promise.prototype.then;
  const originalPromiseCatch = Promise.prototype.catch;
  const originalPromiseFinally = Promise.prototype.finally;
  const originalResolve = Promise.resolve;

  const globalTrackers = new GlobalTrackers();
  // Promise = function(executor) {
  //   console.log("Promise constructor called");
  //   // secrectly return our own promise
  //   const lazy = () => new originalPromiseConstructor(executor);
  //   const fakePromise = new TimedPromise(globalTrackers, lazy);
  //   return fakePromise;
  // }

  // // this assume the global state of `globalTrackers` is already there, this assumption is relatively safe, if the assumption is violated,
  // // we can't time anything anyway.
  // Promise.resolve = function(value) {
  //   return new TimedPromise(globalTrackers, () => originalResolve(value));
  // }


  /** @typedef {import("./event-loop-virtualization.js").Event} Event */

  /** @type {Event[]} */
  const events = protectedStorage.events;

  /**
   * @class TimedPromise
   */
  class TimedPromise
  {

    /**
     * @function #calcualteTimeDelta
     * @private
     * @param {"WebGPU" | "WebGL" | "WASM" | WebGPUOnComplete | undefined} originTag - if set, indicates the origin of the promise, it will affect where
     */
    #recordTimeDelta(originTag)
    {
      if (originTag instanceof WebGPUOnComplete)
      {
        const label = originTag.queueLabel;
        const lastSubmittedTime = this.globalTracker.webGPUQueueRegistery.getLastSubmittedTime(label);

        if (lastSubmittedTime === undefined)
        {
          throw new Error("Cannot find queue with label " + label);
        } 

        // MAJOR CODE SMELL, SOMEONE PLEASE COME MAKE IT BETTER
        this.duration.overrideInterval(lastSubmittedTime, this.duration.end);

        this.globalTracker.webGPUIntervals.push(this.duration);
        console.log("WebGPU time delta: " + (this.duration.length));
        return;
      }


      switch (originTag)
      {
        // undefined is CPU, this occurs when the promise is generated from async await
        case undefined:
        {
          this.globalTracker.cpuIntervals.push(this.duration);
          console.log("CPU time delta: " + this.duration.length);
          break;
        }
        case "WebGL":
        case "WASM":
        {
          throw new Error("Not implemented");
        }
        case "WebGPU":
        {
          this.globalTracker.webGPUIntervals.push(this.duration);
          console.log("WebGPU time delta: " + (this.duration.lenght));
          break;
        }
        default:
        {
          // users should not have access to this, most likely an internal error
          throw new Error("Unknown origin tag");
        }
      }
    }

    /**
     *
     * It's safe to not kick off another around of event here because construction itself is synchronous, so it will
     * not cause a "supurious" event. It's the continuation of the promise that is more problematic.
     *
     * @contructor
     * @param {GlobalTrackers} globalTimers
     * @param {() => Promise} promiseFn
     * @param {"WebGPU" | "WebGL" | "WASM" | "WebGPUOnComplete"} originTag - if set, indicates the origin of the
     * promise, it will affect where the time delta is stored.
     * @returns {TimedPromise}
     */
    constructor(globalTracker, promiseFn, originTag)
    {
      this.duration = new TimeInterval();
      this.globalTracker = globalTracker;

      const that = this;
      
      this.wrapped
        = promiseFn()
          .then(
            (resovledValue) => {
              that.duration.stop();
              that.#recordTimeDelta(originTag);
              return resovledValue;
            },
            (rejectedReason) => {
              that.duration.stop();
              that.#recordTimeDelta(originTag);
              throw rejectedReason;
            }
          );
    }


    /**
     * Implements the thennable interface, so we can chain promises and async await on them. In general, we want to kick
     * off another round of event loop here to get our continuation timed.
     *
     *
     * @function then
     * @param {Function} onFulfilled
     * @param {Function} onRejected
     * @returns {Thennable} go read MDN about what is a thennable 🙂
     */
    then(onFulfilled, onRejected)
    {
      // // I think this only works if our wrapped is an actual JavaScript Promise, not just a thennable 
      return originalPromiseThen.call(this.wrapped, 
        (resolvedValue) => {
          // force the continuation to kick off another round of event loop
          const continuation = (resolution) => onFulfilled(resolution);
          events.serial = Number(events.serial) + 1;
          const event = new Event("off-thread-promise-continuation",
            continuation,
            resolvedValue,
            performance.now(),
            undefined,
            events.serial);
          events.push(event);
          setTimeout(protectedStorage.serviceEvents, 0);
        },
        (rejectedReason) => {
          // force the continuation to kick off another round of event loop
          const continuation = (reason) => onRejected(reason);
          events.serial = Number(events.serial) + 1;
          const event = new Event("off-thread-promise-continuation",
            continuation,
            rejectedReason,
            performance.now(),
            undefined,
            events.serial);
          events.push(event);
          setTimeout(protectedStorage.serviceEvents, 0);
        });
    }


    /**
     * Implements the catch method, so it smells like a promise to regular users.
     *
     * @function catch
     * @param {Function} onRejected - the callback to be called when the promise is rejected
     * @returns {Thennable}
     */
    catch(onRejected)
    {
      return originalPromiseCatch.call(this.wrapped, onRejected);
    }

    /**
     * Implements the finally method, so it smells like a promise to regular users.
     *
     *
     * @function finally
     * @param {Function} onFinally - A function to asynchronously execute when this promise becomes settled. Its 
     * return value is ignored unless the returned value is a rejected promise. The function is called with no arguments.
     * @returns {TimedPromise}
     */
    finally(onFinally)
    {
      return originalPromiseFinally.call(this.wrapped, onFinally);
    } 
  }


  protectedStorage.bigBrother = {
    globalTrackers: globalTrackers,
    TimedPromise: TimedPromise,
  };
});
