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
  const globalTracker = protectedStorage.bigBrother.globalTracker;
  const webGLTimer = globalTracker.webGLIntervals;
  const wasmTimer = globalTracker.wasmIntervals;
  const cpuTimer = globalTracker.cpuIntervals;
  const webGPUTimer = globalTracker.webGPUIntervals;

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

  function threadedWrapperFactory(Class)
  // WebAssembly doesn't have a prototype, can't use the factory the same way. But WebAssembly's spec is finalized so we don't need to be as general as for webGPU
  for (const prop of Object.keys(WebAssembly))
  {
    const fn = WebAssembly[prop];
    WebAssembly[prop] = function timerWrapper(...args)
    {
      var returnValue =  fn.bind(this)(...args);
      if (returnValue instanceof Promise)
        return new Promise((resolve, reject) => {
          returnValue.then(
            (res) => setImmediate(() => resolve(res)),
            (rej) => setImmediate(() => reject(rej)));
        });
      return returnValue;
    }
  }


  // lift WASM functions into our TimedPromise monad
  // lift in the Haskell fmap/lift sense, mapping to a new category while preserving the structure (functionality)
  function liftWASMFunction(fn)
  {
    console.assert(typeof fn === 'function' && fn() instanceof Promise, 'liftWASMFunction expects a function that returns a promise');
    return function(...args)
    {
      return new TimedPromise(globalTracker, fn.bind(this, ...args), 'WASM');
    }
  }
  
  // lift WebGPU functions except for submit and onSubmittedWorkDone that returns a promise into our TimedPromise monad
  function liftWebGPUFunction(fn)
  {
    console.assert(typeof fn === 'function' && fn() instanceof Promise, 'liftWebGPUFunction expects a function that returns a promise');
    return function(...args)
    {
      return new TimedPromise(globalTracker, fn.bind(this, ...args), 'WebGPU');
    }
  }


  /**
   * Given a class, map all functions that return a promise into our TimerMonad, which still implements the
   * thennable interface, meaning it looks like a promise, swims like a promise, and quacks like a promise but
   * has the added benefit of timing the promise. 
   *
   */
  function liftWebGPUPrototypePromises(GPUClass)
  {
    // Iterating through all things 'GPU' on global object, some may not be classes. Skip those without a prototype.
    if (!self[GPUClass].prototype)
      return;

    for (let prop of Object.keys(self[GPUClass].prototype))
    {
      let originalFn;
      try
      {
        originalFn = self[GPUClass].prototype[prop];
        if (originalFn instanceof Promise)
        {
          originalFn.catch(() => {/* accessing properties from class constructors can be dangerous in weird ways */})
          continue;
        }
        if (typeof originalFn !== 'function')
          continue;
      }
      catch(e)
      {
        // The property can't be invoked, so must be a property (like 'name'). Don't need to wrap it.
        continue;
      }

      // lift the function into our GPUTimingPromise monad
      self[GPUClass].prototype[prop] = liftWebGPUFunction(originalFn);
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
  
  // this classes contain functions that can return promises, so we need to wrap them
  const requiredWrappingGPUClasses = [
    'GPU',
    'GPUAdapter',
    'GPUDevice',
    'GPUBuffer',
    'GPUShaderModule',
    'GPUQueue',
  ];


  // ensure we can time all the webGPU functions that return promises
  const globalProperties = Object.getOwnPropertyNames(self);
  console.assert(requiredWrappingGPUClasses.every((className) => globalProperties.includes(className)));

  requiredWrappingGPUClasses.forEach(liftWebGPUPrototypePromises);

  // TODO: not complete yet, webGPU comes with an default queue, need to wrap that also 
  GPUQueue.prototype.constructor = function ctor(...args) {
    const queueConstructor = originalGPUQueue.bind(this);
    const queue = new queueConstructor(...args);

    // always register the queue with the global tracker
    globalTracker.webGPUQueueRegistery.add(queue);

    return queue;
  }

 
  // TODO: add doc
  GPUQueue.prototype.onSubmittedWorkDone = function onSubmittedWorkDone(...args)
  {
    const fn = originalSubmitDone.bind(this);
    const queueLabel = this.label;
    const onSubmittedWorkDoneContext = new WebGPUOnComplete({ queueLabel });

    return new TimedPromise(globalTracker, () => fn(...args), onSubmittedWorkDoneContext);
  }


  // our submit keeps a global tracker of all submissions, so we can track the time of each submission 
  GPUQueue.prototype.submit = function submit(...args)
  {
    const queueLabel = this.label;
    // TODO: addSumbission also does the job of actually calling submit on the original queue, should it?
    return globalTracker.webGPUQueueRegistery.addSubmission(
      queueLabel,
      ...args
    );
  }
});
