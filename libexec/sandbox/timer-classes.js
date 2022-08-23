/**
 *  @file       timer-classes.js
 *              This file creates classes that will be required for timing.
 * 
 * @author  Ryan Saweczko <ryansaweczko@kingsds.network>
 * @date    Aug 2022
 */

/* global self, bravojs, addEventListener, postMessage */
// @ts-nocheck

self.wrapScriptLoading({ scriptName: 'timer-classes' }, function timerClasses$$fn(protectedStorage)
{
  
  function TimeInterval()
  {
    this.start = performance.now();
    this.end = null;
  }

  Object.defineProperty(TimeInterval.prototype, 'length', {
    get: function length()
    {
      if (!this.end)
        throw new Error("Invalid length: interval hasn't been stopped");
      return this.start - this.end;
    }
  });

  TimeInterval.prototype.end = function end()
  {
    /** @todo: decide if trying to end an already-ended interval should throw */
    if (this.end)
      return false
    this.end = performance.now();
    return true;
  }
  TimeInterval.prototype.isEnded = function isEnded() { return this.end === null; }

  protectedStorage.TimeInterval = TimeInterval;

  
  function TimeThing()
  {
    this.intervals = [];
  }
  
  TimeThing.prototype.duration = function totalDuration()
  {
    let sum = 0;
    for (let interval of this.intervals)
      sum += interval.length;
    return sum;
  }

  TimeThing.prototype.push = function push(ele)
  {
    this.intervals.push(ele);
  }

  TimeThing.prototype.reset = function reset()
  {
    this.intervals = [];
  }

  function TimeCPU()
  {
    TimeThing.call(this);
    this.mostRecentInterval = null;
  }
  TimeCPU.prototype = new TimeThing();

  TimeCPU.prototype.push = function push(ele)
  {
    this.intervals.push(ele);
    this.mostRecentInterval = ele;
  }

  function TimeWebGPU()
  {
    TimeThing.call(this);
  }
  TimeWebGPU.prototype = new TimeThing();

  // webGPU intervals may be overlapping due to how we measure them. 
  TimeWebGPU.prototype.duration = function duration()
  {
    let totalTime = 0;
    let previousEnd = 0;
    for (let interval of this.intervals)
    {
      if (previousEnd > interval.start)
      {
        if (!interval.isEnded())
          throw new Error("Invalid length: interval hasn't been stopped");
        totalTime += interval.end - previousEnd;
      }
      else
        totalTime += interval.length
      
      previousEnd = interval.end;
    }
    return totalTime;
  }

  protectedStorage.timers = {
    cpu:    new TimeCPU(),
    webGPU: new TimeThing(),
    webGL:  new TimeThing(),
  }

})
