/**
 *  @file       worker/evaluator-lib/bootstrap.js
 *              Copyright (c) 2018-2022, Distributive, Ltd.  All Rights Reserved.
 *
 *              Final evaluator bootstrap code for defining functions to be used in the work function.
 *
 *  @author     Wes Garland, wes@sparc.network
 *  @date       May 2018
 *  @module     WorkerBootstrap
 */

/* globals self */

self.wrapScriptLoading({ scriptName: 'bootstrap', finalScript: true }, function bootstrap$$fn(protectedStorage, ring2PostMessage)
{
  let lastProgress = 0,
      postMessageSentTime = 0,
      throttledProgress = 0, // how many progress events were throttled since last update
      indeterminateProgress = true, // If there hasn't been a determinate call to progress since last update
      lastConsoleLog = null; // cache of the last message received through a console event

  addEventListener('message', async (event) => {
    try {
      var indirectEval = eval // eslint-disable-line
      if (event.request === 'eval') {
        try {
          let result = await indirectEval(event.data, event.filename)
          ring2PostMessage({
            request: `evalResult::${event.msgId}`,
            data: result
          })
        } catch (error) {
          ring2PostMessage({
            request: 'error',
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack.replace(
                /data:application\/javascript.*?:/g,
                'eval:'
              ),
            }
          })
        }
      } else if (event.request === 'resetState') {
        // This event is fired when the web worker is about to be reused with another slice
        lastProgress = 0;
        postMessageSentTime = 0;
        throttledProgress = 0;
        indeterminateProgress = true;
        lastConsoleLog = null;
        ring2PostMessage({ request: 'resetStateDone' });
      }
    } catch (error) {
      ring2PostMessage({
        request: 'error',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      })
    }
  })

  const emitNoProgress = (message) => {
    lastProgress = null;
    postMessage({
      request: 'noProgress',
      message
    });
  }

  self.progress = function workerBootstrap$progress(value) {
    // lastProgress is set to null when noProgress is emitted,
    // prevents multiple noProgress events from firing
    if (lastProgress === null) return false;

    let progress, isIndeterminate = false;
    if (value === undefined) {
      progress = lastProgress || 0;
      // if progress was set previously, don't show indeterminate
      if (lastProgress === 0) {
        isIndeterminate = true;
      }
    } else {
      progress = parseFloat(value);

      if (Number.isNaN(progress)) {
        isIndeterminate = true;
      } else {
        if (!(typeof value === 'string' && value.endsWith('%'))) {
          // if the progres value isn't a string ending with % then multiply it by 100
          progress *= 100;
        }
      }
    }

    if (progress < 0 || progress > 100) {
      emitNoProgress(`Progress out of bounds: ${progress.toFixed(1)}%, last: ${lastProgress.toFixed(1)}%`);
      return false;
    } else if (progress < lastProgress) {
      // Nerf reverse progress error, mark as indeterminate // RR Jan 2020
      progress = lastProgress;
      isIndeterminate = true;
    }

    if (!Number.isNaN(progress))
      lastProgress = progress;
    
    indeterminateProgress &= isIndeterminate;
    const throttleTime = ((protectedStorage.sandboxConfig && protectedStorage.sandboxConfig.progressThrottle) || 0.1) * 1000;
    if (Date.now() - postMessageSentTime >= throttleTime) {
      postMessageSentTime = Date.now();
      postMessage({
        request: 'progress',
        progress: lastProgress,
        value, // raw value
        indeterminate: indeterminateProgress,
        throttledReports: throttledProgress,
      });

      throttledProgress = 0;
      indeterminateProgress = true;
    } else {
      throttledProgress++;
    }

    protectedStorage.dispatchSameConsoleMessage();
    return true;
  }

  function workerBootstrap$work$emit(customEvent, value) {
    if (typeof customEvent !== 'string') {
      throw new Error(`Event name passed to work.emit must be a string, not ${customEvent}.`);
    }

    postMessage({
      request: 'emitEvent',
      payload: {
        eventName: 'custom',
        customEvent,
        data: value,
      },
    });
  }

  function workerBootstrap$work$reject(reason = 'false') {
    protectedStorage.workRejectReason = reason; // Memoize reason
    throw Symbol.for('workReject');
  }

  self.work = {
    emit: workerBootstrap$work$emit,
    job: {
      public: {
        name: 'Ad-Hoc Job', /* in user's language */
        description: 'Discreetly making the world smarter', /* in user's language */
        link: 'https://distributed.computer/about',
      }
    },
    reject: workerBootstrap$work$reject,
  };

  /**
   * Polyfills the `console[method]` functions in the work function by
   * dispatching 'console' events to the worker to be propogated/emitted to
   * connected clients.
   *
   * Subsequent console messages that are identical are treated as special
   * cases. Their dispatch is delayed for as long as possible. See
   * `protectedStorage.dispatchSameConsoleMessage()` for the events triggering
   * their dispatch.
   */
  function workerBootstrap$console(level, ...args)
  {
    const newConsoleLog = { level, message: args };

    // The first console message.
    if (lastConsoleLog === null)
    {
      dispatchNewConsoleMessage();
      return;
    }

    // Subsequent console messages.
    if (
      newConsoleLog.level === lastConsoleLog.level
      && areArraysEqual(newConsoleLog.message, lastConsoleLog.message)
    )
    {
      // Delay/batch the dispatch of the same log(s).
      lastConsoleLog.same += 1;
      return;
    }

    protectedStorage.dispatchSameConsoleMessage();
    dispatchNewConsoleMessage();

    function dispatchNewConsoleMessage()
    {
      newConsoleLog.same = 1;
      postMessage({ request: 'console', payload: newConsoleLog });
      lastConsoleLog = newConsoleLog;
    }

    // Checks to see whether 2 arrays are identical.
    function areArraysEqual(array1, array2)
    {
      if (array1.length !== array2.length)
        return false;
      for (let k = 0; k < array1.length; k++)
        if (array1[k] !== array2[k])
          return false;
      return true;
    }
  }

  // Polyfill console with our own function. Prevents console statements
  // within a user's work function from being displayed in a worker's console, and
  // will properly send it back to the user
  self.console = {
    log:    workerBootstrap$console.bind(null, 'log'),
    debug:  workerBootstrap$console.bind(null, 'debug'),
    info:   workerBootstrap$console.bind(null, 'info'),
    warn:   workerBootstrap$console.bind(null, 'warn'),
    error:  workerBootstrap$console.bind(null, 'error'),
  };

  /**
   * Dispatches the most recent duplicate console message.
   *
   * Based on the spec, this occurs when a new different message is logged (see
   * `workerBootstrap$console`), the worker terminates (hence
   * `protectedStorage`), or a progress update event is emitted (see
   * `self.progress`); whichever comes first.
   */
  protectedStorage.dispatchSameConsoleMessage = function workerBootstrap$dispatchSameConsoleMessage() {
    if (!(lastConsoleLog?.same > 1))
      return;
    // Avoid sending duplicate console message data over the network.
    delete lastConsoleLog.message;
    postMessage({ request: 'console', payload: lastConsoleLog });
    lastConsoleLog = null;
  };
});
