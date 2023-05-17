/**
 * All webGPU promises are to be placed in this global registry. So we can await them all.
 */

class WebGPUPromiseRegistry
{
  constructor()
  {
    this.promises = [];
  }

  /**
   * Add a promise to the registry, returns the newly registered promise.
   */
  add(promise)
  {
    this.promises.push(promise);
    return promise;
  }

  /**
   * Wait for all promises in the registry to settle, returning the results.
   */
  async waitAll()
  {
    return await Promise.allSettled(this.promises);
  }
}

module.exports.WebGPUPromiseRegistry = WebGPUPromiseRegistry;

self.wrapScriptLoading({ scriptName: 'webgpu-promise-registry' }, function WebGPUPromiseRegistry$$fn(protectedStorage) {
  protectedStorage.webGPUPromiseRegistry = new WebGPUPromiseRegistry();
});

