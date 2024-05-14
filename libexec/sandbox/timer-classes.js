/**
 *  @file       timer-classes.js
 *              This file creates classes that will be required for timing.
 * 
 * The 2 classes defined are:
 *  - TimeInterval: measure an interval of time.
 *  - TimeThing:    generic collection of TimeIntervals
 * 
 * TimeInterval is an object shaped like {start: X, stop: Y} with a few additional functions to stop the interval.
 * Start is set to the current time immediately when the interval is created, and stop is set when the `stop` function
 * is called. The semantics of a duration is half open, in [begin, end) fashion, this makes calculating duration trivial,
 * it's simply end - start.
 *
 * @author  Ryan Saweczko <ryansaweczko@kingsds.network>
 * @date    Aug 2022
 */

self.wrapScriptLoading({ scriptName: 'timer-classes' }, function timerClasses$$fn(protectedStorage)
{
  /**
   * A TimeInterval is basically a [half, open) range of time that we can use to record how long 
   * something took.
   *
   * @typedef {Object} TimeInterval
   * @property {number} start - the start time of the interval
   * @property {number} end   - the end time of the interval
   * @property {function} stop - stop the interval, setting the end time to the current time
   * @property {function} hasEnded - check if the interval has been stopped
   * @property {function} overrideInterval - override the interval with a new start and end time
   * @property {number} length - the length of the interval. This is a getter, and will throw an error
   * /

  /**
   * Time interval class.
   * 
   * Contains a start time and end time. The start time is set immediately when the interval is created,
   * and the end time is set when `stop` is called. Once the interval has been stopped, the length
   * can be accessed (getting interval.length before it's stopped is an error).
   *
   * @constructor {TimeInterval}
   */
  function TimeInterval()
  {
    this.start = performance.now();
    this.end = null;
  }

  Object.defineProperty(TimeInterval.prototype, 'length', {
    get: function length()
    {
      // it's normal that some timers will not be all stopped when we want to measure, such as any off thread tasks
      // that isn't needed due to early return
      if (!this.end)
        this.end = performance.now();
      return this.end - this.start;
    }
  });

  /**
   * Stop a timer. The `end` time is set.
   *
   * @function {TimeInterval.stop}
   */
  TimeInterval.prototype.stop = function stop()
  {
    if (this.end)
      return this;
    this.end = performance.now();
    return this;
  }

  /**
   * Override the interval with a new start and end time.
   * @function {TimeInterval.overrideInterval}
   * @param {number} start - the new start time
   * @param {number} end   - the new end time
   */
  TimeInterval.prototype.overrideInterval = function overrideInterval(start, end)
  {
    this.start = start;
    this.end = end;
  }


  /**
   * Check if the interval has been stopped (end time has been set)
   * @function {TimeInterval.hasEnded}
   */
  TimeInterval.prototype.hasEnded = function hasEnded()
  {
    return typeof this.end === 'number';
  };

  protectedStorage.TimeInterval = TimeInterval;


  /**
   * @typedef {Object} TimeThing
   * @property {TimeInterval[]} intervals - list of intervals
   * @property {function} duration - get the total duration of all intervals
   * @property {function} push - add a new interval to the list
   * @property {function} reset - clear the list of intervals
   */


  /**
   * Time Thing class
   * 
   * Generic collection of time intervals. Contains a list
   * of intervals, and provides a way to get the total time
   * of all intervals.
   *
   * @constructor {TimeThing}
   */
  function TimeThing()
  {
    this.intervals = [];
  }

  /**
   * Get the total length of all intervals. Overlapping intervals will be merged
   *
   * @function {TimeThing.duration}
   */
  TimeThing.prototype.duration = function totalDuration()
  {
    // make sure intervals are sorted before merging them
    this.intervals.sort((a, b) => a.start - b.start);

    // solution stolen from: https://leetcode.com/problems/merge-intervals/editorial/
    const merged = [];
    for (const interval of this.intervals)
    {
      if (merged.length === 0 || merged.at(-1).end < interval.start)
        // if the last interval in the merged list have no ovverlap with the current interval, just push it
        merged.push(interval);
      else
        // otherwise, there is overlap, so merge the current and last interval
        merged.at(-1).end = Math.max(merged.at(-1).end, interval.end);
    }

    this.intervals = merged;
    
    // now calculating the total duration is trivial
    const totalTime = merged
      .map(interval => interval.length)
      .reduce((a, b) => a + b, 0);

    return totalTime;
  }
  /**
   * Add a new interval.
   * 
   * @function {TimeThing.push}
   * @param {TimeInterval} interval - new interval to add to the collection
   */
  TimeThing.prototype.push = function push(interval)
  {
    this.intervals.push(interval);
  }

  /**
   * Reset the interval. Resets the interval list to an empty list.
   *
   * @function {TimeThing.reset}
   */
  TimeThing.prototype.reset = function reset()
  {
    this.intervals = [];
  }
  

  protectedStorage.TimeThing = TimeThing;
});
