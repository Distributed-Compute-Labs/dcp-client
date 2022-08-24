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

/* global WebGPUWindow GPU */
// @ts-nocheck

self.wrapScriptLoading({ scriptName: 'gpu-timers' }, async function gpuTimers$fn(protectedStorage, ring2PostMessage)
{
  const webGLTimer = protectedStorage.timers.webGL;
  const webGPUTimer = protectedStorage.timers.webGPU;

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
  {

    // Iterating through all things 'GPU' on global object, some may not be classes. Skip those without a prototype.
    if (!self[Class].prototype)
      return;

    for (let prop of Object.keys(self[Class].prototype))
    {
      let originalFn;
      try
      {
        originalFn = self[Class].prototype[prop];
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

      // If the function returns a promise, wrap it with setImmediate. Triggers restart of CPU measurement.
      self[Class].prototype[prop] = function timerWrapper(...args)
      {
        const fn = originalFn.bind(this);
        var returnValue =  fn(...args);
        if (returnValue instanceof Promise)
          return new Promise((resolve, reject) => {
            returnValue.then(
              (res) => setImmediate(() => resolve(res)),
              (rej) => setImmediate(() => reject(rej)));
          });
        return returnValue;
      }
    }
  }

  if (self.OffscreenCanvas && new OffscreenCanvas(1,1))
  {

    /* Factory to wrap a function from a context with a timer */
    function timeWebGLFactory(context, prop)
    {
      let originalFn = context[prop].bind(context);
      
      context[prop] = function wrappedWebGLFunction(...args)
      {
        var returnValue;
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
    let oldGetContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function(type, options)
    {
      let context = oldGetContext.bind(this)(type, options);
      for (let key of Object.getOwnPropertyNames(context.__proto__))
        if (typeof context[key] === 'function')
          timeWebGLFactory(context, key);
      return context;
    };
  }

  if (navigator.gpu)
  {
    const originalSubmit = GPUQueue.prototype.submit;
<<<<<<<< HEAD:libexec/sandbox/unique-timing.js
    const originalSubmitDone = GPUQueue.prototype.onSubmittedWorkDone;

    for (let key of Object.getOwnPropertyNames(self))
    {
      if (key.startsWith('GPU'))
      threadedWrapperFactory(key);
    }

|||||||| constructed merge base:libexec/sandbox/gpu-timers.js
    const originalSubmitDone = GPUQueue.prototype.onSubmittedWorkDone;

    function webGPUWrapperFactory(webGPUClass)
    {

      // Iterating through all things 'GPU' on global object, some may not be classes. Skip those without a prototype.
      if (!self[webGPUClass].prototype)
        return;

      for (let prop of Object.keys(self[webGPUClass].prototype))
      {
        let originalFn;
        try
        {
          originalFn = self[webGPUClass].prototype[prop];
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

        // If the function returns a promise, wrap it with setImmediate. Triggers restart of CPU measurement.
        self[webGPUClass].prototype[prop] = function webGPU(...args)
        {
          const fn = originalFn.bind(this);
          var returnValue =  fn(...args);
          if (returnValue instanceof Promise)
            return new Promise((resolve, reject) => {
              returnValue.then(
                (res) => setImmediate(() => resolve(res)),
                (rej) => setImmediate(() => reject(rej)));
            });
          return returnValue;
        }
      }
    }

    for (let key of Object.getOwnPropertyNames(self))
    {
      if (key.startsWith('GPU'))
        webGPUWrapperFactory(key);
    }

========
>>>>>>>> Evaluator: change 'gpu-timers' to 'unique-timing':libexec/sandbox/gpu-timers.js
    GPUQueue.prototype.submit = function submit(...args)
    {
      const submit = originalSubmit.bind(this);
      submit(...args);

      const queueP = this.onSubmittedWorkDone();
      const interval = new protectedStorage.TimeInterval();
      webGPUTimer.push(interval, queueP);

      queueP.then(() => {
        interval.stop();
      })
    }

    const originalMap = GPUBuffer.prototype.mapAsync;
    GPUBuffer.prototype.mapAsync = function mapAsync(...args)
    {
      const mapAsync = originalMap.bind(this);
      const p = mapAsync(...args);

      // Use setImmediate to resolve the map to ensure we are able to restart our timing.
      return new Promise( (resolve, reject) => {
        p.then(res => setImmediate(() => resolve(res), 0));
      });
    }

  }

  debugger;

});
