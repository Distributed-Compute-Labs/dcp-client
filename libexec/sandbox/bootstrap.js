/**
 *  @file       worker/evaluator-lib/bootstrap.js
 *              Copyright (c) 2018, Kings Distributed Systems, Ltd.  All Rights Reserved.
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
      flushedLastConsoleMessage = false, // flag used to determine if flushedLastLog() was called by client
      lastConsoleMessage = null; // cache of the last message received throguh a console event

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
        flushedLastConsoleMessage = false;
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
    
      protectedStorage.dcpConfig.worker.sandbox.progressThrottle = 0.1;
    
    indeterminateProgress &= isIndeterminate;
    const throttleTime = (protectedStorage.progressThrottle || 0.1) * 1000;
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

    flushConsoleMessages(null);
    return true;
  }

  function workerBootstrap$work$emit(eventName, value) {
    if (typeof eventName !== 'string') {
      throw new Error(`Event name passed to work.emit must be a string, not ${eventName}.`);
    }

    postMessage({
      request: 'emitEvent',
      payload: {
        eventName,
        data: value,
      },
    });
  }

  self.work = {
    emit: workerBootstrap$work$emit,
    job: {
      public: {
        name: 'Ad-Hoc Job', /* in user's language */
        description: 'Discreetly making the world smarter', /* in user's language */
        link: 'https://distributed.computer/about',
      }
    }
  };

  function workerBootstrap$console(level, ...args) {
    flushConsoleMessages({
        level,
        message: args,
        fileName: undefined,
        lineNumber: undefined});
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

  // Function caches the most recent console message and counts how many identical messages are received
  // Once a different message is received (or when the slice completes) it is sent along with the counter value
  function flushConsoleMessages(data){
    if(lastConsoleMessage != null && data != null && lastConsoleMessage.message == data.message && lastConsoleMessage.level == data.level){
      lastConsoleMessage.same++;
    } else {
      if(lastConsoleMessage != null){
        postMessage({
          request: 'console',
          payload: lastConsoleMessage
        });
        lastConsoleMessage = null;
      }

      if(data != null){
        data.same = 1;
        lastConsoleMessage = data;
      }
    }
  };
  // Ensure all console statements will be sent after a job completes
  self.flushLastLog = function workerBootstrap$flushLastLog(){
    if(!flushedLastConsoleMessage){
        flushConsoleMessages(null); 
        flushedLastConsoleMessage = true;
    } else{
      throw new Error('client should not be calling flushLastLog');
    }
  }
});
