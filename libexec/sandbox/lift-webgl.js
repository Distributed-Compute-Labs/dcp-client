/**
 *  @file       lift-webgl.js
 *              Copyright (c) 2022-2023, Distributive, Ltd.
 *              All Rights Reserved. Licensed under the terms of the MIT License.
 *
 *              This file adds wrappers various classes/functions that may have different requirements in order to accurately time them.
 *              Includes:
 *                - timer for webGL functions
 *
 *  @author     Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       Aug 2022
 */

/**
 * @typedef {import('./event-loop-virtualization').GlobalTracker} GlobalTracker
 */

self.wrapScriptLoading({ scriptName: 'lift-webgl' }, async function gpuTimers$fn(protectedStorage, ring2PostMessage)
{
  const globalTrackers = protectedStorage.bigBrother.globalTrackers;
  const webGLTimer = globalTrackers.webGLIntervals;


  protectedStorage.getAndResetWebGLTimer = function getAndResetWebGLTimer()
  {
    const time = webGLTimer.length;
    webGLTimer.reset();
    return time;
  }

  /**
   * @returns {boolean} 
   */
  protectedStorage.hasWebglSupport = function hasWebglSupport()
  {
    try
    {
      const canvas = new OffscreenCanvas(1, 1);
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


  if (self.OffscreenCanvas && new OffscreenCanvas(1, 1))
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
        catch (error)
        {
          interval.stop();
          throw error;
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
});
