/**
 *  This file extends BravoJS, creating a CommonJS Modules/2.0
 *  environment for WebWorkers and similar environments.
 *
 *  Copyright (c) 2018-2022, Distributive, Ltd.  All Rights Reserved.
 *  Wes Garland, wes@kingsds.network
 */

/* global self, bravojs, addEventListener, postMessage */
// @ts-nocheck

self.wrapScriptLoading({ scriptName: 'bravojs-env', ringTransition: true }, function bravojsEvn$$fn(protectedStorage, ring1PostMessage, wrapPostMessage)
{
  // This file starts at ring 2, but transitions to ring 3 partway through it.
  const ring2PostMessage = self.postMessage; 
  let ring3PostMessage;

  bravojs.ww = {}
  bravojs.ww.allDeps = []
  bravojs.ww.provideCallbacks = {}

  //Listens for postMessage from the sandbox
  addEventListener('message', async (event) => {
    let message = event
    let indirectEval = eval // eslint-disable-line
    switch (message.request) {
      case 'moduleGroup': /* Outside environment is sending us a module group */
        module.declare = bravojs.ww.groupedModuleDeclare
        let packages = Object.keys(message.data)

        for (let i = 0; i < packages.length; i++) {
          let fileNames = Object.keys(message.data[packages[i]])
          for (let j = 0; j < fileNames.length; j++) {
            bravojs.ww.moduleId = packages[i] + '/' + fileNames[j]
            try {
              indirectEval(message.data[packages[i]][fileNames[j]], fileNames[j])
            } catch (error) {
              throw error
            }
          }
        }

        delete module.declare

        if (bravojs.ww.provideCallbacks.hasOwnProperty(message.id)) {
          bravojs.ww.provideCallbacks[message.id].callback()
          delete bravojs.ww.provideCallbacks[message.id]
        }
        break
      case 'moduleGroupError': /* Outside environment is sending us a module group error report */
        if (bravojs.ww.provideCallbacks.hasOwnProperty(message.id) && bravojs.ww.provideCallbacks[message.id].onerror) {
          bravojs.ww.provideCallbacks[message.id].onerror()
        } else {
          console.error('moduleGroupError ', message.stack)
        }
        break

      /* Sandbox assigned a specific job by supervisor */
      case 'assign': {
        let reportError = function bravojsEnv$$sandboxAssignment$reportError(e) {
          var error = Object.assign({}, e);
          Object.getOwnPropertyNames(e).forEach((prop) => error[prop] = e[prop]);
          if (error.stack)
            error = error.stack.replace(/data:application\/javascript.*?:/g, 'eval:');

          ring2PostMessage({request: 'reject', error});
        }
        
        try {
          if (typeof module.main !== 'undefined')
            throw new Error('Main module was provided before job assignment');

          protectedStorage.sandboxConfig = message.sandboxConfig;
          Object.assign(self.work.job.public, message.job.public); /* override locale-specific defaults if specified */
          // Load bravojs' module.main with the work function
          module.declare(message.job.dependencies || (message.job.requireModules /* deprecated */), function mainModule(require, exports, module) {
            try {
              if (exports.hasOwnProperty('job'))
                throw new Error("Tried to assign sandbox when it was already assigned"); /* Should be impossible - might happen if throw during assign? */
              exports.job = false; /* placeholder own property */
              
              message.job.requirePath.map(p => require.paths.push(p));
              message.job.modulePath.map(p => module.paths.push(p));
              exports.arguments = message.job.arguments;

              if (message.job.useStrict)
                exports.job = indirectEval(`"use strict"; (${message.job.workFunction})`);
              else
                exports.job = indirectEval(`(${message.job.workFunction})`);
            } catch(e) {
              reportError(e);
              return;
            }

            ring2PostMessage({
              request: 'assigned',
              jobAddress: message.job.address,
            });

            // Now that the evaluator is assigned, wrap post message for ring 3
            wrapPostMessage();
            ring3PostMessage = self.postMessage;
          }); /* end of main module */
        } catch (error) {
          reportError(error);
        }
        break /* end of assign */
      }
      /* Supervisor has asked us to execute the work function. message.data is input datum. */
      case 'main':
      {
        try
        {
          runWorkFunction(message.data);
        }
        catch (error)
        {
          ring3PostMessage({ request: 'sandboxError', error });
        }
        break;
      }
      default:
        break;
    }
  })

  /** A module.declare suitable for running when processing modules arriving as part
  * of a  module group or other in-memory cache.
  */
  bravojs.ww.groupedModuleDeclare = function bravojsEnv$$ww$groupedModuleDeclare(dependencies, moduleFactory) {
    var i
    var moduleBase = ''

    if (bravojs.debug && bravojs.debug.match(/\bmoduleCache\b/)) { console.log('Loaded ' + dependencies + ' from group') }

    if (typeof moduleFactory === 'undefined') {
      moduleFactory = dependencies
      dependencies = []
    }

    bravojs.pendingModuleDeclarations[bravojs.ww.moduleId] = {
      moduleFactory: moduleFactory,
      dependencies: dependencies
    }

    for (i = 0; i < dependencies.length; i++) {
      bravojs.ww.allDeps.push(bravojs.makeModuleId(moduleBase, dependencies[i]))
    }
  }

  /** A module.provide suitable for a web worker, which requests modules via message passing.
   *
   *  @param  dependencies      A dependency array
   *  @param  callback          The callback to invoke once all dependencies have been
   *                            provided to the environment. Optional.
   *  @param  onerror           The callback to invoke in the case there was an error providing
   *                            the module (e.g. 404). May be called more than once.
   */
  bravojs.Module.prototype.provide = function bravojsEnv$$Module$provide(dependencies, callback, onerror) {
    var id = Date.now() + Math.random()

    dependencies = bravojs.normalizeDependencyArray(dependencies)

    bravojs.ww.provideCallbacks[id] = {
      callback: callback,
      onerror: onerror
    }

    ring2PostMessage({
      request: 'dependency',
      data: dependencies,
      id,
    });
  };

  /* Report metrics to sandbox/supervisor */
  /** @todo it's not async anymore */
  async function reportTimes (metrics)
  {
    const { total, webGL, webGPU, CPU } = metrics;

    // Due to how using the async keyword will result in a native promise being generated and we cannot intercept what
    // type of Promise is used. We lose track of what functions are put onto the stack after the first await point. 
    // The current hammer is we just add that time back to the CPU and accept the might be overestimated.
    // Since the total is wall time, no single component can exceed it.
    const revisedCPU = total - Math.max(webGL, webGPU, CPU) + CPU;
    protectedStorage.console.log({ total, webGL, webGPU, revisedCPU });
    ring3PostMessage({ request: 'measurement', total, webGL, webGPU, CPU: revisedCPU });
  }

  /* Report an error from the work function to the supervisor */
  function reportError (error, metrics)
  {
    let err = { message: 'initial state', name: 'initial state' };

    for (let prop of [ 'message', 'name', 'code', 'stack', 'lineNumber', 'columnNumber' ])
    {
      try
      {
        if (typeof error[prop] !== 'undefined')
          err[prop] = error[prop];
      }
      catch(e){};
    }

    if (error === Symbol.for('workReject')) {
      err['message'] = protectedStorage.workRejectReason;
      err['name'] = 'EWORKREJECT';
      err['stack'] = 'Slice was rejected in the sandbox by work.reject'
      reportTimes(metrics).then(() => ring3PostMessage({ request: 'workError', error: err }));
    }
    else
      ring3PostMessage({request: 'workError', error: err});
  }

  /**
   * Report a result from work function and metrics to the supervisor.
   * @param     result  the value that the work function returned promise resolved to
   */
  function reportResult (result, metrics)
  {
    reportTimes(metrics).then(() => {
      ring3PostMessage({ request: 'complete', result });
    }).catch((error) => {
      ring3PostMessage({ request: 'sandboxError', error });
    });
  }
  
  /**
   * Actual mechanics for running a work function. ** This function will never reject **
   *
   * @param     successCallback         callback to invoke when the work function has finished running;
   *                                    it receives as its argument the resolved promise returned from
   *                                    the work function
   * @param     errorCallback           callback to invoke when the work function rejects. It receives
   *                                    as its argument the error that it rejected with.
   * @returns   unused promise   
   */
  async function runWorkFunction_inner(datum, successCallback, errorCallback)
  {
    /** @typedef {import("./timer-classes.js").TimeInterval} TimeInterval */
    const TimeInterval = protectedStorage.TimeInterval;
    const TimedPromise = protectedStorage.bigBrother.TimedPromise;
    var rejection = false;
    var result;
    let metrics;
    const wallDuration = new TimeInterval();
    try
    {
      /* module.main.job is the work function; left by assign message */ 
      result = await new TimedPromise((resolve) => resolve(module.main.job.apply(null, [datum].concat(module.main.arguments))));
    }
    catch (error)
    {
      rejection = error;
    }


    // flush any pending console events, especially in the case of a repeating message that hasn't been emitted yet 
    try { flushLastLog(); } catch(e) {};
    try {
      // reset the device states and flush all pending tasks
      protectedStorage.lockTimers(); // lock timers so no new timeouts will be run.
      metrics = await protectedStorage.bigBrother.globalTrackers.getMetrics();

      await protectedStorage.bigBrother.globalTrackers.reset();
    } catch (e) {
    } finally {
      protectedStorage.clearAllTimeouts();
      // due to the nature of the micro task queue, await, our `reset()` cancels all the things that could cause new
      // tasks, and we wait for all pending task to finish in `reset()`, we are guaranteed to have an empty task queue
      // now. Hence it's ok to stop the wall clock measurement now
      wallDuration.stop();

      // safety: wallDuration is always stopped, `length` will not throw
      metrics = { ...metrics, total: wallDuration.length };
    }

    if (rejection)
      errorCallback(rejection, metrics);
    else
      successCallback(result, metrics);

    /* CPU time measurement ends when this function's return value is resolved or rejected */
  }

  /**
   * Run the work function, returning a promise that resolves once the function has finished
   * executing.
   *
   * @param {datam}     an element of the input set
   */
  function runWorkFunction(datum)
  {
    protectedStorage.unlockTimers();
    /* Use setTimeout trampoline to
     * 1. shorten stack
     * 2. initialize the event loop measurement code
     */
    protectedStorage.setTimeout(() => runWorkFunction_inner(datum, (result, metrics) => reportResult(result, metrics), (rejection, metrics) => reportError(rejection, metrics)));
  }
}); /* end of fn */
