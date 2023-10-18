/** 
 *  @file       evaluator-lib/script-load-wrapper.js
 * 
 *  This file provides a global function for all proceeding scripts to wrap their
 *  initialization. It will post messages about the success/failure of the script
 *  and handles wrapping of post message when the flag is set.
 * 
 *  @author     Ryan Rossiter, ryan@kingsds.network
 *  @date       September 2020
 */
(function scriptLoadWrapper()
{
  /* protectedStorage - passed as 1st arg to all script wrapScriptLoading fns. Private memo area where
   * various scripts can leave each things they will need but cannot share in global scope. Must not
   * leak any of these properties to work functions.
   */
  const protectedStorage = {}; 
  
  /* Add a console symbol to protectedStorage which is either the "real" console or a group of noops */
  protectedStorage.console = console || { };
  for (let method of ['log', 'error', 'debug', 'trace', 'warn'])
    if (typeof protectedStorage.console[method] !== 'function')
      protectedStorage.console[method] = function(){};
  
  /**
   * Wrap self.postMessage so we have a ringSource property. Allows checking for
   * the validity of a message in the sandbox. Setting currPostMessage - self.postMessage
   * as a constant, then always re-defining self.postMessage in terms of the initial
   * currPostMessage ensures we don't recursively add layers to our wrapping of postMessage.
   */
  let currentRing = -1;
  const currPostMessage = self.postMessage;
  const marshal = KVIN.marshal
  const serialize = JSON.stringify

  function wrapPostMessage() {
    const ringSource = ++currentRing;
    self.postMessage = function (value) {
      // Objects may not be transferable objects (https://developer.mozilla.org/en-US/docs/Glossary/Transferable_objects),
      // and can remain non-transferable even after kvin.marshal, and it is very hard to detect such objects. One such object
      // is the `arguments` object of any function. In such a case, we need to serialize the message on top of 
      const updatedMsg = marshal({ ringSource, value })
      try {
        currPostMessage(updatedMsg);
      }
      catch {
        const serializedMessage = {
          message: serialize(updatedMsg),
          serialized: true,
        };
        currPostMessage(serializedMessage);
      }
    }
  }
  //Initialize postMessage to ring 0
  wrapPostMessage()
  const ring0PostMessage = self.postMessage;

  /**
   * This function is used by evaluator scripts to wrap their evaluation so that
   * errors can be caught and reported, and to discourage pollution of the global
   * scope by enclosing them in a function scope.
   * 
   * @param {object} options
   * @param {string} options.scriptName The name of the script that is being loaded
   * @param {boolean} [options.ringTransition] When true, the global postMessage ring will be incremented before the function is invoked
   * @param {boolean} [options.finalScript] When true, the wrapScriptLoading function will be removed from the global scope afterwards
   * @param {function} fn
   */
  self.wrapScriptLoading = function scriptLoadWrapper$wrapScriptLoading(options, fn) {
    try {
      // capture the current postMessage before transitioning rings
      const fixedPostMessage = self.postMessage;
      if (options.ringTransition) {
        wrapPostMessage();
      }
      
      fn(protectedStorage, fixedPostMessage, wrapPostMessage)

      ring0PostMessage({
        request: 'scriptLoaded',
        script: options.scriptName,
        result: "success",
      });

      if (options.finalScript)
        delete self.wrapScriptLoading;

    } catch (e) {
      ring0PostMessage({
          request: 'scriptLoaded',
          script: options.scriptName,
          result: "failure",
          error: {
              name: e.name,
              message: e.message,
              stack: e.stack.replace(
                  /data:application\/javascript.*?:/g,
                  'eval:'
              ),
          }
      });
    }
  }
})();

self.wrapScriptLoading({ scriptName: 'script-load-wrapper' }, () => {
  // noop
});
