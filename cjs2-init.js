/** 
 *  @file       cjs2-init.js            dcp-client initialization code for CommonJS Modules/2.0 environments.
 *  @author     Wes Garland, wes@kingsds.network
 *  @date       Aug 2019
 */

module.declare(['./init-common', './ns-map'], function cjs2ShimModule(require, exports, module) {
  let realLoader = module.load

  function injectModule(moduleId, exports) { /* @todo fix bravojs-specific code */
    bravojs.requireMemo['/webpack/' + moduleId] = exports
  }
  injectModule('dcp/env-native', { platform: 'bravojs' })
  require.paths.unshift('/webpack')

  module.constructor.prototype.load = function(s,f) {
    let re = new RegExp('^/webpack/')

    if (re.exec(s)) {
      let bundle = require('./dist/dcp-client-bundle')
      let builtinName = s.replace(re, '')
      let builtinModule = bundle[require('./ns-map')[builtinName]]
      require.memoize(s, [], function builtinModuleWrapper(require, exports, module) {
        Object.assign(exports, builtinModule)
        Object.setPrototypeOf(exports, Object.getPrototypeOf(builtinModule))
      })
      f()
    } else {
      realLoader.apply(null, arguments)
    }
  }

/**
 * Initialize the dcp-client bundle for use by the compute API, etc.
 *
 * @note    This function currently does not support any arguments, however
 *          future versions will largely mirror the NodeJS version found in
 *          the index.js module.
 */
  exports.init = function cjs2Init$$init() {
    var P = new Promise(function cjs2Init$$init$p(resolve, reject) {
      module.provide(['./dist/dcp-client-bundle'], function() {
        try {
          module.provide(Object.keys(require('./ns-map')).map(key => '/webpack/' + key), function() {
            require('dcp/dcp-env').setPlatform(bravojs ? "bravojs" : "cjs2-generic")
            resolve('initialized')
          })
        } catch(e) {
          reject(e)
        }
      })
    })
    return P
  }

  exports.initcb = require('./init-common').initcb
})
