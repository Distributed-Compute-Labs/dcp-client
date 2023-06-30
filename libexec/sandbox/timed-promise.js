/**
 *  @file       timed-promise.js
 *
 *              A timed promise is a promise that will measure how long it took to resolve within our best abilities.
 *              This class is *meant* to be expandable in the future! What you need to modify is the switch statement
 *              for `originTag`, think of it as a sum type and you need to match every variant.
 *
 *              This class exists so we can measure resource usage for thing that happen off the main CPU thread.
 *
 *  @author     Liang Wang, liang@distributive.network
 *  @date       2023
 *
 */

self.wrapScriptLoading({ scriptName: 'timed-promise' }, function timedPromise(protectedStorage)
{
  const TimeInterval = protectedStorage.TimeInterval;
  const RealPromise = Promise.prototype.constructor;
  const cpuIntervals = protectedStorage.bigBrother.globalTrackers.cpuIntervals;
  const realThen = Promise.prototype.then;
  const realCatch = Promise.prototype.catch;
  const realFinally = Promise.prototype.finally;

  /**
   * TODO: actually think about how this is used and what are the implications
   *
   * A TimedPromise is a promise that records how long it took to *resolve*. It fulfills the thennable interface so it
   * smells like a promise, acts like a promise, and can be used like a promise. In most cases, you should only use
   * this for promises that cause of the fulfillment happens due to off thread work (e.g. WebGPU, WebAssembly, WebGL,
   * etc).
   *
   * A notable feature of this class that we will kick the continuation to an timeout so we can record the time it took
   * for the *continuation* to run.
   *
   * @class TimedPromise
   */
  class TimedPromise
  {
    /**
     *
     */
    constructor(executor)
    {
      this.wrapped = new RealPromise((resolve, reject) =>
      {
        // our queueMicrotask know show to measure
        queueMicrotask(() =>
        {
          executor(resolve, reject);
        })
      });
    }

    /**
     * WARNING: this is basically a constructor 
     *
     * Goal: some functions return a promise already, can't change that, best we can do is fake it
     * @param {GlobalTrackers} globalTimers
     * @param {() => Promise} promiseFn
     * @param {(duration) => undefined} promiseFn
     * @returns {TimedPromise}
     */
    fromExistingPromiseFunction(promiseFn, recordTime)
    {
      this.recordTime = recordTime;
      const that = this;

      this.wrapped = new RealPromise((resolve, reject) =>
      {
        // our queueMicrotask know show to measure
        queueMicrotask(() =>
        {
          const duration = new TimeInterval();

          try
          {
            const promise = promiseFn();
            duration.stop();

            that.recordTime(duration);
            resolve(promise);
          }
          catch (error)
          {
            duration.stop();

            that.recordTime(duration);
            reject(error);
          }
        })
      });
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
      return (
        realThen.call(this.wrapped, (resolvedValue) =>
        {
          const duration = new TimeInterval();
          const ret = onFulfilled(resolvedValue);
          duration.stop();
          cpuIntervals?.push(duration);

          return ret;
        }),
        (rejectedReason) =>
        {
          const duration = new TimeInterval();
          const ret = onRejected(rejectedReason);
          duration.stop();
          cpuIntervals?.push(duration);

          return ret;
        }
      );
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
      return realThen.call(this.wrapped, (undefined, (rejectedReason) =>
      {
        return new TimedPromise((_resolve, reject) =>
        {
          reject(onRejected(rejectedReason));
        })
      }));
    }

    /**
     * Implements the finally method, so it smells like a promise to regular users.
     *
     *
     * @function finally
     * @param {Function} onFinally - A function to asynchronously execute when this promise becomes settled. Its
     * return value is ignored unless the returned value is a rejected promise. The function is called with no
     * arguments.
     * @returns {TimedPromise}
     */
    finally(onFinally)
    {
      // TODO: finally is some of the most stupid aspect of using exception as the general error handling mechanism
      throw new Error('Not implemented (yet)');
    }
  }

  self.Promise.prototype.constructor = TimedPromise;

  protectedStorage.bigBrother = {
    ...protectedStorage.bigBrother,
    TimedPromise: TimedPromise,
  };
}
);
