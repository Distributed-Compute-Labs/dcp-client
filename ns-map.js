/**
 * @file        ns-map.js               Namespace map, for translating between API-consumer namespace
 *                                      and the webpacked client internal namespace.  This module can
 *                                      be loaded with either a CommonJS/1.0 (NodeJS) or /2.0 (BravoJS)
 *                                      module system.
 *
 *                                      Each export key is a module name to be exposed to dcp-client API-
 *                                      consumers; each export value is the property where that module 
 *                                      is stored on the webpack bundle.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Aug 2019
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

module.declare([], function $$nsMap(require, exports, module) {
  var moduleIdentifier;
  
  /* LHS: where symbols appear      RHS: where they come from in dcp-client-bundle-src.js */      
  exports['dcp/bootstrap-build']= 'dcp-build'
  exports['dcp/build']          = 'dcp-build' /* overridden when new version loaded */
  exports['dcp/dcp-config' ]    = 'dcp-config'

  for (moduleIdentifier of [
    'compute',
    'wallet',
    'protocol',
    'protocol-v4',
    'client-modal',
    'bank-util',
    'dcp-xhr',
    'dcp-env',
    'dcp-url',
    'dcp-cli',
    'dcp-timers',
    'dcp-dot-dir',
    'dcp-events',
    'eth',
    'serialize',
    'job',
    'range-object',
    'stats-ranges',
    'standard-objects',
    'worker',
    'utils',
    "publish",
  ]) exports['dcp/' + moduleIdentifier] = moduleIdentifier;

  /* Provide internal copies of third-party npm libraries when external (native?) copies not available */
  for (moduleIdentifier of [
    'ethereumjs-util',
    'ethereumjs-wallet',
    'ethereumjs-tx',
    'bignumber.js',
    'socket.io-client',
  ]) {
    try {
      require.resolve(moduleIdentifier);
    } catch(e) {
      if (e.code === 'MODULE_NOT_FOUND')
        exports[moduleIdentifier] = moduleIdentifier;
      else
        throw e;
    }
  }
  
}); /* end of module */
