const path = require('path')
const webpack = require('webpack')

var destination = 'dist'

webpack({
  mode: 'production',
  entry: './node_modules/dcp/src/protocol.js',
  output: {
    filename: 'protocol.min.js',
    path: path.resolve(__dirname, destination)
  },
  resolve: {
    alias: {
      '/node_modules': path.resolve(__dirname, 'node_modules')
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
    alias: {
      '/node_modules': path.resolve(__dirname, 'node_modules')
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
