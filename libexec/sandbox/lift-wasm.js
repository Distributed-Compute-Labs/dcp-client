/**
 *  @file       lift-wasm.js
 *              Copyright (c) 2023, Distributive, Ltd.
 *              All Rights Reserved. Licensed under the terms of the MIT License.
 *
 *              Makes WASM instantiation and parsing (which happens off the main thread) to be timed and recorded.
 *              Technically the streaming variants is a combination of IO and CPU, but we can't achieve that level of
 *              granularity, so they all get lumped into CPU time.
 *
 *  @author     Liang Wang, liang@distributive.network
 *  @date       July 2023
 */
self.wrapScriptLoading( { scriptName: 'lift-wasm' }, function wrapWasm$$fn(protectedStorage) {
  /** @typedef {import(./timer-classes.js).TimeInterval} TimeInterval*/
  const TimeInterval = protectedStorage.TimeInterval;
  /** @typedef {import(./timed-promise.js).TimedPromise} TimedPromise*/
  const TimedPromise = protectedStorage.bigBrother.TimedPromise;

  const putToCPUInterval = (duration) => {
    duration.stop();
    const intervals = protectedStorage.bigBrother.globalTrackers.cpuIntervals;
    intervals.push(duration);
  };

  const makeWrapped = (fn) => {
    return (...args) => {
      const duration = new TimeInterval();
      const originalPromise = new TimedPromise((resolve, _reject) => {
        resolve(fn(...args));
      });

      originalPromise.then(
        () => putToCPUInterval(duration),
        () => putToCPUInterval(duration)
      );
      return originalPromise;
    };
  };

  WebAssembly.instantiateStreaming
    = WebAssembly.instantiateStreaming ? makeWrapped(WebAssembly.instantiateStreaming) : undefined;
  WebAssembly.instantiate
    = WebAssembly.instantiate ? makeWrapped(WebAssembly.instantiate) : undefined;
  WebAssembly.compile
    = WebAssembly.compile ? makeWrapped(WebAssembly.compile) : undefined;
  WebAssembly.compileStreaming
    = WebAssembly.compileStreaming ? makeWrapped(WebAssembly.compileStreaming) : undefined;
});
