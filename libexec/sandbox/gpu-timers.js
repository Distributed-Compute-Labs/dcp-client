/**
 *  @file       gpu-timers.js
 *              Copyright (c) 2018, Kings Distributed Systems, Ltd.  All Rights Reserved. @todo: is this correct lol?
 *
 *              This file adds wrappers for webGL and webGPU functions so we can measure their GPU time
 *
 *  @author     Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       July 2022
 */

/* global WebGPUWindow GPU */
// @ts-nocheck

self.wrapScriptLoading({ scriptName: 'gpu-timers' }, function gpuTimers$fn(protectedStorage, ring2PostMessage)
{
  if (OffscreenCanvas && new OffscreenCanvas(1,1))
  {
    let time = 0;
    function getAndResetWebGLTimer()
    {
      const tmp = time;
      time = 0;
      return tmp;
    }
    protectedStorage.getAndResetWebGLTimer = getAndResetWebGLTimer;

    function timeWebGLFactory(context, prop)
    {
      let originalFn = context[prop].bind(context);
      
      context[prop] = function wrappedWebGLFunction(...args)
      {
        var returnValue;
        const start = performance.now();
        try
        {
          returnValue =  originalFn(...args);
          time += performance.now() - start;
        }
        catch(e)
        {
          time += performance.now() - start;
          throw e;
        }
        return returnValue;
      }
    }
  
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

});
