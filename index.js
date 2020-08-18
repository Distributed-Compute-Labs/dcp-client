/**
 * @file        index.js
 *              NodeJS entry point for the dcp-client package.
 *
 *              During module initialization, we load dist/dcp-client-bundle.js from the
 *              same directory as this file, and inject the exported modules into the NodeJS
 *              module environment.
 *
 *              There are three initialization styles provided, which are all basically the same, 
 *              have different calling styles;
 *              1. initSync - blocks until initialization is complete
 *              2. init     - returns a Promise, is an "async" function; resolve when initialization is complete
 *              3. initcb   - invokes a callback when initialization is complete
 *
 *              During initialization, we 
 *              1. wire up require('dcp/dcp-xhr') to provide global.XMLHttpRequest from the local bundle, 
 *                 allowing us to immediately start using an Agent which understands HTTP proxies and 
 *                 and keepalive,
 *              2. build the layered dcp-config for the program invoking init 
 *                 (see: https://people.kingsds.network/wesgarland/dcp-client-priorities.html /wg aug 2020)
 *              3. download a new bundle if auto-update is on
 *              4. make the bundle "see" the layered dcp-config as their global dcpConfig
 *              5. re-inject the bundle modules (possibly from the new bundle) 
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        July 2019
 */
const os      = require('os');
const fs      = require('fs')
const path    = require('path');
const process = require('process');

exports.debug = false;
let initInvoked = false; /* flag to help us detect use of Compute API before init */

function debugging(what) {
  const debugSyms = []
        .concat((exports.debug || '').split(','))
        .concat((process.env.DCP_CLIENT_DEBUG || '').split(','))
        .filter((a) => !!a);
  
  if (typeof debugging.cache[what] === 'boolean') /* cache hit */
    return debugging.cache[what];

  if (-1 !== debugSyms.indexOf('*') ||
      -1 !== debugSyms.indexOf('all') ||
      -1 !== debugSyms.indexOf('all:all') ||
      -1 !== debugSyms.indexOf(what) ||
      -1 !== debugSyms.indexOf('dcp-client') ||
      -1 !== debugSyms.indexOf('verbose')) {
    debugging.cache[what] = true;
  } else {
    debugging.cache[what] = false;
  }

  return debugging.cache[what];
}
debugging.cache = {}

const _initForTestHarnessSymbol = {}
const _initForSyncSymbol = {};
const distDir = path.resolve(path.dirname(module.filename), 'dist')
const moduleSystem = require('module')
const bundleSandbox = {
  crypto: { getRandomValues: require('polyfill-crypto.getrandomvalues') },
  require: require,
  console: console,
  setInterval: setInterval,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  URL: URL,
  dcpConfig: {
    bundleConfig: true,
    scheduler: {
    }, bank: {
      location: new URL('http://bootstrap.distributed.computer/')
    }, packageManager: {
      location: new URL('http://bootstrap.distributed.computer/')
    },
    needs: { urlPatchup: true }
  },
}

/** Evaluate a file in a sandbox without polluting the global object.
 *  @param      filename        {string}    The name of the file to evaluate, relative to
 *  @param      sandbox         {object}    A sandbox object, used for injecting 'global' symbols as needed
 *  @param      olFlag          {boolean}   true if the file contains only an object literal
 */
function evalScriptInSandbox(filename, sandbox, olFlag) {
  var code
  var context = require('vm').createContext(sandbox)
  try {
    code = fs.readFileSync(path.resolve(distDir, filename), 'utf-8')
    if (olFlag)
      code = '(' + code + ')'
  } catch(e) {
    debugging() && console.error('evalScriptInSandbox Error:', e.message);
    if (e.code === 'ENOENT')
      return {}
    throw e
  }

  return require('vm').runInContext(code, context, filename, 0) // eslint-disable-line
}

/** Evaluate code in a secure sandbox; in this case, the code is the configuration
 *  file, and the sandbox is a special container with limited objects that we setup
 *  during config file processing.
 *
 *  @param      code     {string}        The code to eval
 *  @param      context  {object}        An object that has been initialized as a context
 *                                       that will act like the context's global object
 *  @param      filename {string}        The name of the file we're evaluating for stack-
 *                                       trace purposes.
 */
function evalStringInSandbox(code, sandbox, filename) {
  var context = require('vm').createContext(sandbox)
  var ret

  ret = require('vm').runInContext(code, context, filename || '(dcp-client$$evalStringInSandbox)', 0) // eslint-disable-line
  return ret;
}

