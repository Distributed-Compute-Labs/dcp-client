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
const bundleSandbox = {
  require: require,
  console: console,
  setInterval: setInterval,
  URL: URL,
  dcpConfig: {
    scheduler: {
      location: new URL('http://bootstrap.distributed.computer/')
    }, bank: {
      location: new URL('http://bootstrap.distributed.computer/')
    }, packageManager: {
      location: new URL('http://bootstrap.distributed.computer/')
    },
    needs: { urlPatchup: true }
  },
}

/** Evaluate a file in a sandbox without polluting the global object.
 *  @param      filename        {string}        The name of the file to evaluate, relative to
 *  @param      sandbox         A sandbox object, used for injecting 'global' symbols as needed
 */
function evalScriptInSandbox(filename, sandbox) {
  var code
  var context = require('vm').createContext(sandbox)
  try {
    code = require('fs').readFileSync(path.resolve(distDir, filename), 'utf-8')
  } catch(e) {
    if (exports.debug)
      console.log('evalScriptInSandbox Error:', e.message)
    if (e.code === 'ENOENT')
      return {}
    throw e
  }

  return require('vm').runInContext(code, context, filename, 0) // eslint-disable-line
}

function evalStringInSandbox(code, sandbox, filename) {
  var context = require('vm').createContext(sandbox)
  return require('vm').runInContext(code, context, filename || '(dcp-client$$evalStringInSandbox)', 0) // eslint-disable-line
}

