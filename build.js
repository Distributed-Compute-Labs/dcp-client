const path = require('path')
const webpack = require('webpack')

var destination = 'dist'
var modulePath = [ 'node_modules' ]
var projectRoot = process.env.DCP_ROOT || __dirname

if (process.env.NODE_PATH) {
  process.env.NODE_PATH.split(/[:;]/).forEach(path => {
    if (path.length) {
      modulePath.unshift(path)
    }
  })
}

webpack({
  mode: 'production',
  entry: './node_modules/dcp/src/protocol.js',
  output: {
    filename: 'protocol.min.js',
    path: path.resolve(__dirname, destination)
  },
  resolve: {
    modules: modulePath,
    alias: {
      '/node_modules': path.resolve(projectRoot, 'node_modules')
    }
  }
}, (error, stats) => {
  if (error) {
    console.log(error)
  }

  if (stats && stats.hasErrors()) {
    console.log(stats)
  }

  if (error || (stats && stats.hasErrors())) {
    console.log('Errors occured while minifying protocol, assume it failed.')
    return
  }

  console.log('Protocol Minified')
})

webpack({
  mode: 'production',
  entry: './node_modules/dcp/src/compute.js',
  output: {
    filename: 'compute.min.js',
    path: path.resolve(__dirname, destination)
  },
  resolve: {
    modules: modulePath,
    alias: {
      '/node_modules': path.resolve(projectRoot, 'node_modules')
    }
  },
  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /debug-worker/
    })
  ]
}, (error, stats) => {
  if (error) {
    console.log(error)
  }

  if (stats && stats.hasErrors()) {
    console.log(stats)
  }

  if (error || (stats && stats.hasErrors())) {
    console.log('Errors occured while minifying compute, assume it failed.')
    return
  }

  console.log('Compute Minified')
})