/** Load the bootstrap bundle - used primarily to plumb in protocol.justFetch.
 *  Runs in a different, but identical, sandbox as the config files and client code.
 */
function loadBootstrapBundle() {
  let sandbox = {}

  Object.assign(sandbox, bundleSandbox)
  sandbox.window = sandbox
  sandbox.globalThis = sandbox;
  
  return evalScriptInSandbox(path.resolve(distDir, 'dcp-client-bundle.js'), sandbox)
}

const injectedModules = {};
const resolveFilenamePrevious = moduleSystem._resolveFilename;
moduleSystem._resolveFilename = function dcpClient$$injectModule$resolveFilenameShim(moduleIdentifier) { 
  if (injectedModules.hasOwnProperty(moduleIdentifier)) {
    if (!initInvoked) {
      if( moduleIdentifier === 'dcp/compute') throw new Error(`module ${moduleIdentifier} cannot be required until the dcp-client::init() promise has been resolved.`);
    }
    return moduleIdentifier;
  }
  return resolveFilenamePrevious.apply(null, arguments)
}
/** 
 * Inject an initialized module into the native NodeJS module system. 
 *
 * @param       id              {string}        module identifier
 * @param       moduleExports   {object}        the module's exports object
 * @param       clobber         {boolean}       inject on top of an existing module identifier
 *                                              if there is a collsion.
 * @throw Error if there is a collision and clobber is not truey.
 */
function injectModule(id, moduleExports, clobber) {
  if (!clobber && typeof moduleSystem._cache[id] !== 'undefined')
    throw new Error(`Module ${id} has already been injected`);
  moduleSystem._cache[id] = new (moduleSystem.Module)
  moduleSystem._cache[id].id = id
  moduleSystem._cache[id].parent = module
  moduleSystem._cache[id].exports = moduleExports
  moduleSystem._cache[id].filename = id
  moduleSystem._cache[id].loaded = true
  injectedModules[id] = true;
  debugging('modules') && console.debug(` - injected module ${id}: ${typeof moduleExports === 'object' ? Object.keys(moduleExports) : '(' + typeof moduleExports + ')'}`);
}

injectModule('dcp/env-native', { platform: 'nodejs' })

/* Inject all properties of the bundle object as modules in the
 * native NodeJS module system.
 */
let bundle = loadBootstrapBundle()
let nsMap = require('./ns-map')

debugging('modules') && console.debug('Begin phase 1 module injection')  /* Just enough to be able to load a second bundle */
for (let moduleId in nsMap) {
  let moduleExports = bundle[nsMap[moduleId]]
  if (!moduleExports)
    throw new Error(`Bundle is missing exports for module ${moduleId}`)
  injectModule(moduleId, moduleExports)
}

/** Reformat an error (rejection) message from protocol.justFetch, so that debugging code 
 *  can include (for example) a text-rendered version of the remote 404 page.
 *
 *  @param      {object}        error   The rejection from justFetch()
 *  @returns    {string}        An error message, formatted with ANSI color when the output
 *                              is a terminal, suitable for writing directly to stdout. If
 *                              the response included html content (eg a 404 page), it is 
 *                              rendered to text in this string.
 */