/** Load the bootstrap bundle - used to plumb in protocol.justFetch */
function loadBootstrapBundle() {
  let sandbox = {}

  Object.assign(sandbox, bundleSandbox)
  sandbox.window = sandbox
  return evalScriptInSandbox('/home/wes/git/dcp/build-system/dist/dcp-client-bundle.js', sandbox)
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
function justFetchPrettyError(error, useChalk) {
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

/** Merge a new configuration object on top of an existing one. The new object
 *  is overlaid on the existing object, so that properties specified in the 
 *  existing object graph overwrite, but unspecified edges are left alone.
 *
 * *note* -     We treat objects with constructors other than Function or Object
 *              as though they were primitive values, as they may contain internal 
 *              state that is not represented solely by their own properties
 * 
 * @param       {object}        existing        The top node of an object graph whose 
 *                                              edges may be replaced
 * @param       {object}        neo             The top node of an object graph whose
 *                                              edges describe the replacement
 */
function addConfig (existing, neo) {
  for (let prop in neo) {
    if (!neo.hasOwnProperty(prop)) { continue }
    if (typeof neo[prop] === 'object' && !Array.isArray(neo[prop]) && ['Function','Object'].includes(neo[prop].constructor.name)) {
      if (typeof existing[prop] === 'undefined') {
        existing[prop] = {}
      }
      addConfig(existing[prop], neo[prop])
    } else {
      existing[prop] = neo[prop]
    }
  }
}

/**
 * Initialize the dcp-client bundle for use by the compute API, etc.  The steps that are followed
 * are in a very careful order; there are default configuration options which can be overridden by
 * either the API consumer or the scheduler; it is important that the wishes of the API consumer 
 * always take priority.
 *
 *  1 - load the local copy of the bundle
 *  2 - use this copy to plumb in global.XMLHttpRequest which lives forever -- that way KeepAlive etc works.
 *  3 - merge the passed-in configuration with the default configuration
 *  4 - use the config + environment + arguments to figure out where the scheduler is
 *  5 - pull the scheduler's config, and layer it on top of the current configuration
 *  6 - reapply the passed-in configuration into the current configuration
 *  7 - use the new/current configuration to figure out if we are supposed to pull a remote
 *      bundle (autoUpdate) and, if so, from where
 *  8 - activate either the local bundle or the remote bundle against a fresh sandbox using the
 *      latest config: this causes it to (unfortunately) cache configuration values like the location
 *      of the scheduler
 */
exports.init = async function dcpClient$$init() {
  let dcpConfig = require('dcp-config')
  let userConfig
  let remoteConfigCode
  let finalBundleCode
//  let URL = require('dcp-url').URL
  
  /* Sort of polymorphic arguments: 'passed-in configuration' */
  if (typeof arguments[0] === 'string' || (typeof arguments[0] === 'object' && arguments[0] instanceof URL) ) {
    userConfig = { scheduler: { location: arguments[0] }, bundle: {} }
  } else if (typeof arguments[0] === 'object') {
    userConfig = arguments[0]
  } else {
    userConfig = { scheduler: {}, bundle: {} }
  }
  if (arguments[1])
    userConfig.bundle.autoUpdate = !!arguments[1]
  if (arguments[2])
    userConfig.bundle.location = new URL(arguments[2])

  global.XMLHttpRequest = require('dcp-xhr').XMLHttpRequest /* 2 */

  /* 3 */
  dcpConfig.scheduler.location = new (require('dcp-url').URL)('https://scheduler.distributed.computer')
  if (userConfig)
    addConfig(dcpConfig, userConfig) 
  if (!dcpConfig.scheduler.configLocation)
    dcpConfig.scheduler.configLocation = dcpConfig.scheduler.location.resolve('etc/dcp-config.js') /* 4 */

  /* 4 */
  if (process.env.DCP_SCHEDULER_LOCATION)
    userConfig.scheduler.location = process.env.DCP_SCHEDULER_LOCATION
  if (process.env.DCP_SCHEDULER_CONFIGLOCATION)
    userConfig.scheduler.configLocation = process.env.DCP_SCHEDULER_CONFIGLOCATION
  if (process.env.DCP_BUNDLE_AUTOUPDATE)
    userConfig.bundle.location = !!process.env.DCP_BUNDLE_AUTOUPDATE.match(/^true$/i)
  if (process.env.DCP_BUNDLE_LOCATION)
    userConfig.bundle.location = process.env.DCP_BUNDLE_LOCATION
  if (userConfig.scheduler && typeof userConfig.scheduler.location === 'string')
    userConfig.scheduler.location = new URL(userConfig.scheduler.location)
  if (userConfig.bundle && typeof userConfig.bundle.location === 'string')
    userConfig.bundle.location = new URL(userConfig.bundle.location)
  
  /* 5 */
  if (exports.debug)
    console.log(` * Loading configuration from ${dcpConfig.scheduler.configLocation.href}`)
  try {
    remoteConfigCode = await require('protocol').justFetch(dcpConfig.scheduler.configLocation)
  } catch(e) {
    if (exports.debug)
      console.log(justFetchPrettyError(e))
    throw new Error(justFetchPrettyError(e, false))
  }

  /* 6 */
  bundleSandbox.window = bundleSandbox
  addConfig(dcpConfig, evalStringInSandbox(remoteConfigCode, bundleSandbox, dcpConfig.scheduler.configLocation))
  if (dcpConfig.needs && dcpConfig.needs.urlPatchup)
    require('dcp-url').patchup(dcpConfig)
  if (!dcpConfig.bundle.location)
    dcpConfig.bundle.location = dcpConfig.portal.location.resolve('dcp-client-bundle.js')
  if (userConfig)
    addConfig(dcpConfig, userConfig)

  /* 7 */
  if (dcpConfig.bundle.autoUpdate) {
    try {
      finalBundleCode = await require('protocol').justFetch(dcpConfig.bundle.location.href)
    } catch(e) {
      if (exports.debug)
        console.log(justFetchPrettyError(e))
      throw new Error(justFetchPrettyError(e, false))
    }
  } else {
    ;
  }
    
  /* 8 */
  if (finalBundleCode)
    evalStringInSandbox(finalBundleCode, bundleSandbox, dcpConfig.bundle.location.href)
  else
    evalScriptInSandbox('/home/wes/git/dcp/build-system/dist/dcp-client-bundle.js', bundleSandbox)
}
