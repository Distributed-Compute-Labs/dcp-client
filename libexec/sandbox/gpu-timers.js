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
    const originalSubmit = GPUQueue.prototype.submit;
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

});
