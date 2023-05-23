/**
 *  @file       timer-classes.js
 *              This file creates classes that will be required for timing.
 * 
 * The 4 classes defined are:
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
      if (!this.end)
        throw new Error("Invalid length: interval hasn't been stopped");
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
      return false
    this.end = performance.now();
    return true;
  }

  /**
   * FOR THE LOVE OF HUMANITY, CAN SOMEONE MAKE THE CONSTRUCTOR OF THIS NOT EAGERLY MEASURE AND ALLOW US PASS
   * IN THE START AND END TIME?!
   *
   * THIS FUNCTION SHOULD REALLY RETURN A NEW INSTANCE OF THE INTERVAL, NOT MODIFY THE EXISTING ONE. 
   * Override the interval with a new start and end time.
   * @function {TimeInterval.overrideInterval}
   * @param {number} start - the new start time
   * @param {number} end   - the new end time
   */
  TimeInterval.prototype.overrideInterval = function overrideInterval(start, end)
  {
    // since users shoully shouldn't touch this, if this fails, it's almost certainly our fault
    console.assert(start && end && start < end, 'Invalid interval');

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
   * Get the total length of all intervals. If the intervals are overlapping,
   * the overlapping time will be counted twice.  
   *
   * @function {TimeThing.duration}
   */
  TimeThing.prototype.duration = function totalDuration()
  {
    const merged = [];
    for (const interval in this.intervals)
    {
      // if the last interval in the merged list have no ovverlap with the current interval, just push it
      if (merged.length === 0 || merged[merged.length - 1].end < interval.start)
      {
        merged.push(interval);
      }
      else
      {
        // otherwise, there is overlap, so merge the current and last interval
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, interval.end);
      }
    }

    this.intervals = merged;
    
    // now calculating the total duration is trivial
    const totalTime = merged
      .map(interval => interval.length)
      .reduce((a, b) => a + b);

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
