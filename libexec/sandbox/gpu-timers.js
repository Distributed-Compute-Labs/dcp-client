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
          interval.end();
        }
        catch(e)
        {
          interval.end();
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
    let time = 0;
    let t0;
    let mostRecentGPUQueueP = null;
    async function awaitGPUAndGetTime()
    {
      /* if gpu work exists to be done, ensure
         it all gets done before we get the final time measurement */
      while (mostRecentGPUQueueP)
      {
        await mostRecentGPUQueueP;
        await Promise.resolve();
      }

      const tmp = time;
      time = 0;
      return tmp;
    }
    protectedStorage.awaitGPUAndGetTime = awaitGPUAndGetTime;

    const originalSubmit = GPUQueue.prototype.submit;
    GPUQueue.prototype.submit = function(...args)
    {
      const submit = originalSubmit.bind(this);
      submit(...args);

      const queueP = this.onSubmittedWorkDone();
      if (!mostRecentGPUQueueP)
        t0 = Date.now();

      mostRecentGPUQueueP = queueP;
      queueP.then(() => {
        if (queueP !== mostRecentGPUQueueP)
          return /* another submit was run before submits to this point were finished, ignore this */
        else
        {
          time += Date.now() - t0;
          mostRecentGPUQueueP = null;
        }
      })
    }
  }

});
