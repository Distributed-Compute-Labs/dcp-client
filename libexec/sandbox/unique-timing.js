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

  // WebAssembly doesn't have a prototype, can't use the factory the same way. But WebAssembly's spec is finalized so we don't need to be as general as for webGPU
  for (const prop of Object.keys(WebAssembly))
  {
    const fn = WebAssembly[prop];
    WebAssembly[prop] = function timerWrapper(...args)
    {
      var unwrappedReturn =  fn.bind(this)(...args);
      if (unwrappedReturn instanceof Promise)
        return new Promise((resolve, reject) => {
          unwrappedReturn.then(
            (res) => setImmediate(() => resolve(res)),
            (rej) => setImmediate(() => reject(rej)));
        });
      return unwrappedReturn;
    }
  }

  /**
   * Given a class, wrap all functions in that class so.
   * The wrapper will not change the function if the function returns a value.
   * If the function returns a promise, wrap the return value with another promise, so that
   * when the original promise resolves or rejects, setImmediate will be called to resolve the
   * wrapping promise. This causes the promise resolution to spend a moment on the event loop,
   * allowing timing code to know the promise resolution occurred.
   */
  function wrapPrototypeFunctions(GPUClass)
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

      // If the function returns a promise, wrap it with setImmediate. Triggers restart of CPU measurement.
      self[GPUClass].prototype[prop] = function timerWrapper(...args)
      {
        const fn = originalFn.bind(this);
        const returnValue =  fn(...args);
        if (returnValue instanceof Promise)
          return new Promise((resolve, reject) => {
            returnValue
            .then((res) => setImmediate(() => resolve(res)))
            .catch((rej) => setImmediate(() => reject(rej)));
          });
        return returnValue;
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
          returnValue = originalFn(...args);
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
    return

  // Want to use the wrapped versions of these after all gpu functions are wrapped.
  const originalSubmit = GPUQueue.prototype.submit;
  const originalSubmitDone = GPUQueue.prototype.onSubmittedWorkDone;

  for (const key of Object.getOwnPropertyNames(self))
  {
    if (key.startsWith('GPU'))
    wrapPrototypeFunctions(key);
  }

  GPUQueue.prototype.submit = function submit(...args)
  {
    const fn = originalSubmit.bind(this);
    fn(...args);

    const queueP = originalSubmitDone.bind(this)();
    const interval = new protectedStorage.TimeInterval();
    webGPUTimer.push({ interval, queueP });

    queueP.then(() => {
      interval.stop();
    });
  }
});
