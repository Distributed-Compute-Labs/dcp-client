'use strict'

// The TimerMonad is a monad that wraps a promise and adds a timer to it.
// Since we define the then property on the TimerMonad, it is also a promise 
// and can be awaited.
//
/**
 * @class TimerMonad
 * @template T
 */
class TimerMonad
{
  /**
   * @constructor
   * @param {() => Promise<T>} promise
   * @returns {TimerMonad<T>}
   */
  // this is also the right unit where we construct a monad
  // from a value, under no circumstances should one use the promise
  // paramesters afterwards in any way.
  constructor(promiseFn)
  {
    this.wrapped = new Promise((resolve, reject) =>
    {
      this.before = performance.now();
      this.after = null;

      // actually start the promise
      const innerPromise  = promiseFn();
      
      // chain the promise so the timer is stopped when the promise is resolved or rejected
      innerPromise.then(
        (res) =>
        {
          this.after = performance.now();
          resolve(res);
        },
        (rej) =>
        {
          this.after = performance.now();
          reject(rej);
        })
    });
  }


  // implement the promise/thennable interface
  // this is mostly a monadic bind, but technically it fails the association rules
  // see https://stackoverflow.com/questions/45712106/why-are-promises-monads for why
  // it fails to be even an applicative 
  then(onFulfilled, onRejected)
  {
    return new TimerMonad(() => this.innerPromise.then(onFulfilled, onRejected));
  }


  // sychronously *try* to get the duration of the promise, if the promise has not
  // settled, we throw an error
  tryDuration()
  {
    if (this.after === null)
    {
      throw new Error('Promise has not settled yet');
    }
    return this.after - this.before;
  }
  
  // asynchronously get the duration of the promise, if the promise has not settled, we will
  // await it.
  //
  // WARNING: you should never call this function without awaiting it, this breaks the entire
  // purpose of the monad, to try to get the duration of the promise synchronously, use tryDuration.
  async duration()
  {
    if (this.after === null)
    {
      await this.wrapped;
    }
    return this.after - this.before;
  }
}
