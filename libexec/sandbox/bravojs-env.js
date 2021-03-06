/**
 *  This file extends BravoJS, creating a CommonJS Modules/2.0
 *  environment for WebWorkers and similar environments.
 *
 *  Copyright (c) 2018, Kings Distributed Systems, Ltd.  All Rights Reserved.
 *  Wes Garland, wes@kingsds.network
 */

/* global self, bravojs, addEventListener, postMessage */
// @ts-nocheck

self.wrapScriptLoading({ scriptName: 'bravojs-env', ringTransition: true }, (ring1PostMessage, wrapPostMessage) => {
  // This file starts at ring 2, but transitions to ring 3 partway through it.
  const ring2PostMessage = self.postMessage; 
  let ring3PostMessage

  bravojs.ww = {}
  bravojs.ww.allDeps = []
  bravojs.ww.provideCallbacks = {}

  async function flushMicroTaskQueue () {
    await Promise.resolve();
  }
  //Listens for postMessage from the sandbox
  addEventListener('message', async (event) => {
    let message = event.data
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
          console.log('moduleGroupError ', message.stack)
        }
        break
      case 'assign': {
        let reportError = function bravojsEnv$$sandboxAssignment$reportError(e) {
          var error = Object.assign({}, e);
          Object.getOwnPropertyNames(e).forEach((prop) => error[prop] = e[prop]);
          if (error.stack)
            error = error.stack.replace(/data:application\/javascript.*?:/g, 'eval:');

          ring2PostMessage({request: 'error', error});
        }
        
        try {
          if (typeof module.main !== 'undefined')
            throw new Error('Main module was provided before job assignment');

          self.dcpConfig = message.sandboxConfig;
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
              exports.job = indirectEval(`(${message.job.workFunction})`)
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
      case 'main':
        let resolveHandle, rejectHandle;
        let timeoutPromise = new Promise((...args) => [resolveHandle, rejectHandle] = args);
        // Put job on event loop with timeout
        let launchJob = (async () => {
          try {
            /* 
              module.main was initialized in case 'assign', which exports 'job' as the work function. Apply
              the slice data and any arguments to the function
            */
            let result = await module.main.job.apply(null,[message.data].concat(module.main.arguments))
            resolveHandle(result);
          } catch (error) {
            rejectHandle(error);
          }
          try{ flushLastLog(); } catch(e) {/* do nothing */}
        });
        setTimeout(launchJob);

        // wait for the above to fulfill
        try {
          const t0 = performance.now();
          const webGLTimer = getWebGLTimer;
          const offset = webGLOffset;
          delete webGLOffset;
          let result = await timeoutPromise;
          // clear the above timeout
          await flushMicroTaskQueue();
          const total = performance.now() - t0;
          let webGL = webGLTimer() - offset;
          self.webGLOffset = offset + webGL;
          ring3PostMessage({
            request: 'measurement',
            total,
            webGL,
          });
          ring3PostMessage({
            request: 'complete',
            result:  result
          });
        } catch (error) {
          ring3PostMessage({
            request: 'workError',
            error: {
              message: error.message,
              name: error.name,
              lineNumber: error.lineNumber,
              columnNumber: error.columnNumber,
              stack: error.stack
            }
          });
        }
        break;
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
});
