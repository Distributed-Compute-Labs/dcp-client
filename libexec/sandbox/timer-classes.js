/**
 *  @file       timer-classes.js
 *              This file creates classes that will be required for timing.
 * 
 * The 4 classes defined are:
 *  - TimeInterval: measure an interval of time.
 *  - TimeThing:    generic collection of TimeIntervals
 *  - TimeCPU:      collection of TimeIntervals, with a reference to the most recent interval.
 *  - TimeWebGPU:   collection of TimeIntervals, with duration not counting overlap, and awaiting for GPU completion event.
 * 
 * TimeInterval is an object shaped like {start: X, stop: Y} with a few additional functions to stop the interval.
 * Start is set to the current time immediately when the interval is created, and stop is set when the `stop` function
 * is called. If the length of an interval is accessed before the interval is stopped, it will throw an error.
 * A TimeThing contains a possibly-overlapping list of TimeIntervals. It adds a duration function to calculate the total
 * time of all intervals (double-counting any overlaps). If the Thing may need to have it's final interval stopped in an
 * area that won't otherwise have a reference to that interval, TimeCPU can be used. TimeCPU only adds a reference to the
 * most recent interval to be added to the list.
 * TimeWebGPU is special due to the challenges of timing a GPU from Javascript. It's duration function is async, since
 * the moment the GPU is finished is unknowable until it reports it's finished. If a work function adds a task to the GPU,
 * but resolves before the GPU is finished, we need to carefully to wait for the GPU to be finished before the duration
 * can be calculated. TimeWebGPU has this built-in to the duration function.

 * @author  Ryan Saweczko <ryansaweczko@kingsds.network>
 * @date    Aug 2022
 */

// @ts-nocheck

self.wrapScriptLoading({ scriptName: 'timer-classes' }, function timerClasses$$fn(protectedStorage)
{
  /**
   * Time interval class.
   * 
   * Contains a start time and end time. The start time is set immediately when the interval is created,
   * and the end time is set when `stop` is called. Once the interval has been stopped, the length
   * can be accessed (getting interval.length before it's stopped is an error).
   */
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

  /**
   * Stop a timer. The `end` time is set.
   */
  TimeInterval.prototype.stop = function stop()
  {
    if (this.end)
      return false
    this.end = performance.now();
    return true;
  }

  /**
   * Check if the interval has been stopped (end time has been set)
   */
  TimeInterval.prototype.hasEnded = function hasEnded()
  {
    return typeof this.end === 'number';
  };

  protectedStorage.TimeInterval = TimeInterval;

  /**
   * Time Thing class
   * 
   * Generic collection of time intervals. Contains a list
   * of intervals, and provides a way to get the total time
   * of all intervals.
   */
  function TimeThing()
  {
    this.intervals = [];
  }

  /**
   * Get the total length of all intervals. If the intervals are overlapping,
   * the overlapping time will be counted twice.  
   */
  TimeThing.prototype.duration = function totalDuration()
  {
    let sum = 0;
    for (let interval of this.intervals)
      sum += interval.length;
    return sum;
  }

  /**
   * Add a new interval.
   * 
   * @Param {TimeInterval} interval - new interval to add to the collection
   */
  TimeThing.prototype.push = function push(interval)
  {
    this.intervals.push(interval);
  }

  /**
   * Reset the interval. Resets the interval list to an empty list.
   */
  TimeThing.prototype.reset = function reset()
  {
    this.intervals = [];
  }

  /**
   * Time CPU class
   * 
   * Inherits from TimeThing, but adds a reference to the most recent interval
   * to be added.
   */
  function TimeCPU()
  {
    TimeThing.call(this);
    this.mostRecentInterval = null;
  }
  TimeCPU.prototype = new TimeThing();

  /**
   * Add a new interval. `this.mostRecentInterval` is set to this interval.
   * 
   * @Param {TimeInterval} interval - new interval to add to the collection
   */
  TimeCPU.prototype.push = function push(ele)
  {
    this.intervals.push(ele);
    this.mostRecentInterval = ele;
  }

  /**
   * Time WebGPU class
   * 
   * Inherits from TimeThing, but adds a reference to the most recent interval,
   * as well as large changes to the duration function to handle overlapping time intervals.
   */
  function TimeWebGPU()
  {
    TimeThing.call(this);
    this.latestWebGPUCall = null;
  }
  TimeWebGPU.prototype = new TimeThing();

  /**
   * Add a new interval. `this.mostRecentInterval` is set to this interval.
   * 
   * @Param {object} interval - {interval: TimeInterval, queueP: Promise}
   *                            new interval to add to the collection, as well as a corresponding promise
   *                            for when the most recently submitted webGPU queue is finished.
   */
  TimeWebGPU.prototype.push = function push(obj)
  {
    this.intervals.push(obj.interval);
    this.latestWebGPUCall = obj.queueP;
  }

  /**
   * Measure time (in ms) spent in the gpu. Timing is done ignoring overlaps - 
   * so if interval 1 was from 0-5 seconds and interval 2 was from 3-8 seconds,
   * the returned duration will be 8.
   * 
   * Furthermore, since it's impossible to know when webGPU code execution is finished until
   * the GPU reports it's finished, awaiting the last `onSubmittedWorkDone` promise is required.
   * A loop is used here in case the webGPU finishing triggers anything else on the microtask queue
   * 
   * @returns - promise that will resolve with the total duration once all webGPU code has run to completion.
   */
  TimeWebGPU.prototype.duration = async function duration()
  {
    var totalTime = 0;
    var previousEnd = 0;

    while (this.latestWebGPUCall)
    {
      const latestCall = this.latestWebGPUCall;
      await this.latestWebGPUCall;
      if (latestCall === this.latestWebGPUCall)
        this.latestWebGPUCall = null;
    }

    for (let interval of this.intervals)
    {
      if (previousEnd <= interval.start)
        totalTime += interval.length
      else
      {
        if (!interval.hasEnded())
          throw new Error("Invalid length: interval hasn't been stopped");
        totalTime += interval.end - previousEnd;
      }
      previousEnd = interval.end;
    }
    return totalTime;
  }

  /**
   * Instantiate a timer for each type of execution we need to measure.
   * 
   * cpu: measure total CPU usage of a slice. This measurement is based on
   *      the state of the event loop, and when any specific JavaScript code
   *      block is executing
   * webGPU: measure the amount of time between `submitting` a command queue, and
   *         an onSubmittedWorkDone promise resolving to signal all work sent to the GPU
   *         is finished. These measurements are as close as we can get in JavaScript to
   *         the exact duration of the execution of code on the GPU using webGPU.
   * webGL: measure the amount of time spent in a webGL function. Since webGL is synchronously
   *        executed, this time is indistinguishable from CPU time measured (unless all webGL
   *        functions also stop/start new CPU timing), so we have to subtract this measured
   *        time from CPU time to get the actual CPU time.
   */
  protectedStorage.timers = {
    cpu:    new TimeCPU(),
    webGPU: new TimeWebGPU(),
    webGL:  new TimeThing(),
  }

})
