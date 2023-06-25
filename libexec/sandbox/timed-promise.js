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
"use strict"

self.wrapScriptLoading( { scriptName: "timed-promise" }, function timedPromise(protectedStorage) {
    const TimeInterval = protectedStorage.TimeInterval;


    /** @typedef {import("./event-loop-virtualization.js").FauxEvent} FauxEvent */

    // this is a type
    const FauxEvent = protectedStorage.FauxEvent;
    /** @type {Event[]} */
    const events = protectedStorage.events;
    const bonaFideSetTimeout = protectedStorage.bonaFideSetTimeout;
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
        switch (originTag) {
          // undefined is CPU, this occurs when the promise is generated from async await
          case undefined: {
            this.globalTracker.cpuIntervals.push(this.duration);
            // console.log("CPU time delta: " + this.duration.length);
            break;
          }
          case "WebGL":
          case "WASM": {
            throw new Error("Not implemented");
          }
          case "WebGPU": {
            this.globalTracker.webGPUIntervals.push(this.duration);
            // console.log("WebGPU time delta: " + this.duration.lenght);
            break;
          }
          case "ignore":
          default: {
            // ignore stuff we don't know about, sometimes we desire this because the timing might be measured in other
            // ways
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

        debugger;
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
        return (
          this.wrapped.then.call(this.wrapped, (resolvedValue) => {
            // force the continuation to kick off another round of event loop
            const continuation = (resolution) => onFulfilled(resolution);
            events.serial = Number(events.serial) + 1;
            const event = new FauxEvent(
              "timed-promise-continuation",
              continuation,
              [resolvedValue],
              performance.now(),
              undefined,
              events.serial
            );
            events.push(event);
            // console.debug(event);

            // exploit the fact that if the continuation of a `then` returns a promise, we get a Promose<T> rather than
            // Promise<Promise<T>>, this is the part of Promise that make it technically not a monad
            return new Promise((resolve, _reject) => {
              // yes this is very much a hack
              event.callback = resolve;
              bonaFideSetTimeout(protectedStorage.serviceEvents, 0);
            }).then(Promise.resolve(event.returnSlot));
          }),
          (rejectedReason) => {
            // force the continuation to kick off another round of event loop
            const continuation = (reason) => onRejected(reason);
            events.serial = Number(events.serial) + 1;
            const event = new FauxEvent(
              "timed-promise-continuation",
              continuation,
              [rejectedReason],
              performance.now(),
              undefined,
              events.serial
            );
            events.push(event);
            bonaFideSetTimeout(protectedStorage.serviceEvents, 0);

            // TODO: does it actually work with stupid exceptions?
            return new Promise((_resolve, reject) => {
              event.callback = reject;
              bonaFideSetTimeout(protectedStorage.serviceEvents, 0);
            }).then(Promise.reject(event.returnSlot));
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
        return this.wrapped.catch((rejectedReason) => {
          const continuation = (reason) => onRejected(reason);
          events.serial = Number(events.serial) + 1;
          const event = new FauxEvent(
            "timed-promise-continuation",
            continuation,
            rejectedReason,
            performance.now(),
            undefined,
            events.serial
          );
          events.push(event);

          // TODO: does it actually work with stupid exceptions?
          return new Promise((_resolve, reject) => {
            event.callback = reject;
            bonaFideSetTimeout(protectedStorage.serviceEvents, 0);
          }).then(Promise.reject(event.returnSlot));
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
      finally(onFinally) {
        // TODO: finally is some of the most stupid aspect of using exception as the general error handling mechanism
        throw new Error("Not implemented (yet)");
      }
    }

    protectedStorage.bigBrother = {
      ...protectedStorage.bigBrother,
      TimedPromise: TimedPromise,
    };
  }
);
