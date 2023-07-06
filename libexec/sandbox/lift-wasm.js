// lift WASM functions into our TimedPromise monad
// lift in the Haskell fmap/lift sense, mapping to a new category while preserving the structure (functionality)
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
