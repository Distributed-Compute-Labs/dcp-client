/**
 * @type {require('./gpu-queue-registery.js').GPUQueueRegistery}
 */


class GPUQueueTimingPromise
{
  /**
   * @constructor
   * @param {GPUQueueRegistery} the global webGPU queue registery
   * @param {GPUQueue | String} queue or queue label to submit the command buffers to
   * @param {commandBuffers[]} commandBuffers to be submitted to the queue
   * @returns {GPUQueueTimingPromise}
   */
  // this is also the right unit where we construct a monad
  // from a value, under no circumstances should one use the promise
  // paramesters afterwards in any way.
  constructor(queueRegistery, queue, commandBuffers)
  {
    this.queueRegistery = queueRegistery;
    this.begin = null;
    this.end = null;

    // TODO: forcing another round of event loop seems unideal, but this way we can work with the existing CPU timer
    // only start the promise after the current event loop has finished, this ensures the CPU timer
    // is reset before we start the promise
    setImmediate(() =>
    {
      this.wrapped = new Promise((resolve, reject) =>
      {
        // submit the command buffers to the queue
        this.queueRegistery.submit(queue, commandBuffers);
        
        const calcuateDuration = () =>
        {
          const lastSubmittedTime = this.queueRegistery.getlastSubmittedTime(queue);
          this.begin = lastSubmittedTime;
          this.end = performance.now();

          return this.end - this.begin;
        }

        // chain the promise so the timer is stopped when the promise is resolved or rejected
        innerPromise.then(
          (res) =>
          {
            calcuateDuration();
            resolve(res);
          },
          (rej) =>
          {
            calcuateDuration();
            reject(rej);
          })
      });
    });
  }
  
  /**
   * @param {WebGPUPromiseRegistery} queueRegistry the global promise registery to add all GPU promises to
   * @param {() => Promise<T>} promiseFn an lazily evaluated function that returns a promise
   * @param {boolean} isGPUFunction if true, the promise is a GPU promise and will be added to the promise registery
   * @returns {GPUQueueTimingPromise}
   */
  // this is also the right unit where we construct a monad
  // from a value, under no circumstances should one use the promise
  // paramesters afterwards in any way.
  bind(queueRegistry, promiseFn, isGPUFunction = false)
  {
    this.promiseRegistery = queueRegistry;
    this.begin = null;
    this.end = null;

    // TODO: forcing another round of event loop seems unideal, but this way we can work with the existing CPU timer
    // only start the promise after the current event loop has finished, this ensures the CPU timer
    // is reset before we start the promise
    setImmediate(() =>
    {
      this.wrapped = new Promise((resolve, reject) =>
      {
        this.begin = performance.now();
        this.end = null;

        // actually start the promise
        const innerPromise = promiseFn();
 
        // only time GPU promises
        if (isGPUFunction)
        {
          this.promiseRegistery.add(innerPromise);
        }
        else
        {
          // so that even if someone tries to get the duration, it will be 0 and the CPU
          this.begin = 0;
          this.end = 0;
        }
 
        // chain the promise so the timer is stopped when the promise is resolved or rejected
        innerPromise.then(
          (res) =>
          {
            this.end = this.end === 0 ? 0 : performance.now();
            resolve(res);
          },
          (rej) =>
          {
            this.end = this.end === 0 ? 0 : performance.now();
            reject(rej);
          })
      });
    });
  }
}
