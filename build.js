const path = require('path')
const webpack = require('webpack')

var destination = 'dist'
var modulePath = [ 'node_modules' ]
var project = { src_root: __dirname, build: 'release' } /* default project when running in dcp-client repo */

if (process.env.NODE_PATH) {
  process.env.NODE_PATH.split(/[:;]/).forEach(path => {
    if (path.length) {
      modulePath.unshift(path)
    }
  })
}

if (process.env.DCP_REPO_ROOT) {
  /* dcp project - pull in configuration */
  project.src_root = path.resolve(process.env.DCP_REPO_ROOT)
  project = {...project, ...(JSON.parse(require('fs').readFileSync(path.join(project.src_root, 'etc', 'local-config.json'), 'utf-8'))) }
}

webpack({
  mode: project.build === 'debug' ? 'development' : 'production',
  optimization: { minimize: project.build !== 'debug' },
  entry: './node_modules/dcp/src/protocol.js',
  output: {
    filename: 'protocol.min.js',
    path: path.resolve(__dirname, destination)
  },
  resolve: {
    modules: modulePath,
    alias: {
      '/node_modules': path.resolve(project.src_root, 'node_modules')
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
  mode: project.build === 'debug' ? 'development' : 'production',
  optimization: { minimize: project.build !== 'debug' },
  entry: './node_modules/dcp/src/compute.js',
  output: {
    filename: 'compute.min.js',
    path: path.resolve(__dirname, destination)
  },
  resolve: {
    modules: modulePath,
    alias: {
      '/node_modules': path.resolve(project.src_root, 'node_modules')
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
