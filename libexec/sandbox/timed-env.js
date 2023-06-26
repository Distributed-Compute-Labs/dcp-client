/**
 *  @file       unique-timing.js
 *              Copyright (c) 2022, Distributive, Ltd.
 *              All Rights Reserved. Licensed under the terms of the MIT License.
 *
 *              This file adds wrappers various classes/functions that may have different requirements in order to accurately time them.
 *              Includes:
 *                - timer for webGL functions
 *                - timer for webGPU functions
 *                - wrapper to webGPU and WebAssembly functions that may cause the event loop to start from
 *                  a different thread (ie after WebAssembly compiling) to ensure our CPU timing can pick up
 *                  and continue proper measurement.
 *
 *  @author     Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       Aug 2022
 */

/* global GPUQueue
 */


/**
 * @typedef {import('./event-loop-virtualization').GlobalTracker} GlobalTracker
 */

self.wrapScriptLoading({ scriptName: 'timed-env' }, async function gpuTimers$fn(protectedStorage, ring2PostMessage)
{
  const TimedPromise = protectedStorage.bigBrother.TimedPromise;
  const TimeInterval = protectedStorage.TimeInterval;
  const globalTrackers = protectedStorage.bigBrother.globalTrackers;
  const webGLTimer = globalTrackers.webGLIntervals;
  const wasmTimer = globalTrackers.wasmIntervals;
  const cpuTimer = globalTrackers.cpuIntervals;
  const webGPUTimer = globalTrackers.webGPUIntervals;
  

  protectedStorage.getAndResetWebGLTimer = function getAndResetWebGLTimer()
  {
    const time = webGLTimer.length;
    webGLTimer.reset();
    return time;
  }

  /**
   * @returns {boolean} 
   */
  protectedStorage.hasWebglSupport = function webglSupport() {
    try
    {
      const canvas = new OffscreenCanvas(1,1);
      return Boolean(canvas.getContext('webgl') || canvas.getContext('webgl2'));
    }
    catch
    {
      return false;
    }
  };

  if (protectedStorage.hasWebglSupport())
    protectedStorage.getAndResetWebGLTimer = function getAndResetWebGLTimer()
    {
      const time = webGLTimer.length;
      webGLTimer.reset();
      return time;
    }



  // lift WASM functions into our TimedPromise monad
  // lift in the Haskell fmap/lift sense, mapping to a new category while preserving the structure (functionality)
  function liftWASMFunction(fn)
  {
    // console.assert(typeof fn === 'function' && fn() instanceof Promise, 'liftWASMFunction expects a function that returns a promise');
    return function(...args)
    {
      return new TimedPromise(globalTrackers, fn.bind(this, ...args), 'WASM');
    }
  }
  
  // lift WebGPU functions except for submit and onSubmittedWorkDone that returns a promise into our TimedPromise monad
  function liftWebGPUFunction(fn)
  {
    // console.assert(typeof fn === 'function' && fn() instanceof Promise, 'liftWebGPUFunction expects a function that returns a promise');
    return function(...args)
    {
      return new TimedPromise(globalTrackers, fn.bind(this, ...args), 'WebGPU');
    }
  }

  // TODO: unify the two names
  function wrapWebGPUFunction(fn)
  {
    return function(...args)
    {
      // TODO: improve TimeInterval API
      const webGPUIntervals = webGPUTimer;

      const duration = new TimeInterval();
      const ret = fn.call(this, ...args);
      duration.stop();
 
      webGPUIntervals.push(duration);
      return ret;
    }
  }

  /**
   * @todo: update the doc, it's not true anymore
   * Given a class, map all functions that return a promise into our TimerMonad, which still implements the
   * thennable interface, meaning it looks like a promise, swims like a promise, and quacks like a promise but
   * has the added benefit of timing the promise. 
   *
   */
  function liftWebGPUPrototype(GPUClass)
  {
    // the standard dictates these functions will return promises
    const promiseReturningFunctions = new Set([
      'requestDevice',
      'requestAdapterInfo',
      'createComputePipelineAsync',
      'createRenderPipelineAsync',
      'mapAsync',
      'getCompilationInfo',
      'onSubmittedWorkDone',
      // 'lost', // would not be fair to charge them for monitoring if the device got lost
      'popErrorScope',
      'requestAdapter',
    ]);

    // TODO: consider what to do with 'destory'
    // while they appear to be blocking, the meat of the work happens on the gpu driver thread
    const blockingFunctions = new Set([
      // GPU
      'getPrefferedCanvasFormat',

      // GPUDevice
      'createBuffer',
      'createTexture',
      'createSampler',
      'importExternalTexture',
      'createBindGroupLayout',
      'createPipelineLayout',
      'createBindGroup',
      'createShaderModule',
      'createComputePipeline',
      'createRenderPipeline',
      'createCommandEncoder',
      'createRenderBundleEncoder',
      'createQuerySet',

      // GPUBuffer 
      'getMappedRange',
      'unmap',

      // GPUTexture
      'createView',

      // GPUPipelineBase 
      'getBindGroupLayout',

      // GPUDebugCommandsMixin 
      'pushDebugGroup',
      'popDebugGroup',
      'insertDebugWorker',

      // GPUCommandEncoder
      'beginRenderPass',
      'beginComputePass',
      'copyBufferToBuffer',
      'copyBufferToTexture',
      'copyTextureToBuffer',
      'copyTextureToTexture',
      'clearBuffer',
      'writeTimestamp',
      'resolveQuerySet',
      'finish',

      // GPUBindingsCommandMixin
      'setBindGroup',

      // GPUComputePassEncoder
      'setPipeline',
      'dispatchWorkgroups',
      'dispatchWorkgroupsIndirect',
      'end',

      // GPURenderPassEncoder
      'setViewPort',
      'setScissorRect',
      'setBlendConstant',
      'setStencilReference',
      'beginOcclusionQuery',
      'endOcclusionQuery',
      'executeBundles',
      'end',

      // GPURenderCommandsMixin
      'setPipeline',
      'setIndexBuffer',
      'draw',
      'drawIndexed',
      'drawIndirect',
      'drawIndexedIndirect',

      // GPURenderBundleEncoder
      'finish',

      // GPUCanvasContext
      'configure',
      'unconfigure',

      // GPUQueue
      'writeBuffer',
      'writeTexture',
      'copyExternalImageToTexture',

      'pushErrorScope',
    ]);

    // Iterating through all things 'GPU' on global object, some may not be classes. Skip those without a prototype.
    if (!self[GPUClass].prototype)
      return;

    // const wrappedPromiseReturningFunctions = Object.keys(self[GPUClass].prototype)
    //   .filter((prop) => promiseReturningFunctions.has(prop))
    //   .map((prop) => self[GPUClass].prototype[prop])
    //   .map((fn) => liftWebGPUFunction(fn));
    //
    // const wrappedBlockingFunctions = Object.keys(self[GPUClass].prototype)
    //   .filter((prop) => blockingFunctions.has(prop))
    //   .map((prop) => self[GPUClass].prototype[prop])
    //   .map((fn) => wrapWebGPUFunction(fn));

    // self[GPUClass].prototype = { ...self[GPUClass].prototype, wrappedBlockingFunctions, wrappedPromiseReturningFunctions };
    for (let prop of Object.keys(self[GPUClass].prototype))
    {
      // lift the function into our GPUTimingPromise monad
      if (promiseReturningFunctions.has(prop))
      {
        const fn = self[GPUClass].prototype[prop];
        self[GPUClass].prototype[prop] = liftWebGPUFunction(fn);
      }
      else if (blockingFunctions.has(prop))
      {
        const fn = self[GPUClass].prototype[prop];
        self[GPUClass].prototype[prop] = wrapWebGPUFunction(fn);
      }
    }
  }

  if (self.OffscreenCanvas && new OffscreenCanvas(1,1))
  {
    /**
     *  Wrap webGL function for a given context. The wrapper will add a time interval to the
     *  webGLTimer that measures the execution time of the function run.
     * 
     * @param {obj} context - the OffscreenCanvas context for which a function needs to be wrapped
     * @param {string} prop - property of the context to be wrapped 
     */
    function timeWebGLFunction(context, prop)
    {
      const originalFn = context[prop].bind(context);
      
      context[prop] = function wrappedWebGLFunction(...args)
      {
        let returnValue;
        const interval = new protectedStorage.TimeInterval();
        webGLTimer.push(interval);
        try
        {
          returnValue =  originalFn(...args);
          interval.stop();
        }
        catch(e)
        {
          interval.stop();
          throw e;
        }
        return returnValue;
      }
    }
  
    /* Update all functions on the OffscreenCanvas getContext prototype to have timers */
    const oldGetContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function(type, options)
    {
      const context = oldGetContext.bind(this)(type, options);
      for (const key of Object.getOwnPropertyNames(context.__proto__))
        if (typeof context[key] === 'function')
          timeWebGLFunction(context, key);
      return context;
    };
  }

  if (!navigator.gpu)
    return;

  // Want to use the wrapped versions of these after all gpu functions are wrapped.
  const originalGPUQueue = GPUQueue;
  const originalSubmit = GPUQueue.prototype.submit;
  const originalSubmitDone = GPUQueue.prototype.onSubmittedWorkDone;
  

  // some of them will get re-wrapped, that's fine, we always refer to the original function
  const requiredWrappingGPUClasses = [
    'GPU',
    'GPUAdapter',
    'GPUDevice',
    'GPUBuffer',
    'GPUTexture',
    'GPUShaderModule',
    'GPUComputePipeline',
    'GPURenderPipeline',
    'GPUCommandEncoder',
    'GPUComputePassEncoder',
    'GPURenderPassEncoder',
    'GPURenderBundleEncoder',
    'GPUQueue',
    'GPUQuerySet',
    'GPUCanvasContext',
  ];

  // TODO: do we know the queue always point to the same one?
  // currently, the only queue exposed is the default queue
  const defaultQueue = await (async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    return device.queue;
  })();

  if (defaultQueue)
    globalTrackers.webGPUQueueRegistery.add(defaultQueue);

  requiredWrappingGPUClasses.forEach(liftWebGPUPrototype);

  GPUQueue.prototype.constructor = function ctor(...args) {
    const queueConstructor = originalGPUQueue.bind(this);
    const queue = new queueConstructor(...args);

    // always register the queue with the global tracker
    globalTrackers.webGPUQueueRegistery.add(queue);

    return queue;
  }

 
  // TODO: add doc
  GPUQueue.prototype.onSubmittedWorkDone = function onSubmittedWorkDone(...args)
  {
    const fn = originalSubmitDone.bind(this);
    return new TimedPromise(globalTrackers, () => fn(...args), 'ignore');
  }


  // our submit keeps a global tracker of all submissions, so we can track the time of each submission 
  GPUQueue.prototype.submit = function submit(...args)
  {
    // TODO: find out what determines the identity of GPUQueues
    const queue = this;
    // TODO: addSumbission also does the job of actually calling submit on the original queue, should it?
    return globalTrackers.webGPUQueueRegistery.addSubmission(
      queue,
      ...args
    );
  }
});
