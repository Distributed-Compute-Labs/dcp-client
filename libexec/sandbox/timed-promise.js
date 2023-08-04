/**
 *  @file       timed-promise.js
 *
 *              A timed promise is a promise that will measure how long the construction and continuation takes on the
 *              CPU. See the header comment in event-loop-virtualization for the theory behind its working.
 *
 *  @author     Liang Wang, liang@distributive.network
 *  @date       2023
 *
 */

self.wrapScriptLoading({ scriptName: 'timed-promise' }, function timedPromise(protectedStorage)
{
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
   * A Promise that will record how long the construction and continuation takes. It has all the same API as the standard Promise
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
     * Implements the thennable interface, so we can chain promises and await on them.
     *
     * @function then
     * @param {Function | value} onFulfilled
     * @param {Function | value} onRejected
     * @returns {Thennable} go read MDN about what is a thennable
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
        },
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
      ));
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

    static get [Symbol.species]()
    {
      return this;
    }
  }

  self.Promise = TimedPromise;

  protectedStorage.bigBrother = {
    ...protectedStorage.bigBrother,
    TimedPromise: TimedPromise,
  };
});
