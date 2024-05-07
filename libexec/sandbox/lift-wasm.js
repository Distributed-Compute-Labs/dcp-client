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

  /**
   * Add an interval to the CPU time measurement.
   * wasm instantiation happens off-thread, but is CPU bound, so we need to measure the time it takes
   * independently of our normal CPU time measurement
   */
  function addCPUInterval (duration)
  {
    duration.stop();
    const intervals = protectedStorage.bigBrother.globalTrackers.cpuIntervals;
    intervals.push(duration);
  }

  const timingWrapperFactory = function timingWrapperFactory (fn) {
    if (arguments[0] == undefined)
      return undefined;

    return function liftWasm$$makeWrapped (...args) {
      const duration = new TimeInterval();
      const originalPromise = fn(...args);

      originalPromise.finally(() => addCPUInterval(duration));
      return originalPromise;
    };
  };

  WebAssembly.instantiateStreaming = timingWrapperFactory(WebAssembly.instantiateStreaming);
  WebAssembly.instantiate = timingWrapperFactory(WebAssembly.instantiate);
  WebAssembly.compile = timingWrapperFactory(WebAssembly.compile);
  WebAssembly.compileStreaming = timingWrapperFactory(WebAssembly.compileStreaming);
});
