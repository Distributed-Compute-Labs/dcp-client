/**
 *  @file       promiseDebug.js
 *
 *  A module to make promises a bit easier to debug on Node.js.
 *  This module is disabled when any of these conditions are true:
 *   - bluebird not installed
 *   - process.env.DCP_PROMISE_DEBUG is "falsey"
 *
 *   This module needs to be initialized from any Promise-use module
 *   whose promises we need to intercept.  Typical initialization:
 *
 *      global.Promise = Promise = require('/path/to/promiseDebug').hook()
 *
 *  *note* -    run node with --trace-warnings to see full stack traces for warnings
 *
 *  @author     Wes Garland, wgarland@kingsds.network
 *  @date       July 2018
 */

var debug = process.env.DCP_PROMISE_DEBUG_DEBUG
/**
 *  This function initializes the library, and should be called before any Promises are instanciated.
 *  This function does not actually hook the constructor.
 *
 *  @param      defaultPromiseConstructor       The constructor used to make promises when Bluebird
 *                                              is not available.
 *  @param      force                           If true, init even when not in debug build
 *  @returns    a Promise constructor
 */
exports.init = function init(defaultPromiseConstructor, force) {
  var bb

  if (typeof defaultPromiseConstructor === 'undefined')
    defaultPromiseConstructor = global.Promise

  if (!process.env.DCP_PROMISE_DEBUG || process.env.DCP_PROMISE_DEBUG === 'false') {
    let ctor = defaultPromiseConstructor || Promise
    if (debug)
      console.log('promiseDebug: init returning ' + (ctor === Promise ? 'global' : 'default') + ' constructor; build is', dcpConfig.build)
    return ctor
  }
 
  process.env.BLUEBIRD_DEBUG = "1"
  process.env.NODE_ENV="development"

  try {
    bb = require('bluebird')
  } catch(e) {
    if (debug)
      console.log('promiseDebug: BlueBird not installed')
    return defaultPromiseConstructor
  }

  if (debug) { console.log('promiseDebug: using BlueBird') }

  bb.config({
    longStackTraces: true,
    warnings: true
  })

  bb.config({})

  return bb
}

/** Initialize the library and try to hook the global Promise constructor and unhandled 
 *  promise rejections.  Not recommended for non-trivial programs which should be handling
 *  unhandled rejections on their own, eg. daemons using the shutdown module to report
 *  errors.
 *
 *  @param      defaultPromiseConstructor       The constructor used to make promises when Bluebird
 *  @param      force                           If true, init even when not in debug build
 *                                              is not available.
 *  @param      ignoreFn                        A function that will be called every time an unhandled
 *                                              rejection occurs. It receives the error as it's sole argument.
 *                                              If this function returns true, the rejection will be ignored.
 *  @returns    a Promise constructor
 */
exports.hook = function(defaultPromiseConstructor, force, ignoreFn) {
  bb = exports.init(defaultPromiseConstructor)

  if (bb !== defaultPromiseConstructor) {
    process.on('unhandledRejection', (reason, p) => {
      if (typeof ignoreFn === 'function' && ignoreFn(reason)) return;

      console.log('Unhandled Rejection caught by promiseDebug.hook at: Promise', p, 'reason:', reason);
    })
  }

  global.Promise = bb
  return bb
}
