/**
 * All webGPU promises are to be placed in this global registry. So we can await them all.
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

    /**
     * @typedef {{begin: DOMHighResTimeStamp, end: DOMHighResTimeStamp}} Interval
     */

    /** @type {Interval[]} */
    this.webGPUIntervals = [];
    
    /** @type {Interval[]} */
    this.cpuIntervals = [];
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

      this.globalTracker.webGPUIntervals.push({begin: lastSubmittedTime, end: this.end});
    }


    switch (originTag)
    {
      // undefined is CPU, this occurs when the promise is generated from async await
      case undefined:
      {
        this.globalTracker.cpuIntervals.push({begin: this.begin, end: this.end});
      }
      case "WebGL":
      case "WASM":
      {
        throw new Error("Not implemented");
      }
      case "WebGPU":
      {
        this.globalTracker.webGPUIntervals.push({begin: this.begin, end: this.end});
      }
      default:
      {
        // users should not have access to this, most likely an internal error
        throw new Error("Unknown origin tag");
      }
    }
  }



  /**
   * @contructor
   * @param {GlobalTrackers} globalTimers
   * @param {() => Promise} promiseFn
   * @param {"WebGPU" | "WebGL" | "WASM" | "WebGPUOnComplete"} originTag - if set, indicates the origin of the promise, it will affect where
   * the time delta is stored
   * @returns {TimedPromise}
   */
  constructor(globalTracker, promiseFn, originTag)
  {
    this.begin = performance.now();
    this.end = null;
    this.globalTracker = globalTracker;
    
    this.wrapped
      = promiseFn()
        .then(
          (onResolve) => {
            this.end = performance.now();
            this.#recordTimeDelta(originTag);
            return onResolve;
          },
          (onReject) => {
            this.end = performance.now();
            this.#recordTimeDelta(originTag);
            throw onReject;
          }
        );
  }


  /**
   * Implements the thennable interface, so we can chain promises and async await on them.
   *
   *
   * @function then
   * @param {Function} onFulfilled
   * @param {Function} onRejected
   * @returns {TimedPromise}
   */
  then(onFulfilled, onRejected)
  {
    return new TimedPromise(this.globalTracker, () => {
      // I think this only works if our wrapped is an actual JavaScript Promise, not just a thennable 
      return this.wrapped.then(onFulfilled, onRejected);
    });
  }
}
