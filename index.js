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
const moduleSystem = require('module');
const { spawnSync } = require('child_process');
const { createContext, runInContext } = require('vm');

exports.debug = false;
let initInvoked = false; /* flag to help us detect use of Compute API before init */

function debugging(what = 'dcp-client') {
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

const log = (namespace, ...args) => {
  if (debugging(`dcp-client:${namespace}`)) {
    console.debug(`dcp-client:${namespace}`, ...args);
  }
};

const distDir = path.resolve(path.dirname(module.filename), 'dist');

const bundleSandbox = {
  URL,
  Function,
  Object,
  Array,
  Date,
  // To make instanceof checks for Promises work while serializing dcpConfig
  Promise,
  require,
  console,
  setInterval,
  setTimeout,
  clearTimeout,
  crypto: { getRandomValues: require('polyfill-crypto.getrandomvalues') },
  dcpConfig: {
    bundleConfig: true,
    scheduler: {},
    bank: {
      location: new URL('http://bootstrap.distributed.computer/')
    },
    packageManager: {
      location: new URL('http://bootstrap.distributed.computer/')
    },
    needs: { urlPatchUp: true },
  },
};

/** Evaluate a file in a sandbox without polluting the global object.
 *  @param      filename        {string}    The name of the file to evaluate, relative to
 *  @param      sandbox         {object}    A sandbox object, used for injecting 'global' symbols as needed
 *  @param      olFlag          {boolean}   true if the file contains only an object literal
 */
function evalScriptInSandbox(filename, sandbox, olFlag) {
  var code
  var context = createContext(sandbox)
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

  return runInContext(code, context, filename, 0);
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
function evalStringInSandbox(
  code,
  sandbox,
  filename = '(dcp-client$$evalStringInSandbox)',
) {
  const context = createContext(sandbox);

  /**
   * Remove comments and then decide if this config file contains an IIFE. If
   * not, we need to wrap it as an IIFE to avoid "SyntaxError: Illegal return
   * statement" from being thrown for files with top level return statements.
   */
  const iifeRegex = /\([\s\S]*\(\)[\s\S]*\{[\s\S]*\}\)\(\);?/;
  let lineOffset = 0;
  if (!withoutComments(code).match(iifeRegex)) {
    code = `(() => {\n${code}\n})();`;

    // To account for the newline in "(() => { \n${code}..."
    lineOffset = -1;
  }

  let result;

  /**
   * Need to wrap in trycatch so that we can control the stack trace that is
   * printed.
   */
  try {
    result = runInContext(code, context, {
      filename,
      lineOffset,
      /**
       * If the code is a minified bundle (i.e. nigh unreadable), avoid printing
       * the whole stack trace to stderr by default.
       */
      displayErrors: debugging('evalStringInSandbox'),
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }

  return result;
}

/**
 * Return a version of the code without comments. The algorithm here is pretty basic
 * feel free to improve it.
 * @param {string} code String to change
 */
function withoutComments(code) {
  return code.replace(/(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm, '')
}

/** Load the bootstrap bundle - used primarily to plumb in utils::justFetch.
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

/**
 * Inject modules from a bundle according to a namespace map.
 * The namespace map maps bundle exports onto the internal require(dcp/...) namespace.
 * 
 * @param    nsMap    the namespace map object
 * @param    bundle   the webpack bundle (~moduleGroup object)
 * @param    clobber  {boolean}       inject on top of an existing module identifier
 *                                    if there is a collsion.
 */
function injectNsMapModules(nsMap, bundle, bundleLabel, clobber) {
  bundle = Object.assign({}, bundle);
  
  for (let moduleId in nsMap) {
    let moduleExports = bundle[nsMap[moduleId]]
    if (!moduleExports) {
      if (injectedModules[moduleId])
        console.warn(`Warning: Bundle '${bundleLabel}' is missing exports for module ${moduleId}; using version from previous bundle`);
      else
        throw new Error(`Bundle '${bundleLabel}' is missing exports for module ${moduleId}`);
    } else {
      injectModule(moduleId, moduleExports, clobber)
    }
  }
}

injectModule('dcp/env-native', { platform: 'nodejs' })

/* Inject all properties of the bundle object as modules in the
 * native NodeJS module system.
 */
debugging('modules') && console.debug('Begin phase 1 module injection')  /* Just enough to be able to load a second bundle */
injectNsMapModules(require('./ns-map'), loadBootstrapBundle(), 'bootstrap');
injectModule('dcp/bootstrap-build', require('dcp/build'));

/** Merge a new configuration object on top of an existing one. The new object
 *  is overlaid on the existing object, so that properties specified in the 
 *  existing object graph overwrite, but unspecified edges are left alone.
 *
 *  Instances of URL and dcpUrl::URL receive special treatment: if they are being
 *  overwritten by a string, the string is used the argument to the constructor
 *  to create a new object that replaces the entire value.
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
  const { DcpURL } = require('dcp/dcp-url');

  for (let prop in neo) {
    if (!neo.hasOwnProperty(prop))
      continue;
    if (typeof existing[prop] === 'object' && DcpURL.isURL(existing[prop])) {
      if (neo[prop])
        existing[prop] = new (existing[prop].constructor)(neo[prop]);
      continue;
    }
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

/* existing ... neo */
function addConfigs() {
  var neo = arguments[arguments.length - 1];

  for (const existing of Array.from(arguments).slice(0, -1))
    addConfig(existing, neo);
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
if (os.platform() === 'win32')
  checkConfigFileSafePerms = function(){};

/** Create a memo of where DcpURL instances are in the object graph */
function makeURLMemo(obj, where) {
  const { DcpURL } = require('dcp/dcp-url');
  var memo = [];
  var here;

  if (!where)
    where = '';

  for (let prop in obj) {
    if (typeof obj[prop] !== 'object')
      continue;
    here = where ? where + '.' + prop : prop;
    if (DcpURL.isURL(obj[prop])) {
      memo.push(here);
    } else {
      memo = memo.concat(makeURLMemo(obj[prop], here));
    }
  }

  return memo;
}

/** Change any properties in the urlMemo which are strings into URLs */
function applyURLMemo(urlMemo, top) {
  const { DcpURL } = require('dcp/dcp-url');
  for (let path of urlMemo) {
    let obj = top;
    let pathEls, pathEl;

    for (pathEls = path.split('.'), pathEl = pathEls.shift();
         pathEls.length;
         pathEl = pathEls.shift()) {
      obj = obj[pathEl];      
    }
    if (typeof obj[pathEl] === 'string')
      obj[pathEl] = new DcpURL(obj[pathEl]);
  }
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
    
    if (withoutComments(code).match(/^\s*{/)) {
      neo = evalScriptInSandbox(fullPath, bundleSandbox, true);
      addConfig(existing, neo);
    } else {
      /* overlay the context's global namespace with the dcpConfig namespace so 
       * that we have good syntax to modify with arbitrary JS; then find changes 
       * and apply to aggregate config.
       */
      let configSandbox = {}
      let knownGlobals;
      let urlMemo;
      
      neo = {};
      configSandbox.console = console
      Object.assign(configSandbox, bundleSandbox)
      Object.assign(configSandbox, existing);
      urlMemo = makeURLMemo(existing);
      
      knownGlobals = Object.keys(configSandbox);
      const ret = evalStringInSandbox(code, configSandbox, fullPath);

      // handle programmatic assignment to top-level config
      // via sandbox globals
      for (let key of Object.keys(configSandbox)) {
        if (knownGlobals.indexOf(key) === -1)
          neo[key] = configSandbox[key];  /* new global in sandbox = new top-level config object */
      }
      for (let key of Object.keys(existing)) {
        if (configSandbox.hasOwnProperty(key))
          neo[key] = configSandbox[key];
      }

      applyURLMemo(urlMemo, neo);
      // use return values now if available
      if (ret !== null && typeof ret === "object") Object.assign(neo, ret);
    }
    addConfig(existing, neo);
  }
}

/** Merge a new configuration object on top of an existing one, via
 *  addConfig().  The registry key is read, turned into an object, and 
 *  becomes the neo config.
 */
async function addConfigRKey(existing, hive, keyTail) {
  var neo = await require('./windows-registry').getObject(hive, keyTail);
  debugging() && console.debug(` * Loading configuration from ${hive} ${keyTail}`);
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
      // FIXME(bryan-hoang): fixCase is not defined.
      let prop = fixCase(v.slice(prefix.length))
      if (typeof neo[prop] !== 'object') {
        neo[prop] = {}
        addConfig(neo[prop], JSON.parse(process.env[v]))
      } else {
        if (typeof neo[prop] === "object") {
          throw new Error("Cannot override configuration property " + prop + " with a string (is an object)")
        }
        neo[prop] = process.env[v]
      }
    }
  }

  addConfig(existing, neo);
}

/** 
 * Tasks which are run in the early phases of initialization
 * - plumb in global.XMLHttpRequest which lives forever -- that way KeepAlive etc works.
 */
exports._initHead = function dcpClient$$initHead() {
  initInvoked = true; /* Allow us to eval require("dcp/compute"); from config */

  if (typeof XMLHttpRequest === 'undefined')
    global.XMLHttpRequest = require('dcp/dcp-xhr').XMLHttpRequest;
}

/** 
 * Tasks which are run in the late phases of initialization:
 * 1 - activate either the local bundle or the remote bundle against a fresh sandbox 
 *     using the latest config (future: bootstrap bundle will export fewer modules until init; 
 *     bundle will provide post-initialization nsMap).
 * 2 - inject modules from the final bundle on top of the bootstrap modules
 * 3 - patch up internal (to the final bundle) references to dcpConfig to reference our generated config
 * 4 - verify versioning information for key core components against running scheduler
 * 5 - load and cache identity & bank keystores if they are provided and config.parseArgv allows
 * 6 - create the return object
 * 
 * @returns the same `dcp` object as we expose in the vanilla-web dcp-client
 */
function initTail(aggrConfig, finalBundleCode, finalBundleURL) {
  var nsMap;            /* the final namespace map to go from bundle->dcp-client environment */
  var bundle;           /* the final bundle, usually a copy of the bootstrap bundle */
  var finalBundleLabel; /* symbolic label used for logs describing the source of the final bundle */
  var ret;              /* the return value of the current function - usually the `dcp` object but
                           possibly edited by the postInitTailHook function. */
  var schedConfLocFun = require('dcp/protocol-v4').getSchedulerConfigLocation;
  
  /* 1 */
  if (finalBundleCode) {
    finalBundleLabel = String(finalBundleURL);

    /**
     * The finalBundleCode may include dcpConfig.bank.location.resolve, which
     * means we need to convert the URLs in the bundleSandbox into DcpURLs.
     */
    require('dcp/dcp-url').patchup(bundleSandbox);
    bundle = evalStringInSandbox(
      finalBundleCode,
      bundleSandbox,
      finalBundleLabel,
    );
  } else {
    const bundleFilename = path.resolve(distDir, 'dcp-client-bundle.js');
    finalBundleLabel = bundleFilename;

    /**
     * FIXME(bryan-hoang/wesgarland): Re-evaluating the bundle used to bootstrap
     * config loading will cause some issues w.r.t. closures and `instanceof`
     * checks. `instanceof` checks fail when these newly evaluated
     * functions/classes are injected into the module system, which differ from
     * their instances in the config. e.g. DcpURL
     *
     * For now, we're saving the initial references for closures and patching up
     * instances for DcpURL, but these different instances could cause future
     * bugs.
     */
    bundle = evalScriptInSandbox(bundleFilename, bundleSandbox);
  }
  nsMap = bundle.nsMap || require('./ns-map');  /* future: need to move non-bootstrap nsMap into bundle for stable auto-update */

  if (bundle.initTailHook) /* for use by auto-update future backwards compat */ 
    bundle.initTailHook(aggrConfig, bundle, finalBundleLabel, bundleSandbox, injectModule);

  /* 2 */
  debugging('modules') && console.debug(`Begin phase 2 module injection '${finalBundleLabel}'`);
  delete nsMap['dcp-config'];
  injectNsMapModules(nsMap, bundle, finalBundleLabel, true);
  injectModule('dcp/client', exports);
  injectModule('dcp/client-bundle', bundle);

  /**
   * Preserving the initial instance of the function, else it closes over the
   * wrong variable and returns `undefined` even though fetch has been used.
   */
  if (schedConfLocFun)
    require('dcp/protocol-v4').getSchedulerConfigLocation = schedConfLocFun;

  /**
   * Patch up URLs present in the config AFTER final module injection, else
   * future `instanceof` checks for DcpURL can break if `initSync` is used.
   *
   * Caused by the difference in how `initSync` differs in patching up URLs in
   * the config during initialization to make it compatible with serialization.
   */
  require('dcp/dcp-url').patchup(aggrConfig);

  /* 3 */
  if (global.dcpConfig) {
    /* dcpConfig was defined before dcp-client was initialized: assume dev knows what he/she is doing */
    debugging() && console.debug('Dropping bundle dcp-config in favour of global dcpConfig')
    Object.assign(require('dcp/dcp-config'), global.dcpConfig);
    bundleSandbox.dcpConfig = global.dcpConfig;
    injectModule('dcp/dcp-config', global.dcpConfig, true);
  } else {
    let defaultConfig = require('dcp/dcp-config');
    Object.assign(defaultConfig, aggrConfig);
    bundleSandbox.dcpConfig = defaultConfig;
  }

  Object.defineProperty(exports, 'distDir', {
    value: function dcpClient$$distDir$getter() {
      return distDir;
    },
    configurable: false,
    writable: false,
    enumerable: false
  })

  /* 4 */
  if (aggrConfig.scheduler.configLocation !== false && typeof process.env.DCP_CLIENT_SKIP_VERSION_CHECK === 'undefined')
  {
    if (!aggrConfig.scheduler.compatibility || !aggrConfig.scheduler.compatibility.minimum)
      throw require('dcp/utils').versionError(aggrConfig.scheduler.location.href, 'scheduler', 'dcp-client', '4.0.0', 'EDCP_CLIENT_VERSION');

    if (aggrConfig.scheduler.compatibility)
    {
      let ourVer = require('dcp/protocol').version.provides;
      let minVer = aggrConfig.scheduler.compatibility.minimum.dcp;
      let ok = require('semver').satisfies(ourVer, minVer);
      debugging('version') && console.debug(` * Checking compatibility; dcp-client=${ourVer}, scheduler=${minVer} => ${ok ? 'ok' : 'fail'}`);
      if (!ok)
        throw require('dcp/utils').versionError('DCP Protocol', 'dcp-client', aggrConfig.scheduler.location.href, minVer, 'EDCP_PROTOCOL_VERSION');
    }
  }
  
  /* 5 */
  if (aggrConfig.parseArgv !== false) {
    const dcpCli = require('dcp/cli');
    /* don't enable help output when automating */
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

  /* 6 */
  ret = makeInitReturnObject();
  if (bundle.postInitTailHook) /* for use by auto-update future backwards compat */ 
    ret = bundle.postInitTailHook(ret, aggrConfig, bundle, finalBundleLabel, bundleSandbox, injectModule);
  return ret;
}

/**
 * Initialize the dcp-client bundle for use by the compute API, etc.
 *
 * @param       {string|URL object}     [url="https://scheduler.distributed.computer"]
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
  var aggrConfig;
  var finalBundleCode = false;
  var finalBundleURL;

  exports._initHead();
  aggrConfig = await exports.createAggregateConfig(Array.from(arguments));

  finalBundleURL = aggrConfig.bundle.autoUpdate ? aggrConfig.bundle.location : false;
  if (finalBundleURL) {
    try {
      debugging() && console.debug(` * Loading autoUpdate bundle from ${finalBundleURL.href}`);
      finalBundleCode = await require('dcp/utils').justFetch(finalBundleURL.href);
    } catch(e) {
      console.error('Error downloading autoUpdate bundle from ' + finalBundleURL);
      console.debug(require('dcp/utils').justFetchPrettyError(e));
      throw e;
    }
  }

  return initTail(aggrConfig, finalBundleCode, finalBundleURL);
}

/**
 * Sync version of dcp-client.init().
 */
exports.initSync = function dcpClient$$initSync() {
  var aggrConfig;
  var finalBundleCode = false;
  var finalBundleURL;

  exports._initHead();
  aggrConfig = fetchAggregateConfig(Array.from(arguments));

  finalBundleURL = aggrConfig.bundle.autoUpdate ? aggrConfig.bundle.location : false;
  if (finalBundleURL) {
    try {
      debugging() && console.debug(` * Loading autoUpdate bundle from ${finalBundleURL.href}`);
      finalBundleCode = exports.fetchSync(finalBundleURL);
    } catch(e) {
      console.error('Error downloading autoUpdate bundle from ' + finalBundleURL);
      console.log(require('dcp/utils').justFetchPrettyError(e));
      throw e;
    }
  }

  return initTail(aggrConfig, finalBundleCode, finalBundleURL);
}

exports.createAggregateConfig = async function dcpClient$$createAggregateConfig(initArgv, programName) {
/* The steps that are followed are in a very careful order; there are default configuration options 
 * which can be overridden by either the API consumer or the scheduler; it is important that the wishes 
 * of the API consumer always take priority.
 *
 *  1 - create the local config by 
 *       - reading the config buried in the bundle and defined at module load
 *       - reading ~/.dcp/dcp-client/dcp-config.js or using hard-coded defaults
 *       - reading the registry
 *       - receiving input from the cli module
 *       - arguments to init()
 *       - etc  (see dcp-docs file dcp-config-file-regkey-priorities)
 *  3 - merge the passed-in configuration on top of the default configuration
 *  4 - use the config + environment + arguments to figure out where the scheduler is
 *  5 - pull the scheduler's config, and layer it on top of the current configuration
 *  6 - reapply the passed-in configuration into the current configuration
 *
 * Note re strategy - we always write to localConfig and read from aggrConfig. We sync aggr to local
 * before any reads.  This lets us rebuild aggr from various sources at any future point without
 * conflating local configuration and defaults, either hard-coded or remote.  The localConfig is used
 * to figure out where to download the scheduler.
 */
  let defaultConfig = require('dcp/dcp-config'); /* dcpConfig from bundle */
  let remoteConfigCode;
  let localConfig = {
    scheduler: {
      location: new URL('https://scheduler.distributed.computer/')
    },
    bundle: {}
  };

  const aggrConfig = {
    // Parse process.argv by default using dcp/cli.
    parseArgv: true,
  };

  const etc  = process.env.DCP_ETCDIR || (os.platform() === 'win32' ? process.env.ALLUSERSPROFILE : '/etc');
  const home = process.env.DCP_HOMEDIR || os.homedir();

  /* 1 - create local config */
  addConfig(aggrConfig, defaultConfig);
  addConfig(aggrConfig, localConfig);

  if (!programName)
    programName = process.mainModule && process.mainModule.filename || false;
  if (programName)
    programName = path.basename(programName, '.js');
  let config = localConfig;

  /* This follows spec doc line-by-line */
                 await addConfigRKey(config, 'HKLM', 'dcp-client/dcp-config');
                 await addConfigFile(config, etc,    'dcp-client/dcp-config.js');
  programName && await addConfigRKey(config, 'HKLM', `dcp-client/${programName}/dcp-config`);
  programName && await addConfigFile(config, etc,    `dcp-client/${programName}/dcp-config.js`);
  await addConfigFile(config, home,   '.dcp/dcp-client/dcp-config.js');
  programName && await addConfigFile(config, home,   `.dcp/dcp-client/${programName}/dcp-config.js`); 
                 await addConfigRKey(config, 'HKCU', `dcp-client/dcp-config`);
  programName && await addConfigRKey(config, 'HKCU', `dcp-client/${programName}/dcp-config`);

  // Sort out polymorphic arguments: 'passed-in configuration'.
  if (initArgv[0]) {
    if (typeof initArgv[0] === 'string' || (typeof initArgv[0] === 'object' && initArgv[0] instanceof global.URL)) {
      addConfig(localConfig.scheduler, { location: new URL(initArgv[0]) });

      /**
       * Checking using isArray to avoid adding cli argv (e.g. process.execPath,
       * script name, etc.) into config.
       */
    } else if (typeof initArgv[0] === 'object' && !Array.isArray(initArgv[0])) {
      addConfig(localConfig, initArgv[0]);
    }
  }

  if (initArgv[1])
    localConfig.bundle.autoUpdate = !!initArgv[1];
  if (initArgv[2])
    addConfig(localConfig.bundle, { location: new URL(initArgv[2])});
  
  await addConfigEnviron(localConfig, 'DCP_CONFIG_');
  await addConfigFile(localConfig, etc,    `override/dcp-config.js`);
  await addConfigRKey(localConfig, 'HKLM', 'override/dcp-config');
  addConfig(aggrConfig, localConfig);

  /**
   * 4. Use the config + environment + arguments to figure out where the
   *    scheduler is.
   *
   * Only override the scheduler from argv if cli specifies a scheduler.
   * e.g. the user specifies a --dcp-scheduler option.
   */
  // Don't enable help output for init
  const { dcpScheduler } = require('dcp/cli').base().help(false).parse();
  if (typeof dcpScheduler !== 'undefined') {
    localConfig.scheduler.location = dcpScheduler;
    aggrConfig.scheduler.location = dcpScheduler;
  }

  if (process.env.DCP_SCHEDULER_LOCATION)
    addConfigs(aggrConfig.scheduler, localConfig.scheduler, { location: new URL(process.env.DCP_SCHEDULER_LOCATION) });
  if (process.env.DCP_CONFIG_LOCATION) 
    addConfigs(aggrConfig.scheduler, localConfig.scheduler, { configLocation: new URL(process.env.DCP_CONFIG_LOCATION) });
  else if (process.env.DCP_CONFIG_LOCATION === '')
    addConfigs(aggrConfig.scheduler, localConfig.scheduler, { configLocation: false }); /* explicitly request no remote config */
  if (process.env.DCP_BUNDLE_AUTOUPDATE)
    aggrConfig.bundle.autoUpdate = localConfig.bundle.autoUpdate = !!process.env.DCP_BUNDLE_AUTOUPDATE.match(/^true$/i);
  if (process.env.DCP_BUNDLE_LOCATION) 
    addConfigs(aggrConfig.bundle, localConfig.bundle, { location: new URL(process.env.DCP_BUNDLE_LOCATION) });

  /* 3 */
  if (!aggrConfig.scheduler.configLocation &&
      aggrConfig.scheduler.configLocation !== false) {
    addConfigs(aggrConfig.scheduler, localConfig.scheduler, { 
      configLocation: new URL(`${aggrConfig.scheduler.location}etc/dcp-config.js`)
    });
  }

  /* 5 */
  if (aggrConfig.scheduler.configLocation === false)
    debugging() && console.debug(` * Not loading configuration from remote scheduler`);
  else
  {
    try {
      debugging() && console.debug(` * Loading configuration from ${aggrConfig.scheduler.configLocation.href}`); 
      remoteConfigCode = await require('dcp/protocol').fetchSchedulerConfig(aggrConfig.scheduler.configLocation);
    } catch(e) {
      console.error('Error: dcp-client::init could not fetch scheduler configuration at', '' + aggrConfig.scheduler.configLocation);
      console.log(require('dcp/utils').justFetchPrettyError(e));
      throw e;
    }
    if (remoteConfigCode.length === 0)
      throw new Error('Configuration is empty at ' + aggrConfig.scheduler.configLocation.href);
  }
      
  /* 6 */
  bundleSandbox.Error = Error; // patch Error so webpacked code gets the same reference
  bundleSandbox.XMLHttpRequest = XMLHttpRequest;
  bundleSandbox.window = bundleSandbox
  bundleSandbox.globalThis = bundleSandbox
  if (remoteConfigCode) {
    let remoteConfig = {};
    let newConfig = {};
    addConfig(remoteConfig, evalStringInSandbox(remoteConfigCode, bundleSandbox, aggrConfig.scheduler.configLocation.href));
    addConfig(remoteConfig, bundleSandbox.dcpConfig);

    /* remote config has lower precedence than local modifications, but gets loaded
     * later because the local scheduler config tells us where to find it, so we
     * rebuild the aggregate config object in order to get correct override precedence.
     */
    addConfig(newConfig,  defaultConfig);
    addConfig(newConfig,  remoteConfig);
    addConfig(newConfig,  localConfig);   /* re-adding here causes strings to become URLs if they URLs in remote */
    Object.assign(aggrConfig, newConfig); 
    bundleSandbox.dcpConfig = aggrConfig; /* assigning globalThis.dcpConfig in remoteConfigCode context creates 
                                             a new dcpConfig in the bundle - put it back */ 
  }

  /**
   * Default location for the auto update bundle is the scheduler so that the
   * scheduler and the client are on the same code.
   */
  if (
    !aggrConfig.bundle.location &&
    aggrConfig.scheduler &&
    aggrConfig.scheduler.location
  ) {
    localConfig.bundle.location = new URL(
      `${aggrConfig.scheduler.location}dcp-client/dist/dcp-client-bundle.js`,
    );

    addConfig(aggrConfig, localConfig);
  }

  return aggrConfig;
}

exports.initcb = require('./init-common').initcb

/** 
 * Fetch the aggregate config - which by definition does async work - by 
 * spawning another process (and other reactor) and then blocking until 
 * it is available.  Used to implement initSync().
 *
 * The other process receives the same command-line options and environment
 * as "this" process, and uses the code in this file to derive the aggrConfig,
 * so we should be able to have the exact same derived configuration for
 * clients using either init() or initSync().
 *
 * @param  initArgv   the arguments to initSync()
 */
function fetchAggregateConfig(initArgv) {
  const { patchup: patchUp } = require('dcp/dcp-url');
  const { Address } = require('dcp/wallet');
  const serializer = require('dcp/serialize');

  // To be able to deserialize dcpConfig identities

  serializer.userCtors.dcpEth$$Address = Address;
  const { serialize, deserialize } = serializer;
  const { argv } = process;
  const [, programName] = argv;
  const env = { FORCE_COLOR: 1, ...process.env };

  /**
   * Spreading an empty array doesn't add anything to the parent array, hence
   * why we're making nodeArgs an array.
   */
  const nodeArgs = debugging('build-dcp-config') ? ['--inspect'] : []
  const spawnArgs = [...nodeArgs, require.resolve('./bin/build-dcp-config'), ...argv.slice(2)];
  const child = spawnSync(
    process.execPath,
    spawnArgs,
    {
      env,
      shell: false,
      windowsHide: true,
      /**
       * Create a 4th file descriptor to use for piping the serialized config
       * from build-dcp-config. (e.g. child.output[3])
       */
      stdio: ['pipe', 'inherit', 'inherit', 'pipe'],
      input: serialize({ programName, initArgv }),
    },
  );

  
  if (child.status !== 0) {
    throw new Error(`Child process returned exit code ${child.status}`);
  }

  const serializedOutput = String(child.output[3]);
  log('fetchAggregateConfig', 'serializedOutput:', serializedOutput);
  const aggregateConfig = deserialize(serializedOutput);
  return aggregateConfig;
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
exports.fetchSync = function fetchSync(url) {
  var child;
  var argv = [ process.execPath, require.resolve('./bin/download'), '--fd=3' ];
  var output = '';
  var env = { FORCE_COLOR: 1 };
  
  if (typeof url !== 'string')
    url = url.href;
  argv.push(url);

  child = spawnSync(argv[0], argv.slice(1), { 
    env: Object.assign(env, process.env), shell: false, windowsHide: true,
    stdio: [ 'ignore', 'inherit', 'inherit', 'pipe' ],

    /**
     * Setting the largest amount of data in bytes allowed on stdout or stderr
     * to 5 MB so that dcp-client-bundle.js (~4.6 MB built in debug mode with
     * source mapped line numbers) can be downloaded without the child exiting
     * with a status of null (i.e. ENOBUFS).
     */
    maxBuffer: 5 * 1024 * 1024,
  });

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
  const nsMap = require('./ns-map');
  var o = {};

  for (let moduleIdentifier in nsMap) {
    if (!nsMap.hasOwnProperty(moduleIdentifier))
      continue;
    if (moduleIdentifier.startsWith('dcp/'))
      o[moduleIdentifier.slice(4)] = require(moduleIdentifier);
  }

  return o;
}
