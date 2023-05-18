'use strict'

/**
 * @typedef {require('./webgpu-promise-registery.js').WebGPUPromiseRegistery} WebGPUPromiseRegistery
 */

// The TimerMonad is a monad that wraps a promise and adds a timer to it.
// Since we define the then property on the TimerMonad, it is also a promise 
// and can be awaited.
//
/**
 * @template T
 */
class GPUTimingPromise
{
  /**
   * @constructor
   * @param {WebGPUPromiseRegistery} promiseRegistery the global promise registery to add all GPU promises to
   * @param {() => Promise<T>} promiseFn an lazily evaluated function that returns a promise
   * @param {boolean} isGPUFunction if true, the promise is a GPU promise and will be added to the promise registery
   * @returns {GPUTimingPromise<T>}
   */
  // this is also the right unit where we construct a monad
  // from a value, under no circumstances should one use the promise
  // paramesters afterwards in any way.
  constructor(promiseRegistery, promiseFn, isGPUFunction = false)
  {
    this.promiseRegistery = promiseRegistery;
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

  // implement the promise/thennable interface
  // this is mostly a monadic bind, but technically it fails the association rules
  // see https://stackoverflow.com/questions/45712106/why-are-promises-monads for why
  // it fails to be even an applicative 
  then(onFulfilled, onRejected)
  {
    // TODO: prove that it's fine to always treat the continuations like they are not GPU functions because
    // somewhere in the chain, we will have a GPU function and the promise will be added to the registery
    return new GPUTimingPromise(this.promiseRegistery, () => this.innerPromise.then(onFulfilled, onRejected));
  }


  // sychronously *try* to get the duration of the promise, if the promise has not
  // settled, we throw an error
  tryDuration()
  {
    if (this.end === null)
    {
      throw new Error('Promise has not settled yet');
    }
    return this.end - this.begin;
  }
  
  // asynchronously get the duration of the promise, if the promise has not settled, we will
  // await it.
  //
  // WARNING: you should never call this function without awaiting it, this breaks the entire
  // purpose of the monad, to try to get the duration of the promise synchronously, use tryDuration.
  async duration()
  {
    if (this.end === null)
    {
      await this.wrapped;
    }
    return this.end - this.begin;
  }
}
