self.wrapScriptLoading({ scriptName: 'timed-promise' }, function globalTrackers$$fn(protectedStorage) {
  /**
   * @class WebGPUOnComplete
   */
  class WebGPUOnComplete {
    /**
     * @constructor
     * @param {String} queueLabel
     * @returns {WebGPUOnComplete}
     */
    constructor(queueLabel) {
      this.queueLabel = queueLabel;
    }
  }

  const originalPromiseThen = Promise.prototype.then;
  const originalPromiseCatch = Promise.prototype.catch;
  const originalPromiseFinally = Promise.prototype.finally;

  /** @typedef {import("./event-loop-virtualization.js").Event} Event */

  /** @type {Event[]} */
  const events = protectedStorage.events;

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
  class TimedPromise {
    /**
     * @function #calcualteTimeDelta
     * @private
     * @param {"WebGPU" | "WebGL" | "WASM" | WebGPUOnComplete | undefined} originTag - if set, indicates the origin of the promise, it will affect where
     */
    #recordTimeDelta(originTag) {
      if (originTag instanceof WebGPUOnComplete) {
        const label = originTag.queueLabel;
        const lastSubmittedTime =
          this.globalTracker.webGPUQueueRegistery.getLastSubmittedTime(label);

        if (lastSubmittedTime === undefined) {
          throw new Error("Cannot find queue with label " + label);
        }

        // MAJOR CODE SMELL, SOMEONE PLEASE COME MAKE IT BETTER
        this.duration.overrideInterval(lastSubmittedTime, this.duration.end);

        this.globalTracker.webGPUIntervals.push(this.duration);
        console.log("WebGPU time delta: " + this.duration.length);
        return;
      }

      switch (originTag) {
        // undefined is CPU, this occurs when the promise is generated from async await
        case undefined: {
          this.globalTracker.cpuIntervals.push(this.duration);
          console.log("CPU time delta: " + this.duration.length);
          break;
        }
        case "WebGL":
        case "WASM": {
          throw new Error("Not implemented");
        }
        case "WebGPU": {
          this.globalTracker.webGPUIntervals.push(this.duration);
          console.log("WebGPU time delta: " + this.duration.lenght);
          break;
        }
        default: {
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
    constructor(globalTracker, promiseFn, originTag) {
      this.duration = new TimeInterval();
      this.globalTracker = globalTracker;

      const that = this;

      this.wrapped = promiseFn().then(
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
    then(onFulfilled, onRejected) {
      // // I think this only works if our wrapped is an actual JavaScript Promise, not just a thennable
      return originalPromiseThen.call(
        this.wrapped,
        (resolvedValue) => {
          // force the continuation to kick off another round of event loop
          const continuation = (resolution) => onFulfilled(resolution);
          events.serial = Number(events.serial) + 1;
          const event = new Event(
            "off-thread-promise-continuation",
            continuation,
            resolvedValue,
            performance.now(),
            undefined,
            events.serial
          );
          events.push(event);
          setTimeout(protectedStorage.serviceEvents, 0);
        },
        (rejectedReason) => {
          // force the continuation to kick off another round of event loop
          const continuation = (reason) => onRejected(reason);
          events.serial = Number(events.serial) + 1;
          const event = new Event(
            "off-thread-promise-continuation",
            continuation,
            rejectedReason,
            performance.now(),
            undefined,
            events.serial
          );
          events.push(event);
          setTimeout(protectedStorage.serviceEvents, 0);
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
    catch(onRejected) {
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
    finally(onFinally) {
      return originalPromiseFinally.call(this.wrapped, onFinally);
    }
  }

  protectedStorage.bigBrother = {
    ...protectedStorage.bigBrother,
    TimedPromise: TimedPromise,
  };
});
