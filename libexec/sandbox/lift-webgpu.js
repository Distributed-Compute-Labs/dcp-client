self.wrapScriptLoading({ scriptName: 'lift-webgpu' }, function nativeEventLoop$$fn(protectedStorage, ring0PostMessage) {
  /** @todo think of cleaner way to do detection */
  if (!('gpu' in navigator))
    return;

  const TimedPromise = protectedStorage.bigBrother.TimedPromise;
  const TimeInterval = protectedStorage.TimeInterval;
  const globalTrackers = protectedStorage.bigBrother.globalTrackers;
  const webGLTimer = globalTrackers.webGLIntervals;
  const wasmTimer = globalTrackers.wasmIntervals;
  const cpuTimer = globalTrackers.cpuIntervals;
  const webGPUTimer = globalTrackers.webGPUIntervals;

  // lift WebGPU functions except for submit and onSubmittedWorkDone that returns a promise into our TimedPromise monad
  function liftWebGPUFunction(fn)
  {
    // console.assert(typeof fn === 'function' && fn() instanceof Promise, 'liftWebGPUFunction expects a function that returns a promise');
    return function(...args)
    {
      const duration = new TimeInterval();
      const that = this;

      const original = new TimedPromise((resolve) =>
      {
        const ret = fn.call(that, ...args);
        resolve(ret);
      });
      
      const recordTime = () => {
        duration.stop();
        webGPUTimer.push(duration);
      };

      original.then(recordTime, recordTime);
      return original;
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

  // Want to use the wrapped versions of these after all gpu functions are wrapped.
  const originalGPUQueue = GPUQueue;
  const originalSubmit = GPUQueue.prototype.submit;
  const originalSubmitDone = GPUQueue.prototype.onSubmittedWorkDone;
  const originalRequestDevice = GPUAdapter.prototype.requestDevice;

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

  requiredWrappingGPUClasses.forEach(liftWebGPUPrototype);

  // currently, the only queue exposed is the default queue
  GPUAdapter.prototype.requestDevice = async function(...args)
  {
    const device = await originalRequestDevice.call(this, ...args);
    globalTrackers.webGPUQueueRegistery.add(device.queue);
    return device;
  }

  GPUQueue.prototype.constructor = function ctor(...args)
  {
    const queueConstructor = originalGPUQueue.bind(this);
    const queue = new queueConstructor(...args);

    // always register the queue with the global tracker
    globalTrackers.webGPUQueueRegistery.add(queue);

    return queue;
  }


  // TODO: add doc
  GPUQueue.prototype.onSubmittedWorkDone = function onSubmittedWorkDone(...args)
  {
    const duration = new TimeInterval();
    const that = this;

    const original = new TimedPromise((resolve) => {
      const ret = originalSubmitDone.call(that, ...args);
      resolve(ret);
    });

    const recordTime = () => {
      duration.stop();
      webGPUTimer.push(duration);
    };

    original.then(recordTime, recordTime);
    return original;
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