exports.justFetchPrettyError = function dcpClient$$justFetchPrettyError(error, useChalk) {
  let chalk, message, headers={}

  if (!error.request || !error.request.status)
    return error;

  if (typeof useChalk === 'undefined')
    useChalk = require('tty').isatty(0) || process.env.FORCE_COLOR;
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
    case 'text/html': {
      let html = error.request.responseText;

      html = html.replace(/\n<a/gi, ' <a'); /* html-to-text bug, affects google 301s /wg jun 2020 */
      message += chalk.grey(require('html-to-text').fromString(html, {
        wordwrap: parseInt(process.env.COLUMNS, 10) || 80,
        hideLinkHrefIfSameAsText: true,
        format: {
          heading: function (elem, fn, options) {
            var h = fn(elem.children, options);
            return '\n====\n' + chalk.yellow(chalk.bold(h.toUpperCase())) + '\n====\n';
          }
        }
      }));
      break;
    }
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
  /* @todo 'XXXX need to fix URLs still'); */
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

function checkConfigFileSafePerms(fullPath) {
  let newPath
  let args = fullPath.split(path.sep)
  
  args[0] += path.sep
  do
  {
    let check
    check=path.resolve.apply(null, args)
    if (fs.statSync(check).mode & 0o002)
      console.warn(`Config ${fullPath} insecure due to world-writeable ${check}`);
    args.pop()
  } while(args.length);
}


/** Merge a new configuration object on top of an existing one, via
 *  addConfig().  The file is read, turned into an object, and becomes
 *  the neo config.
 *
 *  Any falsey path component causes us to not read the file. This silent
 *  failure is desired behaviour.
 */
function addConfigFile(existing /*, file path components ... */) {
  let fullPath = '';

  debugging() && console.debug(` * Loading configuration from ${Array.from(arguments).slice(1).join(path.sep)}`);

  for (let i=1; i < arguments.length; i++) {
    if (!arguments[i])
      return;
    fullPath = path.join(fullPath, arguments[i]);
  }

  if (fullPath && fs.existsSync(fullPath)) {
    let neo;
    let code
    
    checkConfigFileSafePerms(fullPath);
    code = fs.readFileSync(fullPath, 'utf-8');

    if (code.match(/^\s*{/)) {
      let neo = evalScriptInSandbox(fullPath, bundleSandbox, true);
      addConfig(existing, neo);
    } else {
      let configSandbox = {}
      configSandbox.console = console
      Object.assign(configSandbox, bundleSandbox)
      Object.assign(configSandbox, existing);
      evalStringInSandbox(code, configSandbox, fullPath);
    }
    addConfig(existing, neo);
  }
}

/** Merge a new configuration object on top of an existing one, via
 *  addConfig().  The registry key is read, turned into an object, and 
 *  becomes the neo config.
 */
async function addConfigRKey(existing, hive, keyTail) {
  return;
  //  var neo = await require('./windows-registry').getObject(hive, keyTail);
  neo=false;
//  debugging() && console.debug(` * Loading configuration from ${hive} ${keyTail}`);

  if (neo)
    addConfig(existing, neo);
}

/** Merge a new configuration object on top of an existing one, via
 *  addConfig().  The environment is read, turned into an object, and
 *  becomes the neo config.
 */
function addConfigEnviron(existing, prefix) {
  var re = new RegExp('^' + prefix);
  var neo = {};
  
  for (let v in process.env) {
    if (!process.env.hasOwnProperty(v) || !v.match(re)) {
      continue
    }
    if (process.env[v][0] === '{') {
      let prop = fixCase(v.slice(prefix.length))
      if (typeof neo[prop] !== 'object') {
        neo[prop] = {}
      }
      addConfig(neo[prop], JSON.parse(process.env[v]))
    } else {
      if (typeof neo[prop] === "object") {
        throw new Error("Cannot override configuration property " + prop + " with a string (is an object)")
      }
      neo[prop] = process.env[v]
    }
  }

  addConfig(existing, neo);
}

/** 
 * Tasks which are run in the early phases of initialization
 * - plumb in global.XMLHttpRequest which lives forever -- that way KeepAlive etc works.
 */
function initHead() {
  initInvoked = true; /* Allow us to eval require("dcp/compute"); from config */
  global.XMLHttpRequest = require('dcp/dcp-xhr').XMLHttpRequest;
}

/** 
 * Tasks which are run in the late phases of initialization:
 * 1 - re-export the modules from the new bundle
 * 2 - load and cache identity & bank keystores if they are provided and config.parseArgv is true
 * 
 * @returns the same `dcp` object as we expose in the vanilla-web dcp-client
 */
function initTail() {
  /* 1 */
  debugging('modules') && console.debug('Begin phase 2 module injection');
  Object.entries(bundle).forEach(entry => {
    let [id, moduleExports] = entry
    if (id !== 'dcp-config') {
      injectModule('dcp/' + id, moduleExports, typeof nsMap['dcp/' + id] !== 'undefined')
    }
  })

  if (global.dcpConfig) {
    /* dcpConfig was defined before dcp-client was initialized: assume dev knows what he/she is doing */
    debugging() && console.debug('Dropping bundle dcp-config in favour of global dcpConfig')
    bundleSandbox.dcpConfig = require('dcp/dcp-client') = global.dcpConfig;
    injectModule('dcp/dcp-config', global.dcpConfig, true);
  } else {
    Object.assign(defaultConfig, aggrConfig);
    debugger;
  }

  Object.defineProperty(exports, 'distDir', {
    value: function dcpClient$$distDir$getter() {
      return distDir;
    },
    configurable: false,
    writable: false,
    enumerable: false
  })

  injectModule('dcp/client', exports);

  /* 2 */
  if (aggrConfig.parseArgv) {
    const dcpCli = require('dcp/dcp-cli');
    // don't enable help output for init
    const argv = dcpCli.base().help(false).argv;
    const { help, identity, identityFile, defaultBankAccount, defaultBankAccountFile } = argv;

    if (!help) {
      const wallet = require('dcp/wallet');
      if (identity || identityFile) {
        const idKs_p = dcpCli.getIdentityKeystore();
        wallet.addId(idKs_p);
      }

      if (defaultBankAccount || defaultBankAccountFile) {
        const bankKs_p = dcpCli.getAccountKeystore();
        wallet.add(bankKs_p);
      }
    }
  }

  return makeInitReturnObject();
}

/**
 * Initialize the dcp-client bundle for use by the compute API, etc.
 *
 * @param       {string|URL object}     [url="https://scheduler.distribtued.computer"]
 *                                      Location of scheduler, from whom we download
 *                                      dcp-config.js, which in turn tells us where to
 *                                      find the bundle.
 * @param       {boolean}               [autoUpdate=false]
 * @param       {string|URL object}     [bundleLocation]        The location of the autoUpdate
 *                                      bundle; used to override the bunde.location in the
 *                                      remote dcpConfig.
 *
 * @returns     a Promise which resolves to the dcpConfig which bundle-supplied libraries will see.
 *//**
 * Initialize the dcp-client bundle for use by the compute API, etc.
 *
 * @param       {object}                dcpConfig       a dcpConfig object which can have
 *                                                      scheduler.location, bundle.location, bundle.autoUpdate
 * @returns     a Promise which resolves to the dcpConfig which bundle-supplied libraries will see.
 */
exports.init = async function dcpClient$$init() {
  initHead();
  await exports.createAggregateConfig.apply(null, arguments);
  initTail();
}

exports.createAggregateConfig() = async function dcpClient$$aggregateConfig() {
/* The steps that are followed are in a very careful order; there are default configuration options 
 * which can be overridden by either the API consumer or the scheduler; it is important that the wishes 
 * of the API consumer always take priority.
 *
 *  1 - create the local config by 
 *       - reading the config buried in the bundle and defined at module load
 *       - reading ~/.dcp/dcp-client/dcp-config.js or using hard-coded defaults
 *       - reading the registry
 *       - receiving input from the dcp-cli module
 *       - arguments to init()
 *       - etc  (see dcp-docs file dcp-config-file-regkey-priorities)
 *  3 - merge the passed-in configuration on top of the default configuration
 *  4 - use the config + environment + arguments to figure out where the scheduler is
 *  5 - pull the scheduler's config, and layer it on top of the current configuration
 *  6 - reapply the passed-in configuration into the current configuration
 *  7 - use the new/current configuration to figure out if we are supposed to pull a remote
 *      bundle (autoUpdate) and, if so, from where
 *  8 - activate either the local bundle or the remote bundle against a fresh sandbox using the
 *      latest config: this causes it to (unfortunately) cache configuration values like the location
 *      of the scheduler

 *
 * Note re strategy - we always write to localConfig and read from aggrConfig. We sync aggr to local
 * before any reads.  This lets us rebuild aggr from various sources at any future point without
 * conflating local configuration and defaults, either hard-coded or remote.
 */
  let defaultConfig = require('dcp/dcp-config'); /* dcpConfig from bundle */
  let remoteConfigCode = false;
  let finalBundleCode
  let localConfig = { scheduler: {}, bundle: {} };
  let aggrConfig = {};
  let parseArgv = process.argv.length > 1;
  let URL = require('dcp/dcp-url').URL
  let testHarnessMode = false
  let initSyncMode = false;
  let etc  = (require('os').platform() === 'win32') ? process.env.ALLUSERSPROFILE : '/etc';

  defaultConfig.DEFAULT_CONFIG=true;
  localConfig.LOCAL_CONFIG=true;

  debugger;
  defaultConfig.TEST = 413;
  /* Peel off first argument if it is a secret-internal-API mode selector. */
  arguments = Array.from(arguments);
  if (arguments[0] === _initForTestHarnessSymbol) {
    arguments.shift();
    testHarnessMode = true; /* test harness => no local config, no remote config */
  } else if (arguments[0] === _initForSyncSymbol) {
    arguments.shift();
    initSyncMode = true;    /* sync mode => use external process to fetch remote config */
  }
  defaultConfig.TEST = 423;
  
  /* Fix all future files containing new URL() to use dcp-url::URL */
  bundleSandbox.URL = URL
  if (defaultConfig.needs && defaultConfig.needs.urlPatchup)
    require('dcp/dcp-url').patchup(defaultConfig)

  defaultConfig.TEST = 431;

  /* 1 - create local config */
  addConfig(aggrConfig, defaultConfig);
  defaultConfig.TEST = 435;
  if (process.env.DCP_CLIENT_TEST_HARNESS_MODE_HOMEDIR_CONFIG_PATH) {
    addConfigFile(localConfig, process.env.DCP_CLIENT_TEST_HARNESS_MODE_HOMEDIR_CONFIG_PATH);
    defaultConfig.TEST = 438;
  } else {
    defaultConfig.TEST = 440;
    let home = os.homedir();
    let programName = process.argv[1] ? path.basename(process.argv[1], '.js') : false;
        
    /* This follows spec doc line-by-line */
    console.log('start');
    await (async function crap() { return 123 })();
    await addConfigRKey(localConfig, 'HKLM', 'dcp-client/dcp-config');
    await addConfigFile(localConfig, etc,    'dcp-client/dcp-config.js');
    await addConfigRKey(localConfig, 'HKLM', `dcp-client/${programName}/dcp-config`);
    await addConfigFile(localConfig, etc,    `dcp-client/${programName}/dcp-config.js`); 
    await addConfigFile(localConfig, home,   '.dcp/dcp-client/dcp-config.js');
    await addConfigFile(localConfig, home,   `.dcp/dcp-client/${programName}/dcp-config.js`); 
    await addConfigRKey(localConfig, 'HKCU', `dcp-client/dcp-config`);
    await addConfigRKey(localConfig, 'HKCU', `dcp-client/${programName}/dcp-config`);
  }

  console.log('assigning');
  defaultConfig.TEST = 454;
  console.log('assigned', defaultConfig.TEST);

  /* Sort out polymorphic arguments: 'passed-in configuration'.
   * bug: this should be CLI then paseed-in config, but dcp-cli replaces passed-in configuration here. /wg aug 2020
   */
  if (arguments[0]) {
    if (typeof arguments[0] === 'string' || (typeof arguments[0] === 'object' && arguments[0] instanceof global.URL)) {
      addConfig(localConfig, { scheduler: { location: new URL(arguments[0]) }});
    } else if (typeof arguments[0] === 'object') {
      addConfig(localConfig, arguments[0]);
    }
  }
  if (arguments[1])
    localConfig.bundle.autoUpdate = !!arguments[1];
  if (arguments[2])
    localConfig.bundle.location = new URL(arguments[2]);

  await addConfigEnviron(localConfig, 'DCP_CONFIG_');
  await addConfigFile(localConfig, etc,    `override/dcp-config.js`);
  await addConfigRKey(localConfig, 'HKLM', 'override/dcp-config');
  
  /* 2 */
  defaultConfig.TEST = 473;

  /* 3 */
  addConfig(aggrConfig, localConfig);
  if (!aggrConfig.scheduler.location)
    aggrConfig.scheduler.location = localConfig.scheduler.location = new (require('dcp/dcp-url').URL)('https://scheduler.distributed.computer')
  if (!aggrConfig.scheduler.configLocation)
    aggrConfig.scheduler.location = localConfig.scheduler.configLocation = new URL(aggrConfig.scheduler.location.resolve('etc/dcp-config.js')) /* 4 */

  /* 4 */
  if (aggrConfig.parseArgv) {
    // don't enable help output for init
    const argv = require('dcp/dcp-cli').base().help(false).argv;
    const { scheduler } = argv;
    if (scheduler) {
      aggrConfig.scheduler.location = localConfig.scheduler.location = new URL(scheduler);
    }
  }
  if (process.env.DCP_SCHEDULER_LOCATION)
    aggrConfig.scheduler.location = localConfig.scheduler.location = new URL(process.env.DCP_SCHEDULER_LOCATION)
  if (process.env.DCP_SCHEDULER_CONFIGLOCATION)
    aggrConfig.scheduler.configLocation = localConfig.scheduler.configLocation = process.env.DCP_SCHEDULER_CONFIGLOCATION
  if (process.env.DCP_CONFIG_LOCATION)
    aggrConfig.scheduler.configLocation = localConfig.scheduler.configLocation = process.env.DCP_CONFIG_LOCATION
  if (process.env.DCP_BUNDLE_AUTOUPDATE)
    aggrConfig.bundle.autoUpdate = localConfig.bundle.autoUpdate = !!process.env.DCP_BUNDLE_AUTOUPDATE.match(/^true$/i);
  if (process.env.DCP_BUNDLE_LOCATION)
    aggrConfig.bundle.location = localConfig.bundle.location = process.env.DCP_BUNDLE_LOCATION
  if (aggrConfig.scheduler && typeof aggrConfig.scheduler.location === 'string')
    aggrConfig.scheduler.location = localConfig.scheduler.location = new URL(aggrConfig.scheduler.location)
  if (aggrConfig.bundle && typeof aggrConfig.bundle.location === 'string')
    aggrConfig.bundle.location = localConfig.bundle.location = new URL(aggrConfig.bundle.location)
  if (!aggrConfig.scheduler.configLocation)
    aggrConfig.scheduler.configLocation = localConfig.scheduler.configLocation = new URL(aggrConfig.scheduler.location.resolve('etc/dcp-config.js'));

  /* 5 */
  if (!testHarnessMode && !initSyncMode) {
    try {
      debugging() && console.debug(` * Loading configuration from ${aggrConfig.scheduler.configLocation.href}`);
      remoteConfigCode = await require('dcp/protocol').justFetch(aggrConfig.scheduler.configLocation)
    } catch(e) {
      console.error(exports.justFetchPrettyError(e))
      throw e;
    }
  } else if (initSyncMode) {
    debugging() && console.debug(` * Blocking while loading configuration from ${aggrConfig.scheduler.configLocation.href}`);
    remoteConfigCode = fetchSync(aggrConfig.scheduler.configLocation);
  }
  if (remoteConfigCode !== false && remoteConfigCode.length === 0)
    throw new Error('Configuration is empty at ' + aggrConfig.scheduler.configLocation.href)
  defaultConfig.TEST = 523;

  /* 6 */
  bundleSandbox.Error = Error; // patch Error so webpacked code gets the same reference
  bundleSandbox.XMLHttpRequest = XMLHttpRequest;
  bundleSandbox.window = bundleSandbox
  bundleSandbox.globalThis = bundleSandbox
  if (remoteConfigCode) {
    let remoteConfig = {};
    let newConfig = {};
    addConfig(remoteConfig, evalStringInSandbox(remoteConfigCode, bundleSandbox, aggrConfig.scheduler.configLocation));
    debugger;
    addConfig(remoteConfig, bundleSandbox.dcpConfig, true);

    /* remote config has lower precedence than local modifications, but gets loaded
     * later because the local scheduler config tells us where to find it, so we
     * rebuild the aggregate config object in order to get correct override precedence.
     */
    newConfig.NEW_CONFIG = true;
    remoteConfig.REMOTE_CONFIG = true;
    addConfig(newConfig,  defaultConfig);
    addConfig(newConfig,  remoteConfig);
    addConfig(newConfig,  localConfig);
    Object.assign(aggrConfig, newConfig); 
    bundleSandbox.dcpConfig = aggrConfig; /* assigning globalThis.dcpConfig in remoteConfigCode context creates 
                                             a new dcpConfig in the bundle - put it back */
  }
  
  if (!aggrConfig.bundle.location && aggrConfig.portal && aggrConfig.portal.location) {
    localConfig.bundle.location = new URL(aggrConfig.portal.location.resolve('dcp-client-bundle.js'))
    addConfig(aggrConfig, localConfig);
  }
  
  /* 7 */
  if (!testHarnessMode && aggrConfig.bundle.autoUpdate && aggrConfig.bundle.location) {
    if (initSyncMode) {
      debugging() && console.debug(` * Blocking to load autoUpdate bundle from ${aggrConfig.bundle.location.href}`);
      finaleBundleCode = fetchSync(aggrConfig.bundle.location.href);
    } else {
      try {
        debugging() && console.debug(` * Loading autoUpdate bundle from ${aggrConfig.bundle.location.href}`);
        finalBundleCode = await require('dcp/protocol').justFetch(aggrConfig.bundle.location.href);
      } catch(e) {
        console.error(exports.justFetchPrettyError(e));
        throw e;
      }
    }
    addConfig(aggrConfig, localConfig);
  }

  /* 8 */
  if (finalBundleCode)
    bundle = evalStringInSandbox(finalBundleCode, bundleSandbox, aggrConfig.bundle.location.href)
  else
    bundle = evalScriptInSandbox(path.resolve(distDir, 'dcp-client-bundle.js'), bundleSandbox)
  if (process.env.DCP_SCHEDULER_LOCATION)
    aggrConfig.scheduler.location = localConfig.scheduler.location = new URL(process.env.DCP_SCHEDULER_LOCATION);

//XXX  console.log(aggrConfig);
  defaultConfig.DEFAULT_CONFIG2='wtf';
  //XXX return the tail return;
}

exports.initcb = require('./init-common').initcb

/**
 * Sync version of dcp-client.init() - intended only for test harnesses.
 * This function does not download the configuration object from the scheduler,
 * nor does it check for remote bundle updates.
 *
 * @note This is an unofficial API and is subject to change without notice.
 */
exports._initForTestHarness = function dcpClient$$_initForTestHarness(dcpConfig) {
  var dcp;
  
  exports.init(_initForTestHarnessSymbol);
  dcp = makeInitReturnObject();
  function setConfig(dcpConfig) {
    injectModule('dcp/dcp-config', dcpConfig, true);
  }
  return { dcp, setConfig };
}

/**
 * Sync version of dcp-client.init().
 *
 * @returns dcpConfig
 */
exports.initSync = function dcpClient$$initSync() {
  const child_process = require('child_process');
  var child;
  var argv = [ process.execPath, require.resolve('./bin/export-dcpconfig'), '--fd=3' ];
  var output = '';
  var env = { FORCE_COLOR: 1 };
  var dcpConfig;
  
  if (typeof url !== 'string')
    url = url.href;
  argv.push(url);

  child = child_process.spawnSync(argv[0], argv.slice(1), { env: Object.assign(env, process.env), shell: false, windowsHide: true,
                                                            stdio: [ 'ignore', 'inherit', 'inherit', 'pipe' ]});
  if (child.status !== 0)
    throw new Error(`Child process returned exit code ${child.status}`);

  dcpConfig = child.output[3].toString('utf-8');

  let argv = Array.from(arguments);


  argv.unshift(_initForSyncSymbol);
  exports.init.apply(null, argv);

  return makeInitReturnObject();
}

/** Fetch a web resource from the server, blocking the event loop. Used by initSync() to
 *  fetch the remote scheduler's configuration and optionally its autoUpdate bundle. The
 *  download program displays HTTP-level errors on stderr, so we simply inhert and let it
 *  push the detailed error reporting to the user.
 *
 *  @param      url     {string | instance of dcp/dcp-url.URL}          The URL to fetch; http and https are supported.
 *  @returns    {string} containing the result body.
 *
 *  @throws if there was an error, including HTTP 404 etc.
 */
function fetchSync(url) {
  const child_process = require('child_process');
  var child;
  var argv = [ process.execPath, require.resolve('./bin/download'), '--fd=3' ];
  var output = '';
  var env = { FORCE_COLOR: 1 };
  
  if (typeof url !== 'string')
    url = url.href;
  argv.push(url);

  child = child_process.spawnSync(argv[0], argv.slice(1), { env: Object.assign(env, process.env), shell: false, windowsHide: true,
                                                            stdio: [ 'ignore', 'inherit', 'inherit', 'pipe' ]});
  if (child.status !== 0)
    throw new Error(`Child process returned exit code ${child.status}`);
  return child.output[3].toString('utf-8');
}

/** Factory function which returns an object which is all of the dcp/ modules exported into
 *  node's module space via the namespace-mapping (ns-map) module. These all original within
 *  the dcp-client bundle in dist/, or the remote scheduler's bundle if autoUpdate was enabled.
 *
 *  This is the return value from initSync() and the promise resolution value for init().
 */
function makeInitReturnObject() {
  var o = {};
  var nsMap = require('./ns-map');

  for (let moduleIdentifier in nsMap) {
    if (!nsMap.hasOwnProperty(moduleIdentifier))
      continue;
    if (moduleIdentifier.startsWith('dcp/'))
      o[moduleIdentifier.slice(4)] = require(moduleIdentifier);
  }

  return o;
}
