/**
 *  @file       gpu-timers.js
 *              Copyright (c) 2022, Distributive, Ltd.
 *              All Rights Reserved. Licensed under the terms of the MIT License.
 *
 *              This file adds wrappers for webGL and webGPU functions so we can measure their GPU time
 *
 *  @author     Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       July 2022
 */

/* global WebGPUWindow GPU */
// @ts-nocheck

self.wrapScriptLoading({ scriptName: 'gpu-timers' }, async function gpuTimers$fn(protectedStorage, ring2PostMessage)
{
  const webGLTimer = protectedStorage.timers.webGL;
  const webGPUTimer = protectedStorage.timers.webGPU;

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
    // Want to use the wrapped versions of these after all gpu functions are wrapped.
    const originalSubmit = GPUQueue.prototype.submit;
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

    GPUQueue.prototype.submit = function submit(...args)
    {
      const fn = originalSubmit.bind(this);
      fn(...args);

      const queueP = originalSubmitDone.bind(this)();
      const interval = new protectedStorage.TimeInterval();
      webGPUTimer.push(interval, queueP);

      queueP.then(() => {
        interval.stop();
      })
    }
  }

});
