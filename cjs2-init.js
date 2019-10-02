module.declare(['./ns-map'], function cjs2ShimModule(require, exports, module) {
  let realLoader = module.load
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

  console.log(require('./ns-map'))
  module.provide(['./dist/dcp-client-bundle'], function() {
    console.log('XXX hello')
    //require('./dist/dcp-client-bundle')
    module.provide(Object.keys(require('./ns-map')).map(key => '/webpack/' + key), function() {
      console.log('XXX world')
    })
  })
})
