/**
 *  @file       init-common.js          Common code for both NodeJS and Modules/2.0 client bundle initialization.
 *  @author     Wes Garland, wes@kingsds.network
 *  @date       Aug 2019
 */

if (typeof module.declare === 'undefined') { /* cjs1 */
  module.declare = function moduleDeclarePolyfill(deps, factory) {
    if (!factory) {
      factory = deps
      deps = undefined
    }

    factory(require, exports, module)
  }
}

module.declare([], function (require, exports, module) {
/** 
 * Initialize the DCP Client Bundle. Similar to init(), except we do not return a promise; 
 * instead, we invoke callbacks.
 * 
 * @param       successHandler  {function}      optional callback which is invoked when we have finished initialization
 * @param       errorHandler    {function}      optional callback which is invoked when there was an error during initialization. 
 * @throws if we have an error and errorHandler is undefined
 * 
 * @note        Once successHandler and errorHandler have been consumed, the remaining arguments are passed to pinit().
 */
exports.initcb = function (successHandler, errorHandler) {
  arguments = Array.from(arguments)
  if (typeof successHandler === 'function' || typeof errorHandler === 'function')
    arguments.splice(0,1)
  else
    successHandler = false

  if (typeof errorHandler === 'function')
    arguments.splice(0,1)
  else
    errorHandler = false

  let stack = new Error().stack
  exports.init.apply(null, arguments).then(
    function dcpClient$$init$then(){
      if (successHandler)
        successHandler()
    }
  ).catch(
    function dcpClient$$init$catch(e) {
      if (errorHandler)
        errorHandler(e)
      else {
        e.stack += new Error().stack + '\n' + stack
        setImmediate(()=>{throw e})
      }
    }
  )
}
}) /* end of module */

