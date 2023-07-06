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
  /** @todo think about how to not use global variables */
  const TimeInterval = protectedStorage.TimeInterval;
  const cpuIntervals = protectedStorage.bigBrother.globalTrackers.cpuIntervals;

  const RealPromise = Promise.prototype.constructor;
  const RealPromiseObject = Promise;
  const realThen = Promise.prototype.then;
  const realCatch = Promise.prototype.catch;
  const realFinally = Promise.prototype.finally;
  const realAll = Promise.all.bind(RealPromiseObject);
  const realAllSettled = Promise.allSettled.bind(RealPromiseObject);
  const realAny = Promise.any.bind(RealPromiseObject);
  const realRace = Promise.race.bind(RealPromiseObject);
  const realReject = Promise.reject.bind(RealPromiseObject);
  const realResolve = Promise.resolve.bind(RealPromiseObject);

  const recordOnCPU = (duration) => {
    cpuIntervals.push(duration);
  };

  function makeTimed(fn, recorder)
  {
    return function(...args)
    {
      const duration = new TimeInterval();
      const ret = fn(...args);
      duration.stop();
      recorder(duration);

      return ret;
    }
  }
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
     * @todo update doc to support values instead of only functions
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
          if (onFulfilled instanceof Function)
          {
            const timed = makeTimed(
              () => onFulfilled(resolvedValue),
              recordOnCPU
            );
            return timed();
          }
          else
          {
            return onFulfilled;
          }
        }),
        (rejectedReason) =>
        {
          if (onRejected instanceof Function)
          {
            const timed = makeTimed(
              () => onFulfilled(rejectedReason),
              recordOnCPU
            );
            return timed();
          }
          else
          {
            return onFulfilled;
          }
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
      return realCatch.call(this.wrapped, (rejectedReason) =>
      {
        const timed = makeTimed(() => onRejected(rejectedReason), recordOnCPU);
        return timed();
      });
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
      realFinally.call(this.wrapped, () => {
        const timed = makeTimed(onFinally, recordOnCPU);
        return timed;
      });
    }

    static all(...args)
    {
      return realAll(...args)
    }

    static allSettled(...args)
    {
      return realAllSettled(...args);
    }

    static any(...args)
    {
      return realAny(...args);
    }

    static race(...args)
    {
      return realRace(...args);
    }

    static reject(...args)
    {
      return realReject(...args);
    }

    static resolve(...args)
    {
      return realResolve(...args);
    }
  }

  self.Promise = TimedPromise;

  protectedStorage.bigBrother = {
    ...protectedStorage.bigBrother,
    TimedPromise: TimedPromise,
  };
});
