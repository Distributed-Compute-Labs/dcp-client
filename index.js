/**
 * @file        index.js        
 *              NodeJS entry point for the dcp-client package.
 *
 *              During module initialization, we load dist/dcp-client-bundle.js from the 
 *              same directory as this file, and inject the exported modules into the NodeJS 
 *              module environment. 
 *
 *              During init(), we wire up require('dcp-xhr') to provide global.XMLHttpRequest, 
 *              from the local bundle, allowing us to immediately start using an Agent which 
 *              understands proxies and keepalive.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        July 2019
 */

exports.debug = process.env.DCP_CLIENT_DEBUG
const path = require('path')
const distDir = path.resolve(path.dirname(module.filename), 'dist')
const moduleSystem = require('module')

/** Evaluate a file in a sandbox without polluting the global object.
 *  @param      filename        {string}        The name of the file to evaluate, relative to
 *  @param      sandbox         A sandbox object, used for injecting 'global' symbols as needed
 */
function evalScript(filename, sandbox) {
  var code
  var context = require('vm').createContext(sandbox)
  try {
    code = require('fs').readFileSync(path.resolve(distDir, filename), 'utf-8')
  } catch(e) {
    if (exports.debug)
      console.log('evalScript Error:', e.message)
    if (e.code === 'ENOENT')
      return {}
    throw e
  }

  return require('vm').runInContext(code, context, filename, 0) // eslint-disable-line
}

/** Load the bootstrap bundle - used to plumb in protocol.justFetch */
function loadBootstrapBundle() {
  let dcpConfig = { scheduler: {}, bank: {}, packageManager: {}, needs: { urlPatchup: true }} 
  dcpConfig.scheduler.location
    = dcpConfig.bank.location
    = dcpConfig.packageManager.location
    = new URL('http://bootstrap.distributed.computer/')
  
  return evalScript('/home/wes/git/dcp/build-system/dist/dcp-client-bundle.js',
                    {
                      dcpConfig: dcpConfig,
                      setInterval: setInterval,
                      require: require,
                      console: console,
                      URL: URL,
                    })
}

const injectedModules = {}
const resolveFilenameReal = moduleSystem._resolveFilename;
moduleSystem._resolveFilename = function dcpClient$$injectModule$resolveFilenameShim(moduleIdentifier) { 
  if (injectedModules.hasOwnProperty(moduleIdentifier))
    return moduleIdentifier;
  return resolveFilenameReal.apply(null, arguments)
}
/** 
 * Inject an initialized module into the native NodeJS module system. 
 *
 * @param       id              {string}        module identifier
 * @param       exports         {object}        the module's exports object
 */
function injectModule(id, exports) {
  moduleSystem._cache[id] = new (moduleSystem.Module)
  moduleSystem._cache[id].id = id
  moduleSystem._cache[id].parent = module
  moduleSystem._cache[id].exports = exports
  moduleSystem._cache[id].filename = id
  moduleSystem._cache[id].loaded = true
  injectedModules[id] = true
}

/* Inject all properties of the bundle object as modules in the
 * native NodeJS module system.
 */
Object.entries(loadBootstrapBundle()).forEach(entry => {
  let [id, exports] = entry
  injectModule(id, exports)
})

/** Reformat an error (rejection) message from protocol.justFetch, so that debugging code 
 *  can include (for example) a text-rendered version of the remote 404 page.
 *
 *  @param      {object}        error   The rejection from justFetch()
 *  @returns    {string}        An error message, formatted with ANSI color when the output
 *                              is a terminal, suitable for writing directly to stdout. If
 *                              the response included html content (eg a 404 page), it is 
 *                              rendered to text in this string.
 */
function justFetchPrettyReject(error, useChalk) {
  let chalk, message, headers={}

  if (!error.request || !error.request.status)
    return error.message

  if (typeof useChalk === 'undefined')
    useChalk = require('tty').isatty(0)
  chalk = new require('chalk').constructor({enabled: useChalk})

  error.request.getAllResponseHeaders().replace(/\r/g,'').split('\n').forEach(function(line) {
    var colon = line.indexOf(': ')
    headers[line.slice(0,colon)] = line.slice(colon+2)
  })
  message = `HTTP Status: ${error.request.status} for ${error.request.method} ${error.request.location}`

  switch(headers['content-type'].replace(/;.*$/, '')) {
  case 'text/plain':
    message += '\n' + chalk.grey(error.request.responseText)
    break;
  case 'text/html':
    message += '\n' + chalk.grey(require('html-to-text').fromString(error.request.responseText, {
      wordwrap: parseInt(process.env.COLUMNS, 10) || 80,
      format: {
        heading: function (elem, fn, options) {
          var h = fn(elem.children, options);
          return '====\n' + chalk.yellow(chalk.bold(h.toUpperCase())) + '\n====';
        }
      }}))
    break;
  }

  return message
}    

exports.init = async function dcpClient$$init(userConfig) {
  let dcpConfig = require('dcp-config')
  if (userConfig)
    Object.assign(dcpConfig, userConfig)
  global.XMLHttpRequest = require('dcp-xhr').XMLHttpRequest

  dcpConfig.scheduler.location = new (require('dcp-url').URL)('https://scheduler.distributed.computer')
  if (exports.debug)
    dcpConfig.scheduler.location.resolve('etc/dcp-config')
  try {
    debugger
    let newBundle = await require('protocol').justFetch(dcpConfig.scheduler.location.resolve('etc/dcp-config'))
  } catch(e) {
    if (exports.debug) {
      console.log(justFetchPrettyReject(e))
    }
    throw new Error(justFetchPrettyReject(e, false))
  }

  add in remote config we just fetched
  then add in userConfig
  then pull the next bundle if appropriate
  done
}
