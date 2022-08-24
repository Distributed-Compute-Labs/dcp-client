/**
 *  @file       timer-classes.js
 *              This file creates classes that will be required for timing.
 * 
 * TimeInterval:  measure an interval of time. Time interval starts when the object
 *                is instantiated, and ends when `TimeInterval.stop()` is called.
 *                It's length property is the time duration.
 * 
 * TimeThing:     Generic wrapper for multiple TimeIntervals. Can add new intervals
 *                with `push`, reset all intervals with `reset`, and find the total
 *                time duration (including any overlapping time) with `duration`.
 * 
 * TimeCPU:       Inherits from TimeThing. Adds a reference to the most recently added
 *                duration, so it can be ended even if there is no other available reference
 *                to that interval.
 * 
 * TimeWebGPU:    Inherits from TimeThing. Changes how `duration` functions to:
 *                    a) make it async to ensure all durations are finished before resolving (accomplished
 *                       by keeping a reference to the promise that will finish the last interval)
 *                    b) returns the non-overlapping duration.
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
      return this.end - this.start;
    }
  });

  TimeInterval.prototype.stop = function stop()
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
    this.latestWebGPUCall = null;
  }
  TimeWebGPU.prototype = new TimeThing();

  TimeWebGPU.prototype.push = function push(ele, p)
  {
    this.intervals.push(ele);
    this.latestWebGPUCall = p;
  }

  /**
   * How long was spent in the gpu.
   * 
   * The returned promise will only resolve once all webGPU code has run to completion.
   */
  TimeWebGPU.prototype.duration = async function duration()
  {
    while (this.latestWebGPUCall)
    {
      const latestCall = this.latestWebGPUCall;
      await this.latestWebGPUCall;
      if (latestCall === this.latestWebGPUCall)
        this.latestWebGPUCall = null;
    }

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
