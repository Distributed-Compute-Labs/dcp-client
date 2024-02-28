/**
 *  @file       lift-webgpu.js
 *              Copyright (c) 2023, Distributive, Ltd.
 *              All Rights Reserved. Licensed under the terms of the MIT License.
 *              
 *              In short, after running this file. WebGPU usage is tracked within reasonable grounds without hooking into
 *              the runtime directly *and* without using `timestamp-query` feature as most implementation do not support
 *              such feature.
 *
 *              WebGPU standard defines three timelines, content, queue, and device. Each of them can be thought of as
 *              one mode of operation. They require different strategies for timing.
 *
 *              Content timeline is just fancy speak for JS thread, we can ignore that since it's handled somewhere
 *              else.
 *              
 *              Device timeline is mostly the GPU driver thread that is invisible to the user. Most functions that
 *              primarily operate on the device timeline do not return promises and look blocking from the perspective
 *              of the javascript thread. These are simple to time, no different than how you might measure any other
 *              blocking functions; the only practical differences is they ought to be considered as gpu usage.
 *
 *              Queue timeline is the meat of where GPU work occurs. They represent computations that occur on the GPU
 *              directly. Most functions that operate on the queue timeline return promises, as you don't know when will
 *              the computation finish, otherwise why bother running the computation if you already know the result. 
 *              
 *              The standard is very clear on *not* providing much guarantee on what order these promises will resolve.
 *              See https://www.w3.org/TR/webgpu/#asynchrony. Fortunately, most of the functions don't carry much
 *              information across two calls and the timing can simply done via intercepting the resolution and
 *              recording how long for the promise to resolve.
 *
 *              The difficult bit lies in `GPUQueue.submit`. It submits a workload onto GPU and nothing else. The GPU
 *              will start executing the work whenever it finds appropriate. In other words, the function solely 
 *              exists to perform side effects and side effects make everything more ugly. However, if programs do not
 *              perform side effects, then they're mostly useless.
 *              
 *              This begs the question, how are computation result observed in webGPU? It's actually no different than
 *              how many computation is observed on hardware. You check an memory address *when the computation* is
 *              done. If you know which buffer the result will be written to and you know the last command to
 *              write to that buffer has been submitted. The resolution of `mapAsync` of that buffer will indicate the
 *              completion of that command.
 *
 *              The strategy above should be the most accurate without using `timestamp-query`. Sadly this requires
 *              building a graph of dependencies from command, bind groups, and shaders to buffers and knowing when will
 *              the completion of mapAsync denote the completion the series of commands. Instead, we take a simpler
 *              strategy but relying on `onSubmittedWorkDone`.
 *
 *              `onSubmittedWorkDone` is somewhat special among the promise returning functions in webGPU. The standard
 *              guarantees two things:
 *              1. The resolution of `onSubmittedWorkDone` is FIFO with respect to the order of call of `submit`
 *              2. The resolution of `onSubmittedWorkDone` always guarantees the resolution of `mapAync` that touched
 *              the buffer
 *
 *              Hence the strategy is as follows:
 *              1. Start a timer when user submits any work onto the GPU queue
 *              2. Immediately call `onSubmittedWorkDone`, without awaiting/blocking
 *              3. Upon the resolution of `onSubmittedWorkDone`, stop the timer and update our tracking
 *              4. Rinse and repeat.
 *
 *              This will be transparent to the user since we start our call immediately after they submit, when they
 *              call onSubmittedWorkDone later, ours will go on the micro task queue before due to the ordering of
 *              micro task queue.
 *
 *  @author     Liang Wang, liang@distributive.network
 *  @date       May 2023
 */
