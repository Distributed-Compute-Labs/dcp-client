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
  let totalTime;

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
          module.declare(message.job.dependencies || (message.job.requireModules /* deprecated */), async function mainModule(require, exports, module) {
            try {
              if (exports.hasOwnProperty('job'))
                throw new Error("Tried to assign sandbox when it was already assigned"); /* Should be impossible - might happen if throw during assign? */
              exports.job = false; /* placeholder own property */
              
              message.job.requirePath.map(p => require.paths.push(p));
              message.job.modulePath.map(p => module.paths.push(p));
              exports.arguments = message.job.arguments;
              exports.worktime = message.job.worktime;

              switch (message.job.worktime.name)
              {
                case 'map-basic':
                  if (message.job.useStrict)
                    exports.job = indirectEval(`"use strict"; (${message.job.workFunction})`);
                  else
                    exports.job = indirectEval(`(${message.job.workFunction})`);
                  break;
                case 'pyodide':
                  exports.job = await generatePyodideFunction(message.job);
                  break;
                default:
                  throw new Error(`Unsupported worktime: ${message.job.worktime.name}`);
              }
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

  /**
   * Factory function which generates a "map-basic"-like workFunction
   * out of a Pyodide Worktime job (Python code, files, env variables).
   *
   * It takes any "images" passed in the workFunction "arguments" and
   * writes them to the in memory filesystem provided by Emscripten.
   * It adds any environment variables specified in the workFunction
   * "arguments" to the pseudo-"process" for use.
   * It globally imports a dcp module with function "set_slice_handler"
   * which takes a python function as input. The python function passed
   * to that slice handler is invoked by the function which this
   * factory function returns.
   *
   * @param {Object} job The job data associated with the message
   * @returns {Function} function pyodideWorkFn(slice) -> result
   */
  async function generatePyodideFunction(job)
  {
    var pythonSliceHandler;

    const pyodide = await pyodideInit();
    const sys = pyodide.pyimport('sys');

    const findImports = pyodide.runPython('import pyodide; pyodide.code.find_imports');
    const findPythonModuleLoader = pyodide.runPython('import importlib; importlib.find_loader');

    const parsedArguments = parsePyodideArguments(job.arguments);

    // write images to file and set environment variables
    const prepPyodide = pyodide.runPython(`
import tarfile, io
import os, sys

def prepPyodide(args):
  for image in args['images']:
    image = bytes(image)
    imageFile = io.BytesIO(image)
    tar = tarfile.open(mode='r', fileobj=imageFile)
    tar.extractall()

  for item, value in args['environmentVariables'].items():
    os.environ[item] = value

  sys.argv.extend(args['sysArgv'])

  return

prepPyodide`);

    prepPyodide(pyodide.toPy(parsedArguments));

    // register the dcp Python module 
    if (!sys.modules.get('dcp'))
    {
      const create_proxy = pyodide.runPython('import pyodide;pyodide.ffi.create_proxy');

      pyodide.registerJsModule('dcp', {
        set_slice_handler: function pyodide$$dcp$$setSliceHandler(func) {
          pythonSliceHandler = create_proxy(func);
        },
        progress,
      });
    }
    pyodide.runPython( 'import dcp' );

    // attempt to import packages from the package manager (if they're not already loaded)
    const workFunctionPythonImports = findImports(job.workFunction).toJs();
    const packageManagerImports = workFunctionPythonImports.filter(x=>!findPythonModuleLoader(x));
    if (packageManagerImports.length > 0)
    {
      await fetchAndInitPyodidePackages(packageManagerImports);
      await pyodide.loadPackage(packageManagerImports);
    }

    return workFunctionWrapper;

    /**
     * Evaluates the Python WorkFunction string and then executes the slice
     * handler Python function. If no call to `dcp.set_slice_handler` is passed
     * or a non function is passed to it.
     * This function specifically only takes one parameter since Pyodide Slice
     * Handlers only accept one parameter.
     */
    async function workFunctionWrapper(datum)
    {
      const pyodide = await pyodideInit(); // returns the same promise when called multiple times

      // load and execute the Python Workfunction, this populates the pythonSliceHandler variable
      await pyodide.runPython(job.workFunction);

      // failure to specify a slice handler is considered an error
      if (!pythonSliceHandler)
        throw new Error('ENOSLICEHANDLER: Must specify the slice handler using `dcp.set_slice_handler(fn)`');

      // setting the slice handler to a non function or lambda is not supported
      else if (typeof pythonSliceHandler !== 'function')
        throw new Error('ENOSLICEHANDLER: Slice Handler must be a function');

      const sliceHandlerResult = await pythonSliceHandler(datum);

      // if it is a PyProxy, convert its value to JavaScript
      if (sliceHandlerResult.toJs)
        return sliceHandlerResult.toJs();

      return sliceHandlerResult;
    }

    /*
     * Refer to the "The Pyodide Worktime"."Work Function (JS)"."Arguments"."Commands"
     * part of the DCP Worktimes spec.
     */
    function parsePyodideArguments(args)
    {
      var index = 1;
      const numArgs = args[0];
      const images = [];
      const environmentVariables = {};
      const sysArgv = args.slice(numArgs);

      while (index < numArgs)
      {
        switch (args[index])
        {
          case 'gzImage':
            const image = args[index+1];
            images.push(image);
            index+=2;
            break;
          case 'env':
            const env = args[index+1].split(/=(.*)/s);
            index+=2;
            environmentVariables[env[0]] = env[1];
            break;
          default:
            throw new Error(`Invalid argument ${args[index]}`);
        }
      }

      return { sysArgv, images, environmentVariables };
    }
  }

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
  async function reportTimes ()
  {
    const timers = protectedStorage.timers;
    const webGL = timers.webGL.duration();
    const webGPU = await timers.webGPU.duration();

    timers.cpu.mostRecentInterval.stop();
    let CPU = timers.cpu.duration();
    CPU -= webGL; // webGL is synchronous gpu usage, subtract that from cpu time.

    totalTime.stop();
    const total = totalTime.length;

    timers.cpu.reset();
    timers.webGL.reset();
    timers.webGPU.reset();
    protectedStorage.clearAllTimers();

    ring3PostMessage({ request: 'measurement', total, webGL, webGPU, CPU });
  }

  /* Report an error from the work function to the supervisor */
  function reportError (error)
  {
    let err = { message: 'initial state', name: 'initial state' };

    for (const prop of [ 'message', 'name', 'code', 'stack', 'lineNumber', 'columnNumber' ])
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
      reportTimes().then(() => ring3PostMessage({ request: 'workError', error: err }));
    }
    else
    {
      ring3PostMessage({request: 'workError', error: err});
    }
  }

  /**
   * Report a result from work function and metrics to the supervisor.
   * @param     result  the value that the work function returned promise resolved to
   */
  function reportResult (result)
  {
    reportTimes().then(() => {
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
    var rejection = false;
    var result;
    
    try
    {
      /* module.main.job is the work function; left by assign message */ 
      result = await module.main.job.apply(null, [datum].concat(module.main.arguments));
    }
    catch (error)
    {
      rejection = error;
    }

    /* try to flush any pending tasks on the microtask queue, then flush any
     * repeating message that hasn't been dispatched yet.
     */
    try { await tryFlushMicroTaskQueue(); } catch(e) {};
    protectedStorage.dispatchSameConsoleMessage();
    try
    {
      protectedStorage.lockTimers(); // lock timers so no new timeouts will be run.
      await new Promise(r => protectedStorage.realSetTimeout(r)); // flush microtask queue
    }
    catch(e) {}

    if (rejection)
      errorCallback(rejection);
    else
      successCallback(result);

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
    // Measure performance directly before and after the job to get as accurate total time as
    totalTime = new protectedStorage.TimeInterval();

    // Guarantee CPU timers are cleared before the main work function runs.
    // This is necessary because the GPU object has been wrapped to make setTimeout calls to
    // allow for measurement. However, when these timeouts are invoked during capability
    // calculations, they are erroneously measured as CPU time. This can cause CPU time > total time
    // and CPUDensity > 1
    protectedStorage.timers.cpu.reset();
    protectedStorage.timers.webGPU.reset(); // also reset other timers for saftey
    protectedStorage.timers.webGL.reset();
    protectedStorage.unlockTimers();
    /* Use setTimeout trampoline to
     * 1. shorten stack
     * 2. initialize the event loop measurement code
     */
    protectedStorage.setTimeout(() => runWorkFunction_inner(datum, (result) => reportResult(result), (rejection) => reportError(rejection)));
  }
}); /* end of fn */
