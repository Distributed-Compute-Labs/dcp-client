const path = require('path')
const webpack = require('webpack')

var destination = 'dist'

webpack({
  mode: 'production',
  entry: './node_modules/dcp/src/protocol.js',
  output: {
    filename: 'protocol.min.js',
    path: path.resolve(__dirname, destination)
  }
}, (error, stats) => {
  if (error) {
    console.log(error)
  }
  
  console.log(stats.errors)

  console.log('Protocol Minified')
})

webpack({
  mode: 'production',
  entry: './node_modules/dcp/src/compute.js',
  output: {
    filename: 'compute.min.js',
    path: path.resolve(__dirname, destination)
  }
}, (error, stats) => {
  if (error) {
    console.log(error)
  }

  console.log(stats.errors)

  console.log('Compute Minified')
})

webpack({
  mode: 'production',
  entry: './entry/bundle.js',
  stats: 'errors-only',
  output: {
    filename: 'bundle.min.js',
    path: path.resolve(__dirname, destination)
  }
}, (error, stats) => {
  if (error) {
    console.log(error)
  }

  console.log(stats.errors)

  console.log('Both bundled')
})