self.wrapScriptLoading({ scriptName: 'lift-webgpu' }, function liftWebGPU$$fn(protectedStorage, ring0PostMessage) {
  if ((typeof navigator === 'undefined') || !('gpu' in navigator))
    return;

  const TimeInterval = protectedStorage.TimeInterval;
  const globalTrackers = protectedStorage.bigBrother.globalTrackers;
  const webGPUTimer = globalTrackers.webGPUIntervals;

  /**
   * Factories to create wrappers for all webGPU function (except submit & onSubmittedWorkDone) to time them when they
   * are run, recording the duration of the function calls on the webGPU timer.
   */
  function webGPUAsyncTimingFactory(fn)
  {
    return function promiseWebGPUWrapper(...args)
    {
      const duration = new TimeInterval();
      const original = fn.apply(this, args);
      original.finally(() => webGPUTimer.push(duration.stop()));
      return original;
    }
  }

  function webGPUSyncTimingFactory(fn)
  {
    return function syncWebGPUWrapper(...args)
    {
      const duration = new TimeInterval();
      const ret = fn.apply(this, args);
      webGPUTimer.push(duration.stop());
      return ret;
    }
  }

  /**
   * Wrap various webGPU functions such that their usage will be tracked
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
      'mapAsync', // this would overestimate in some cases, a potential discussion
      'getCompilationInfo',
      'onSubmittedWorkDone',
      'popErrorScope',
      'requestAdapter',
    ]);

    // TODO: consider what to do with 'destroy'
    // while they appear to be blocking, the meat of the work happens on the gpu driver thread
    const blockingFunctions = new Set([
      // GPU
      'getPreferedCanvasFormat',

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

    for (let prop of Object.keys(self[GPUClass].prototype))
    {
      if (promiseReturningFunctions.has(prop))
      {
        const fn = self[GPUClass].prototype[prop];
        self[GPUClass].prototype[prop] = webGPUAsyncTimingFactory(fn);
      }
      else if (blockingFunctions.has(prop))
      {
        const fn = self[GPUClass].prototype[prop];
        self[GPUClass].prototype[prop] = webGPUSyncTimingFactory(fn);
      }
    }
  }

  // Want to use the original of these after all gpu functions are wrapped.
  const underlyingGPUQueue = GPUQueue;
  const underlyingGPUQueueProto = GPUQueue.prototype;
  const underlyingOnSubmittedWorkDone = GPUQueue.prototype.onSubmittedWorkDone;
  const underlyingSubmit = GPUQueue.prototype.submit;
  const underlyingRequestDevice = GPUAdapter.prototype.requestDevice;
  const underlyingDestroy = GPUDevice.prototype.destroy;

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

  let locked = false;
  const gpuQueueRegistry = [];
  protectedStorage.webGPU = {
    lock: () => { locked = true; },
    unlock: () => { locked = false; },
    waitAllCommandToFinish: () => { return Promise.allSettled(gpuQueueRegistry.map((q) => q.onSubmittedWorkDone())); },
  };

  // currently, the only queue exposed is the default queue
  GPUAdapter.prototype.requestDevice = async function requestDevice(...args)
  {
    const device = await underlyingRequestDevice.call(this, ...args);
    gpuQueueRegistry.push(device.queue);
    return device;
  }

  /**
   * Redefine GPUQueue constructor in order to add the queue to our webGPUQueueRegistry.
   * Need to redefine the `GPUQueue` function for instanceof checks to work with the changed constructor,
   * then add the original prototype to the new object. 
   */
  GPUQueue = function GPUQueue$$constructor(...args)
  {
    const queue = new underlyingGPUQueue(...args);
    gpuQueueRegistry.push(queue);
    return queue;
  }
  GPUQueue.prototype = underlyingGPUQueueProto;
  GPUQueue.prototype.constructor = GPUQueue;

  // our submit keeps a global tracker of all submissions, so we can track the time of each submission 
  GPUQueue.prototype.submit = function submit(commandBuffers)
  {
    if (locked)
      throw new Error('Attempted to submit webGPU queue after work function resolved');
    underlyingSubmit.call(this, commandBuffers);

    const submitTime = performance.now();
    underlyingOnSubmittedWorkDone.call(this).then(() => {
      const completedAt = performance.now();
      const duration = new TimeInterval();
      duration.overrideInterval(submitTime, completedAt);
      webGPUTimer.push(duration);
    });
  }

  GPUDevice.prototype.destroy = function destroy()
  {
    const idx = gpuQueueRegistry.indexOf(this.queue);
    gpuQueueRegistry.splice(idx);
    underlyingDestroy.call(this);
  }
});

