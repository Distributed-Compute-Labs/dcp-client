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
 *              2. build the layered dcp-config for the program invoking init 
 *                 (see: https://people.kingsds.network/wesgarland/dcp-client-priorities.html /wg aug 2020)
 *              3. download a new bundle if auto-update is on
 *              4. make the bundle "see" the layered dcp-config as their global dcpConfig
 *              5. re-inject the bundle modules (possibly from the new bundle) 
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        July 2019
 */
'use strict';

var   reportErrors = true; /* can be overridden by options.reportErrors during init() */
var   KVIN;                /* KVIN context from internal kvin */
var   XMLHttpRequest;      /* from internal dcp-xhr */

const os      = require('os');
const fs      = require('fs')
const path    = require('path');
const process = require('process');
const assert  = require('assert');
const debug   = require('debug');
const moduleSystem = require('module');
const { spawnSync } = require('child_process');
const vm = require('vm');
const protectedDcpConfigKeys = [ 'system', 'bundle', 'worker', 'standaloneWorker' ];

let initInvoked = false; /* flag to help us detect use of Compute API before init */
let originalDcpConfig = globalThis.dcpConfig || false; /* not false if user set their own dcpConfig global variable before init */
globalThis.dcpConfig = originalDcpConfig || { __filename };

const distDir = path.resolve(path.dirname(module.filename), 'dist');

/* Registry import code knows to make strings into URLs when going on top of URLs; so we need to provide
 * nodes of the right that we can expect to be overwritten by the registry.
 */
const bootstrapConfig = {
    build: 'bootstrap',
    bundleConfig: true,
    scheduler:          { location: new URL('http://bootstrap.distributed.computer/') },
    bank:               { location: new URL('http://bootstrap.distributed.computer/') },
    packageManager:     { location: new URL('http://bootstrap.distributed.computer/') },
    needs: { urlPatchUp: true },
};

const bundleSandbox = {
  URL,
  URLSearchParams,
  Function,
  Object,
  Array,
  Date,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint32Array,
  Uint8ClampedArray,
  Uint16Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  Promise,
  Error,
  ArrayBuffer,
  require, /* becomes requireNative in webpack-native-bridge */
  console,
  setInterval,  clearInterval,
  setTimeout,   clearTimeout,
  setImmediate, clearImmediate,
  crypto: { getRandomValues: require('polyfill-crypto.getrandomvalues') },
  window: globalThis,
};

function runSandboxedCode(sandbox, code, options)
{
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(code, options);
  return script.runInContext(ctx, options);
}

/** Evaluate a file in a sandbox without polluting the global object.
 *  @param      filename        {string}    The name of the file to evaluate, relative to
 *  @param      sandbox         {object}    A sandbox object, used for injecting 'global' symbols as needed
 */
function evalScriptInSandbox(filename, sandbox)
{
  var code
  try {
    debug('dcp-client:evalScriptInSandbox')('evaluating', filename);
    code = fs.readFileSync(path.resolve(distDir, filename), 'utf8');
  } catch(e) {
    if (e.code === 'ENOENT')
      return {}
    debug('dcp-client:evalScriptInSandbox')(e);
    throw e
  }

  return runSandboxedCode(sandbox, code, { filename, lineNumber: 0 });
}

/**
 * Evaluate a file inside a namespace-protecting IIFE; similar the new vm contexts used for configury,
 * but using the current context so that Object literals are instances of this context's Object.
 *
 * @param {string} filename The name of a file which contains a single JS expression
 * @param {object} sandbox  An object which simulates the global object via symbol collision; any
 *                          symbols which don't collide are resolved up the scope chain against this
 *                          context's global object.
 * @returns the value of the expression in the file
 */
function evalFileInIIFE(filename, sandbox)
{
  const prologue = '(function __dynamic_evalFile__IIFE(' + Object.keys(sandbox).join(',') + '){ return ';
  const epilogue = '\n});';
  const options = { filename, lineNumber: 0 };
  
  debug('dcp-client:evalFileInIIFE')('evaluating', filename);
  const fileContents = fs.readFileSync(path.resolve(distDir, filename), 'utf8');
  const fun = vm.runInThisContext(prologue + fileContents + epilogue, options);

  return fun.apply(null, Object.values(sandbox));
}

/** Evaluate code in a secure sandbox; in this case, the code is the configuration
 *  file, and the sandbox is a special container with limited objects that we setup
 *  during config file processing.
 *  'code' must come from a trusted source, so we don't execute unknown code.
 *
 *  @param      code     {string}        The code to eval
 *  @param      sandbox  {object}        A sandbox object, used for injecting 'global' symbols as needed
 *  @param      filename {string}        The name of the file we're evaluating for stack-
 *                                       trace purposes.
 */
function evalStringInSandbox(code, sandbox, filename = '(dcp-client$$evalStringInSandbox)')
{
  var result;
  const codeHasVeryLongLine = Boolean(/[^\n]{1000,}[^\n]*\n/.test(code));
  const runOptions = {
    filename,
    lineOffset: 0,
    columnOffset: 12, /* use strict */
    displayErrors: !codeHasVeryLongLine
  };

  /* We support two types of strings - one produces a value, the other returns a value. Use the JS
   * parser to figure out which syntax this code is in. In the case of a produced value, we use the
   * last value which was evaluated by the engine as the result, just like eval.
   */
  try
  {
    result = runSandboxedCode(sandbox, '"use strict";' + code, runOptions);
  }
  catch(error)
  {
    const nodejsErrorMessage = /^Illegal return statement/;
    const bunErrorMessage = /^Return statements are only valid inside functions./;
    if (!nodejsErrorMessage.test(error.message) && !bunErrorMessage.test(error.message))
      throw error;

    code = `(() => {;${code}})()`; /* wrap in IIFE so conf can return objects */
    runOptions.columnOffset += 9;
    result = runSandboxedCode(sandbox, '"use strict";' + code, runOptions);
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

/** 
 * Load the bootstrap bundle - used primarily to plumb in utils::justFetch.
 * Runs in a different, but identical, sandbox as the config files and client code. This code is
 * evaluated with the bootstrap config as dcpConfig so that static initialization of dcpConfig in
 * any of the bootstrap modules can mutate the bottom-most layer of the dcpConfig stack.
 */
function loadBootstrapBundle() {
  let sandbox = {}

  Object.assign(sandbox, bundleSandbox)
  sandbox.globalThis = sandbox;
  sandbox.window     = sandbox;
  sandbox.dcpConfig  = bootstrapConfig;
  
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
  debug('dcp-client:modules')(` - injected module ${id}: ${typeof moduleExports === 'object' ? Object.keys(moduleExports) : '(' + typeof moduleExports + ')'}`);
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

  const nsMapValues = Object.values(nsMap);
  for (let moduleId in bundle)
  {
    if (nsMapValues.indexOf(moduleId) === -1)
    {
      const moduleExports = bundle[moduleId];
      injectModule('dcp/internal/' + moduleId, moduleExports, clobber);
    }
  }
}

injectModule('dcp/env-native', { platform: 'nodejs' })

/* Inject all properties of the bundle object as modules in the
 * native NodeJS module system.
 */
debug('dcp-client:modules')('Begin phase 1 module injection')  /* Just enough to be able to load a second bundle */
injectNsMapModules(require('./ns-map'), loadBootstrapBundle(), 'bootstrap');
injectModule('dcp/bootstrap-build', require('dcp/build'));

KVIN = new (require('dcp/kvin')).KVIN();
KVIN.userCtors.dcpUrl$$DcpURL  = require('dcp/dcp-url').DcpURL;
KVIN.userCtors.dcpEth$$Address = require('dcp/wallet').Address;

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

  debug('dcp-client:config-verbose')('adding', neo);

  for (let prop in neo) {
    if (!neo.hasOwnProperty(prop))
      continue;
    if (typeof existing[prop] === 'object' && DcpURL.isURL(existing[prop])) {
      if (neo[prop])
        existing[prop] = new (existing[prop].constructor)(neo[prop]);
      continue;
    }
    if (typeof neo[prop] === 'object' && neo[prop] !== null && !Array.isArray(neo[prop]) && ['Function','Object'].includes(neo[prop].constructor.name)) {
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
 * Returns a graph of empty objects with the same edges as the passed-in node. Only base Objects are
 * considered, not instances of derived classes (like URL). The newly-created nodes inherit from their 
 * equivalent nodes. The net effect is that the returned graph can have its nodes read like usual, but
 * writes "stick" to the new nodes instead of modifying the original node.
 *
 * @param {object} node     the top of the object graph
 * @param {object} seen     internal use only
 *
 * @returns {object}
 */
function magicView(node, seen)
{
  var edgeNode = Object.create(node);

  if (!seen)
    seen = new Map();
  if (seen.has(node))
    return seen.get(node);

  for (let prop in node)
  {
    if (node.hasOwnProperty(prop) && typeof node[prop] === 'object' && node[prop].constructor === {}.constructor)
    {
      if (node[prop] === node)
        edgeNode[prop] = edgeNode;
      else
        edgeNode[prop] = magicView(node[prop], seen);
      seen.set(node[prop], edgeNode[prop]);
    }
  }

  return edgeNode;
}

/**
 * Throw an exception if the given fullPath is not a "safe" file to load.
 * "Safe" files are those that are unlikely to contain malicious code, as 
 * they are owned by an administrator or the same person who loaded the
 * code.
 *
 * Returns false is the file simply does not exist.
 *
 * @param {string} fullPath    the full path to the file to check
 * @param {object} statBuf     [optional] existing stat buf for the file
 */
function checkConfigFileSafePerms(fullPath, statBuf)
{
  const fun = checkConfigFileSafePerms;

  if (!fs.existsSync(fullPath))
    return false;
  if (!fun.selfStat)
    fun.selfStat = fs.statSync(module.filename);
  if (!fun.mainStat)
    fun.mainStat = require.main ? fs.statSync(require.main.filename) : {};

  statBuf = fs.statSync(fullPath);
  
  /* Disallow files with world-writeable path components. @todo reduce redundant checks */
  if (os.platform() !== 'win32')
  {
    const args = fullPath.split(path.sep);
    args[0] = path.sep;

    do
    {
      let check = path.resolve.apply(null, args);
      if (fs.statSync(check).mode & 0o002)
        throw new Error(`Config ${fullPath} insecure due to world-writeable path component ${check}`);
      args.pop();
    } while(args.length);
  }

  /* Permit based on ownership */
  if (statBuf.uid === fun.selfStat.uid)
    return true; /* owned by same user as dcp-client */
  if (statBuf.uid === fun.mainStat.uid)
    return true; /* owned by same user as main program */
  if (statBuf.uid === process.getuid())
    return true; /* owned by user running the code */
  if (statBuf.uid === 0)
    return true; /* owned by root */

  /* Permit based on group membership */
  if (statBuf.gid === fun.mainStat.gid)
    return true; /* conf and program in same group */
  if ((fun.mainStat.mode & 0o020) && (statBuf.gid === process.getgid()))
    return true; /* program is group-writeable and we are in group */
  
  throw new Error('did not load configuration file due to invalid permissions: ' + fullPath);
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

  for (let i=1; i < arguments.length; i++) {
    if (!arguments[i])
      return;
    fullPath = path.join(fullPath, arguments[i]);
  }
  const fpSnap = fullPath;
  
  /**
   * Make a the global object for this context this config file is evaluated in.
   * - Top-level keys from dcpConfig become properties of this object, so that we can write statements 
   *   like scheduler.location='XXX' in the file.
   * - A variable named `dcpConfig` is also added, so that we could replace nodes wholesale, eg
   *   `dcpConfig.scheduler = { location: 'XXX' }`.
   * - A require object that resolves relative to the config file is injected
   * - All of the globals that we use for evaluating the bundle are also injected
   */
  function makeConfigSandbox()
  {
    var configSandbox = Object.assign({}, bundleSandbox, {
      dcpConfig: existing,
      require:   moduleSystem.createRequire(fullPath),
      url:       (href) => new (require('dcp/dcp-url').DcpURL)(href),
      env:       process.env,
      dcp:       { 'dcp-env': require('dcp/dcp-env') }, /* used for web-compat confs */
    });

    for (let key in existing)
      if (!configSandbox.hasOwnProperty(key))
        configSandbox[key] = configSandbox.dcpConfig[key];

    assert(configSandbox.console);
    return configSandbox;
  }
  
  if (fullPath && checkConfigFileSafePerms(fullPath + '.json'))
  {
    fullPath = fullPath + './json';
    debug('dcp-client:config')(` * Loading configuration from ${fullPath}`);
    addConfig(existing, require(fullPath));
    return fullPath;
  }

  if (fullPath && checkConfigFileSafePerms(fullPath + '.kvin'))
  {
    fullPath = fullPath + './kvin';
    debug('dcp-client:config')(` * Loading configuration from ${fullPath}`);
    addConfig(existing, KVIN.parse(fs.readFileSync(fullPath)));
    return fullPath;
  }

  if (fullPath && checkConfigFileSafePerms(fullPath + '.js'))
  {
    fullPath = fullPath + '.js';
    debug('dcp-client:config')(` * Loading configuration from ${fullPath}`);

    const configSandbox = makeConfigSandbox();
    const code = fs.readFileSync(fullPath, 'utf-8');
    let neo;

    if (withoutComments(code).match(/^\s*{/)) /* config file is just a JS object literal */
      neo = evalStringInSandbox(`return (${code});`, configSandbox, fullPath);
    else
      neo = evalStringInSandbox(code, configSandbox, fullPath);

    addConfig(existing, neo);
    return fullPath;
  }

  debug('dcp-client:config')(` . did not load configuration file ${fpSnap}.*`);
}

/**
 * Since there are limited types in the registry, we have decided that certain property
 * names coming from the registry will always be represented by specific types in dcpConfig.
 *
 * o.href => o is a URL
 */
function coerceMagicRegProps(o, seen)
{
  /* seen list keeps up from blowing the stack on graphs with cycles */
  if (!seen)
    seen = [];
  if (seen.indexOf(o) !== -1)
    return;
  seen.push(o);

  for (let key in o)
  {
    if (!o.hasOwnProperty(key) || typeof o[key] !== 'object')
      continue;
    if (o[key].hasOwnProperty('href'))
      o[key] = new URL(o[key]);
    else
      coerceMagicRegProps(o[key], seen)
  }
}

/** Merge a new configuration object on top of an existing one, via
 *  addConfig().  The registry key is read, turned into an object, and 
 *  becomes the neo config.
 */
async function addConfigRKey(existing, hive, keyTail) {
  var neo;
  // make sure RKey calls do not execute the windows registry calls on non-windows platforms
  if (os.platform() !== 'win32')
    return;
  neo = await require('./windows-registry').getObject(hive, keyTail);
  debug('dcp-client:config')(` * Loading configuration from ${hive} ${keyTail}`, neo);
  if (neo)
  {
    coerceMagicRegProps(neo); // mutates `neo` in place
    addConfig(existing, neo);
  }
}

/** Merge a new configuration object on top of an existing one, via
 *  addConfig().  The environment is read, turned into an object, and
 *  becomes the neo config.
 */
function addConfigEnv(existing, prefix) {
  var re = new RegExp('^' + prefix);
  var neo = {};
  
  for (let v in process.env) {
    if (!process.env.hasOwnProperty(v) || !v.match(re)) {
      continue
    }
    if (process.env[v][0] === '{') {
      debug('dcp-client:config')(` * Loading configuration object from env ${v}`);
      let prop = fixCase(v.slice(prefix.length))
      if (typeof neo[prop] !== 'object') {
        neo[prop] = {}
        addConfig(neo[prop], eval(`"use strict"; (${process.env[v]})`));
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

/** Turn UGLY_STRING into uglyString */
function fixCase(ugly)
{
  var fixed = ugly.toLowerCase();
  var idx;

  while ((idx = fixed.indexOf('_')) !== -1)
    fixed = fixed.slice(0, idx) + fixed[idx + 1].toUpperCase() + fixed.slice(idx + 2);

  return fixed;
}

/**
 * Patch up an object graph to fix up minor class instance issues. For example, if we get a URL from the
 * internal bundle and then download a new URL class, it won't be an instance of the new class and it
 * won't benefit from any bug fixes, new functionality, etc.
 *
 * @param {object} patchupList    a mapping which tells us how to fix these problems for specific
 *                                classes. This map is an array with each element having the shape 
 *                                { how, right, wrong }.
 *
 *                                right - the right constructor to use
 *                                wrong - the wrong constructor we want to fixup
 *                                how   - the method to use getting from wrong to right
 */
function patchupClasses(patchupList, o, seen)
{
  /* seen list keeps us from blowing the stack on graphs with cycles */
  if (!seen)
    seen = [];
  if (seen.indexOf(o) !== -1)
    return;
  seen.push(o);

  for (let key in o)
  {
    let moreTraverse = true;
    if (!o.hasOwnProperty(key) || typeof o[key] !== 'object')
      continue;

    for (let i=0; i < patchupList.length; i++)
    {
      if (typeof o[key] !== 'object' || o[key] === null || (Object.getPrototypeOf(o[key]) !== patchupList[i].wrong.prototype))
        continue;
      assert(patchupList[i].wrong !== patchupList[i].right);
      
      switch (patchupList[i].how)
      {
        case 'kvin':
          o[key] = KVIN.unmarshal(KVIN.marshal(o[key]));
          break;
        case 'ctorStr':
          o[key] = new (patchupList[i].right)(String(o[key]));
          break;
        case 'ctor':
          o[key] = new (patchupList[i].right)(o[key]);
          break;
        case 'cast':
          o[key] = (patchupList[i].right)(o[key]);
          break;
        case 'from':
          o[key] = (patchupList[i].right).from(o[key]);
          break;
        case 'proto':
          Object.setPrototypeOf(o[key], patchupList[i].right.prototype);
          break;
        default:
          throw new Error(`unknown patchup method ${patchupList[i].how}`);
      }

      moreTraverse = false; /* don't patch up props of stuff we've patched up */
      break;
    }

    if (moreTraverse)
      patchupClasses(patchupList, o[key], seen);
  }
}

/** 
 * Tasks which are run in the early phases of initialization
 * - plumb in global.XMLHttpRequest which lives forever -- that way KeepAlive etc works.
 */
exports._initHead = function dcpClient$$initHead() {
  initInvoked = true; /* Allow us to eval require("dcp/compute"); from config */

  if (typeof XMLHttpRequest === 'undefined')
    XMLHttpRequest = require('dcp/dcp-xhr').XMLHttpRequest;
  
  require('dcp/signal-handler').init();
}

/** 
 * Tasks which are run in the late phases of initialization:
 * 1 - activate either the local bundle or the remote bundle against a fresh sandbox 
 *     using the latest config (future: bootstrap bundle will export fewer modules until init; 
 *     bundle will provide post-initialization nsMap).
 * 2 - inject modules from the final bundle on top of the bootstrap modules
 * 3 - patch up internal (to the final bundle) references to dcpConfig to reference our generated config
 * 4 - verify versioning information for key core components against running scheduler
 * 5 - load and cache identity & bank keystores if they are provided and options.parseArgv allows (default)
 * 6 - create the return object
 *
 * @param {object} configFrags          configuration fragments;
 *                                      .localConfig      - config we figured out locally
 *                                      .defaultConfig    - config we figured out internally
 *                                      .remoteConfigKVIN - serialized config we downloaded from scheduler
 *                                      .internalConfig   - reference to bootstrap bundle's dcpConfig object
 * @param {object} options              options argument passed to init()
 * @param {string} finalBundleCode      [optional] the code to evaluate as the final bundle, eg autoupdate
 * @param {object} finalBundleURL       [optional] instance of URL telling us the location where we
 *                                       downloaded the final bundle from
 * @returns the same `dcp` object as we expose in the vanilla-web dcp-client
 */
function initTail(configFrags, options, finalBundleCode, finalBundleURL)
{
  var nsMap;            /* the final namespace map to go from bundle->dcp-client environment */
  var bundle;           /* the final bundle, usually a copy of the bootstrap bundle */
  var finalBundleLabel; /* symbolic label used for logs describing the source of the final bundle */
  var ret;              /* the return value of the current function - usually the `dcp` object but
                           possibly edited by the postInitTailHook function. */
  var schedConfLocFun = require('dcp/protocol-v4').getSchedulerConfigLocation;

  /* 1 */
  bundleSandbox.dcpConfig = configFrags.internalConfig;
  if (finalBundleCode) {
    finalBundleLabel = String(finalBundleURL);
    bundle = evalStringInSandbox(finalBundleCode, bundleSandbox, finalBundleLabel);
  } else {
    const bundleFilename = path.resolve(distDir, 'dcp-client-bundle.js');
    finalBundleLabel = bundleFilename;
    bundle = evalFileInIIFE(bundleFilename, bundleSandbox);
  }
  nsMap = bundle.nsMap || require('./ns-map');  /* future: need to move non-bootstrap nsMap into bundle for stable auto-update */

  if (bundle.initTailHook) /* for use by auto-update future backwards compat */ 
    bundle.initTailHook(configFrags, bundle, finalBundleLabel, bundleSandbox, injectModule);

  /* 2 */
  debug('dcp-client:modules')(`Begin phase 2 module injection '${finalBundleLabel}'`);
  delete nsMap['dcp-config'];
  injectNsMapModules(nsMap, bundle, finalBundleLabel, true);
  injectModule('dcp/client', exports);
  injectModule('dcp/client-bundle', bundle);

  /**
   * We preserve the initial instance of the function from the initial bundle evaluation, otherwise it
   * closes over the wrong variable and returns `undefined` even though fetch has been used.
   */
  if (schedConfLocFun)
    require('dcp/protocol-v4').getSchedulerConfigLocation = schedConfLocFun;

  /* Class patch-up is necessary because the KVIN deserialzation and default initializations earlier
   * would have made instances  of classes inside the first bundle instead of the final bundle.
   *
   * URL->DcpURL patch is not strictly necessary at this stage, but it saves is from using the
   * dcpUrl patchup utility and thus a full traversal of the dcpConfig object graph.
   */
  const patchupList = [
    { how: 'kvin', wrong: KVIN.userCtors.dcpEth$$Address, right: require('dcp/wallet').Address },
    { how: 'kvin', wrong: KVIN.userCtors.dcpUrl$$DcpURL,  right: require('dcp/dcp-url').DcpURL },
    { how: 'ctor', wrong: URL,                            right: require('dcp/dcp-url').DcpURL },
  ];
  patchupClasses(patchupList, configFrags);

  /* Ensure KVIN deserialization from now on uses the current bundle's implementation for these classes */
  KVIN.userCtors.dcpUrl$$DcpURL  = require('dcp/dcp-url').DcpURL;
  KVIN.userCtors.dcpEth$$Address = require('dcp/wallet').Address;

  /* 3. Rebuild the final dcpConfig from the config fragments and other sources. The config fragments in
   * the bundle are considered secure even if they came from the auto-update bundle, as a user choosing
   * that feature is already executing arbitrary code from the scheduler with this loader.
   *
   * The remote config is re-deserialized, in case the auto-update carried bugfixes in the serializer.
   */
  const workingDcpConfig = require('dcp/dcp-config'); /* reference to final bundle's internal global dcpConfig */
  const remoteConfig = configFrags.remoteConfigKVIN ? KVIN.parse(configFrags.remoteConfigKVIN) : {};
  for (let protectedKey of protectedDcpConfigKeys) /* never accept modifications to these keys from scheduler */
    delete remoteConfig[protectedKey];

  addConfig(workingDcpConfig, configFrags.internalConfig);
  addConfig(workingDcpConfig, remoteConfig);
  addConfig(workingDcpConfig, configFrags.localConfig);
  addConfig(workingDcpConfig, originalDcpConfig);

  bundleSandbox.dcpConfig = workingDcpConfig;
  globalThis.dcpConfig    = workingDcpConfig;
  bundleSandbox.dcpConfig.build = require('dcp/build').config.build; /* dcpConfig.build deprecated mar 2023 /wg */

  /* 4 */
  if (workingDcpConfig.scheduler.configLocation !== false && typeof process.env.DCP_CLIENT_SKIP_VERSION_CHECK === 'undefined')
  {
    if (!workingDcpConfig.scheduler.compatibility || !workingDcpConfig.scheduler.compatibility.minimum)
      throw require('dcp/utils').versionError(workingDcpConfig.scheduler.location.href, 'scheduler', 'dcp-client', '4.0.0', 'EDCP_CLIENT_VERSION');

    if (workingDcpConfig.scheduler.compatibility)
    {
      let ourVer = require('dcp/protocol').version.provides;
      let minVer = workingDcpConfig.scheduler.compatibility.minimum.dcp;
      let ok = require('semver').satisfies(ourVer, minVer);
      debug('dcp-client:version')(` * Checking compatibility; dcp-client=${ourVer}, scheduler=${minVer} => ${ok ? 'ok' : 'fail'}`);
      if (!ok)
        throw require('dcp/utils').versionError('DCP Protocol', 'dcp-client', workingDcpConfig.scheduler.location.href, minVer, 'EDCP_PROTOCOL_VERSION');
    }
  }
  
  /* 5 */
  if (options.parseArgv !== false) {
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
    ret = bundle.postInitTailHook(ret, configFrags, bundle, finalBundleLabel, bundleSandbox, injectModule);
  dcpConfig.build = bundleSandbox.dcpConfig.build = require('dcp/build').config.build; /* dcpConfig.build deprecated March 2023 */

  return ret;
}

/**
 * Takes the arguments passed to init() or initSync(), works out the overload, and returns an
 * object with two properies:
 * - localConfig: a dcpConfig fragment
 * - options: an options object
 * 
 * This routine also populates certain key default values, such as the scheduler and program name that
 * need to always be defined, and updates the localConfig fragment to reflect appropriate options.
 *
 * Form 1 - {string} scheduler location
 * Form 2 - {URL}    scheduler location
 * Form 3 - {object} options
 * Form 4 - {object} dcpConfig fragment, {object} options (DEPRECATED)
 *
 * Rather than use form 4, pass a dcpConfig option to form 3
 *
 * See init() for complete documentation of what this function can parse.
 */
function handleInitArgs(initArgv)
{
  var initConfig = { scheduler: {}, bundle: {} };
  var options;
  const defaultOptions = {
    programName: process.mainModule ? path.basename(process.mainModule.filename, '.js') : 'node-repl',
    parseArgv:   !Boolean(process.env.DCP_CLIENT_NO_PARSE_ARGV),
  };

  switch (initArgv.length)
  {
    case 0:
      options = defaultOptions;
      break;
    case 1:
      if (typeof initArgv[0] === 'string')                      /* form 1 */
        options = { scheduler: new URL(initArgv[0]) };
      else if (initArgv[0] instanceof URL)
        options = { scheduler: initArgv[0] };                   /* form 2 */
      else
        options = Object.assign(defaultOptions, initArgv[0]);   /* form 3 */
      break;
    default:
      throw new Error('Too many arguments dcp-client::init()!');
    case 2:
      options = Object.assign(defaultOptions, { dcpConfig: initArgv[0] }, initArgv[1]); /* form 4 - deprecated */
      break;
  }

  options.dcpConfig = Object.assign(initConfig, options.dcpConfig);
  if (options.scheduler)
    initConfig.scheduler.location = new URL(options.scheduler);    
  if (options.autoUpdate)
    initConfig.bundle.autoUpdate = true;
  if (options.bundleLocation)
    initConfig.bundle.location = new URL(options.bundleLocation);

  return {
    initConfig,  /* configuration derived from call to dcp-client::init() or initSync() */
    options      /* generic options - eg parseArgv */
  };
}

/**
 * Initialize the dcp-client bundle for use by the compute API, etc. - Form 1
 * 
 * @param       {string}                url
 *                                      Location of scheduler, from whom we download
 *                                      dcp-config.js, which in turn tells us where to
 *                                      find the bundle.
 * @returns     a Promise which resolves to the dcpConfig which bundle-supplied libraries will see.
 */
/**
 * Form 2
 * 
 * @param       {URL object}            url
 *                                      Location of scheduler, from whom we download
 *                                      dcp-config.js, which in turn tells us where to
 *                                      find the bundle.
 */
/**
 * Form 3
 *
 * @param       {object}                options         an options object, higher precedence config of
 *                                                      - scheduler (URL or string)
 *                                                      - parseArgv; false => not parse cli for scheduler/wallet
 *                                                      - bundleLocation (URL or string)
 *                                                      - reportErrors; false => throw, else=>console.log, exit(1)
 */
/**
 * Form 4
 * @deprecated
 *
 * @param       {object}                dcpConfig       a dcpConfig object which can have
 *                                                      scheduler.location, bundle.location, bundle.autoUpdate
 * @param       {object}                options         an options object, higher precedence config of
 *                                                      - scheduler (URL or string)
 *                                                      - parseArgv; false => not parse cli for scheduler/wallet
 *                                                      - bundleLocation (URL or string)
 *                                                      - reportErrors; false => throw, else=>console.log, exit(1)
 *                                                      - configName: filename to load as part of default dcpConfig
 *                                                      - dcpConfig: object to include as part of default dcpConfig
 */
exports.init = async function dcpClient$$init() {
  var { initConfig, options } = handleInitArgs(arguments);

  var configFrags;
  var finalBundleCode = false;
  var finalBundleURL;

  reportErrors = options.reportErrors;
  exports._initHead();
  configFrags = await exports.createConfigFragments(initConfig, options);

  finalBundleURL = configFrags.localConfig.bundle.autoUpdate ? configFrags.localConfig.bundle.location : false;
  if (finalBundleURL) {
    try {
      debug('dcp-client:bundle')(` * Loading autoUpdate bundle from ${finalBundleURL.href}`);
      finalBundleCode = await require('dcp/utils').justFetch(finalBundleURL.href);
    } catch(error) {
      if (reportErrors !== false)
      {
        console.error('Error downloading autoUpdate bundle from ' + finalBundleURL);
        console.debug(require('dcp/utils').justFetchPrettyError(error));
        process.exit(1);
      }
      throw error;
    }
  }

  return initTail(configFrags, options, finalBundleCode, finalBundleURL);
}

/**
 * Sync version of dcp-client.init().
 */
exports.initSync = function dcpClient$$initSync() {
  var { initConfig, options } = handleInitArgs(arguments);
  var configFrags;
  var finalBundleCode = false;
  var finalBundleURL;
  
  exports._initHead();
  configFrags = createConfigFragmentsSync(initConfig, options);

  finalBundleURL = configFrags.localConfig.bundle.autoUpdate ? configFrags.localConfig.bundle.location : false;
  if (finalBundleURL) {
    try {
      debug('dcp-client:bundle')(` * Loading autoUpdate bundle from ${finalBundleURL.href}`);
      finalBundleCode = exports.fetchSync(finalBundleURL);
    } catch(error) {
      if (reportErrors !== false)
      {
        console.error('Error downloading autoUpdate bundle from ' + finalBundleURL);
        /* detailed error output comes from fetchSync via stdin/stderr passthrough */
        process.exit(1);
      }
      throw error;
    }
  }

  return initTail(configFrags, options, finalBundleCode, finalBundleURL);
}

/**
 * Generate a local config object from the environment
 */
function mkEnvConfig()
{
  debug('dcp-client:config')(` * Loading configuration from environment`);

  const envConfig = { scheduler: {}, bundle: {} };
  const env = process.env;

  if (env.DCP_SCHEDULER_LOCATION)     addConfig(envConfig.scheduler, { location: new URL(env.DCP_SCHEDULER_LOCATION) });
  if (env.DCP_CONFIG_LOCATION)        addConfig(envConfig.scheduler, { configLocation: new URL(env.DCP_CONFIG_LOCATION) });
  if (env.DCP_CONFIG_LOCATION === '') addConfig(envConfig.scheduler, { configLocation: false }); /* explicitly request no remote config */
  if (env.DCP_BUNDLE_AUTOUPDATE)      addConfig(envConfig.bundle,    { autoUpdate: !!env.DCP_BUNDLE_AUTOUPDATE.match(/^true$/i) } );
  if (env.DCP_BUNDLE_LOCATION)        addConfig(envConfig.bundle,    { location: new URL(env.DCP_BUNDLE_LOCATION) });
  if (env.DCP_BUNDLE_LOCATION === '') addConfig(envConfig.bundle,    { location: false }); /* explicitly request no remote bundle */

  return envConfig;
}

/**
 * Generate a local config object from the program's command line
 */
function mkCliConfig(cliOpts)
{
  const cliConfig = { scheduler: {} };

  debug('dcp-client:config')(` * Loading configuration from CLI options`);

  if (cliOpts.dcpScheduler) cliConfig.scheduler.location = new URL(cliOpts.dcpScheduler);

  return cliConfig;
}

/**
 * Create the aggregate dcpConfig for the running program. This config is based on things like
 * - command-line options
 * - environment variables
 * - files in various locations
 * - various registry keys
 * - baked-in defaults
 * - parameters passed to init() or initSync()
 *
 * @param {object} initConfig   dcpConfig fragment passed to init() or initSync()
 * @param {object} options      options object passed to init() or initSync() or derived some other way.
 *                              Options include:
 *      - programName    {string}:      the name of the program (usually derived from argv[1])
 *      - parseArgv      {boolean}:     false to ignore cli opt parsing
 *      - scheduler      {string|URL}:  location of the DCP scheduler
 *      - autoUpdate     {boolean}:     true to download a fresh dcp-client bundle from the scheduler
 *      - bundleLocation {string|URL}:  location from where we will download a new bundle
 *      - configScope    {string}:      arbitrary name to use in forming various config fragment filenames
 *      - configName     {string}:      arbitrary name to use to resolve a config fragment filename 
 *                                      relative to the program module
 * @returns {object} with the following properties:
 *  - defaultConfig:    this is the configuration buried in dcp-client (mostly from the bundle but also index.js)
 *  - localConfig:      this is the configuration we determined solely from local sources
 *  - remoteConfigKVIN: this is the serialized configuration we downloaded from the scheduler
 *  - internalConfig:   this is a reference to the internal dcpConfig object
 */
exports.createConfigFragments = async function dcpClient$$createConfigFragments(initConfig, options)
{
/* The steps that are followed are in a very careful order; there are default configuration options 
 * which can be overridden by either the API consumer or the scheduler; it is important that the wishes 
 * of the API consumer always take priority, and that the scheduler is unable to override parts of 
 * dcpConfig which are security-critical, like allowOrigins, minimum wage, bundle auto update, etc.
 *
 *  1 - create the local config by
 *       - checking an existing dcpConfig variable
 *       - reading the config buried in the bundle and defined at module load
 *       - reading files in ~/.dcp, /etc/dcp, etc or using hard-coded defaults
 *       - reading the registry
 *       - receiving input from the cli module
 *       - arguments to init()
 *       - use the config + environment + arguments to figure out where the scheduler is
 *       - etc  (see dcp-docs file dcp-config-file-regkey-priorities)
 *  2 - merge the passed-in configuration on top of the default configuration 
 *  5 - pull the scheduler's config, and layer it on top of the current configuration to find scheduler
 */
  const cliOpts = require('dcp/cli').base().help(false).parse();
  const etc  = process.env.DCP_ETCDIR || (os.platform() === 'win32' ? process.env.ALLUSERSPROFILE : '/etc');
  const home = process.env.DCP_HOMEDIR || os.homedir();
  let programName = options.programName;
  const configScope = cliOpts.configScope || process.env.DCP_CONFIG_SCOPE || options.configScope;
  const progDir = process.mainModule ? path.dirname(process.mainModule.filename) : undefined;
  var   remoteConfig, remoteConfigKVIN;
  const internalConfig = require('dcp/dcp-config'); /* needed to resolve dcpConfig.future - would like to eliminate this /wg */
  const defaultConfig = Object.assign({}, bootstrapConfig);
  addConfig(defaultConfig, internalConfig);
  addConfig(defaultConfig, KVIN.unmarshal(require('dcp/internal/dcp-default-config')));
  defaultConfig.scheduler = { location: new URL('https://scheduler.distributed.computer/') };

  /* localConfig eventually overrides remoteConfig, and is the dcpConfig variable that is modified by
   * local include files. Pre-populating the graph edges with config nodes that always exist allows
   * config file writers to add properties to leaf nodes without having to construct the entire graph;
   * then these leaf nodes eventually overwrite the same-pathed nodes which arrive in the remote conf.
   *
   * The pre-populated localConfig graph then has each of its nodes inherit from the equivalent node
   * in defaultConfig. This allows us to read properties in localConfig and get values from 
   * defaultConfig (assuming they haven't been overwritten), but writing to localConfig won't alter
   * the defaultConfig.  This is important, because need to preserve the config stack but allow
   * user-supplied dcp-config.js files to read the existing config and use it to generate new
   * configs... in particular, the worker uses this mechanism to specify default allow origins in terms
   * of the current value of scheduler.location.
   */
  const localConfig = magicView(defaultConfig);

  if (!programName)
    programName = process.mainModule && process.mainModule.filename || false;
  if (programName)
    programName = path.basename(programName, '.js');

  /* "warm up" the local ahead of actually reading in the config files. These options are higher-
   * precedence than reading them at the base level, but providing them at the base level first
   * means that lower-level config files can see them. The class example again is that the worker
   * needs to know the scheduler location in order to generate the default allow lists, but the
   * scheduler location can be override by the environment or command-line.  The one thing that
   * we can't really support easily is having a config file modify something in terms of what
   * gets loaded in a later config file. That would require a much more complex syntax (futures)
   * and is probably not worth it.
   */
  addConfig    (localConfig, initConfig);
  addConfigEnv (localConfig, 'DCP_CONFIG_');
  addConfig    (localConfig, mkEnvConfig());
  addConfig    (localConfig, mkCliConfig(cliOpts));

  /**
   * 4. Use the config + environment + arguments to figure out where the
   *    scheduler is.
   *
   * Only override the scheduler from argv if cli specifies a scheduler.
   * e.g. the user specifies a --dcp-scheduler option.
   * See spec doc dcp-config-file-regkey-priorities 
   * Note: this code is Sep 2022, overriding older spec, spec update to come. /wg
   * 
   * The basic idea is that key collisions are overridden on the basis of "most specificity to current
   * executable wins" - so local disk is stronger than remote network config, homedir is stronger than
   * /etc, BUT we also have an override in /etc, and specific-program-name config files in /etc are more
   * powerful than those in the user's homedir. The reason for this is so that sysadmins can create
   * strongish machine-wide configuration/security-theatre policies. These are not real security, as
   * any intelligent user can always change the source code to do whatever they please, but it does
   * make sense for campus configurations where sysadmins believe the machines are locked down, etc.
   */
  let cn;
        addConfigFile(localConfig, etc,    'dcp/dcp-config');
  await addConfigRKey(localConfig, 'HKLM', 'dcp/dcp-config');
   cn = addConfigFile(localConfig, options.configName && path.resolve(progDir, options.configName));
        addConfigFile(localConfig, home,  '.dcp/dcp-config');
  await addConfigRKey(localConfig, 'HKCU', 'dcp/dcp-config');
        addConfigFile(localConfig, home,  `.dcp/${programName}/dcp-config`);
  await addConfigRKey(localConfig, 'HKCU', `dcp/${programName}/dcp-config`);
        addConfigFile(localConfig, home,  '.dcp/scope', configScope);
  await addConfigRKey(localConfig, 'HKCU', 'dcp/scope', configScope);
        addConfig    (localConfig, initConfig);
        addConfigEnv (localConfig, 'DCP_CONFIG_');
        addConfig    (localConfig, mkEnvConfig());
        addConfig    (localConfig, mkCliConfig(cliOpts));
        addConfigFile(localConfig, etc,    `dcp/${programName}/dcp-config`);
  await addConfigRKey(localConfig, 'HKLM', `dcp/${programName}/dcp-config`);
        addConfigFile(localConfig, etc,    'dcp/override-dcp-config');
  await addConfigRKey(localConfig, 'HKLM', 'dcp/override-dcp-config');
        addConfigFile(localConfig, etc,    'dcp/scope', configScope);
  await addConfigRKey(localConfig, 'HKLM', 'dcp/scope', configScope);
  await addConfigRKey(localConfig, 'HKLM', 'dcp-client/dcp-config'); /* legacy - used by screen saver, /wg sep'22 */

  exports.__cn = cn; /* memoize for use by dcp-worker etc who need to know where local conf came from */
  
  /* 5. Use the aggregate of the default and local configs to figure out where the scheduler is. Use
   *    this to figure where the web config is and where an auto-update bundle would be if auto-update
   *    were enabled.
   */
  const aggrConfig = Object.assign({}, internalConfig);
  addConfig(aggrConfig, defaultConfig);
  addConfig(aggrConfig, localConfig);
  addConfig(aggrConfig, originalDcpConfig);
  require('dcp/dcp-url').patchup(aggrConfig);

  if (!aggrConfig.scheduler.configLocation && aggrConfig.scheduler.configLocation !== false)
    aggrConfig.scheduler.configLocation = localConfig.scheduler.configLocation = aggrConfig.scheduler.location.resolveUrl('/etc/dcp-config.kvin');
  if (!aggrConfig.bundle.location && aggrConfig.bundle.location !== false)
    aggrConfig.bundle.location = localConfig.bundle.location = aggrConfig.scheduler.location.resolveUrl('/dcp-client/dist/dcp-client-bundle.js')
  localConfig.scheduler.location = aggrConfig.scheduler.location;
  
  debug('dcp-client:config')(` . scheduler is at ${localConfig.scheduler.location}`);
  debug('dcp-client:config')(` . auto-update is ${localConfig.bundle.autoUpdate ? 'on' : 'off'}; bundle is at ${localConfig.bundle.location}`);

  if (aggrConfig.scheduler.configLocation === false)
    debug('dcp-client:config')(` ! Not loading configuration from remote scheduler`);
  else
  {
    try
    {
      debug('dcp-client:config')(` * Loading configuration from ${aggrConfig.scheduler.configLocation.href}`);
      remoteConfigKVIN = await require('dcp/protocol').fetchSchedulerConfig(aggrConfig.scheduler.configLocation);
      remoteConfig = KVIN.parse(remoteConfigKVIN);
      for (let protectedKey of protectedDcpConfigKeys) /* never accept modifications to these keys from scheduler */
        delete remoteConfig[protectedKey];
    }
    catch(error)
    {
      if (reportErrors !== false)
      {
        console.error('Error: dcp-client::init could not fetch scheduler configuration at ' + aggrConfig.scheduler.configLocation);
        console.debug(require('dcp/utils').justFetchPrettyError(error));
        process.exit(1);
      }
      throw error;
    }
  }
  
  /**
   * Default location for the auto update bundle is the scheduler so that the
   * scheduler and the client are on the same code.
   */
  if (!aggrConfig.bundle.location && aggrConfig.scheduler && aggrConfig.scheduler.location) {
    localConfig.bundle.location = new URL(`${aggrConfig.scheduler.location}dcp-client/dist/dcp-client-bundle.js`);
    addConfig(aggrConfig, localConfig);
  }

  return { defaultConfig, localConfig, remoteConfigKVIN, internalConfig };
}

exports.initcb = require('./init-common').initcb

/** 
 * Create the aggregate config - which by definition does async work - by 
 * spawning another process (and other reactor) and then blocking until 
 * it is available.  Used to implement initSync().
 *
 * The other process receives the same command-line options and environment
 * as "this" process, and uses the code in this file to derive the aggrConfig,
 * so we should be able to have the exact same derived configuration for
 * clients using either init() or initSync().
 *
 * @param {object} initConfig   parameter for createConfigFragments()
 * @param {object} options      parameter for createConfigFragments()
 */
function createConfigFragmentsSync(initConfig, options)
{
  const spawnArgv = [require.resolve('./bin/build-dcp-config')].concat(process.argv.slice(2));
  const input = KVIN.stringify({ initConfig, options });
  const env = process.env.DEBUG ? Object.assign({}, process.env) : process.env;
  delete env.DEBUG;

  debug('dcp-client:config-spawn')(' * spawn: ' + spawnArgv.map(x => / /.test(x) ? `"${x}"` : x).join(' '));
  debug('dcp-client:config-spawn')(' . input: ' + input);
  const child = spawnSync(
    process.execPath,
    spawnArgv,
    {
      env: process.env,
      shell: false,
      windowsHide: true,
      /**
       * Create a 4th file descriptor to use for piping the serialized config
       * from build-dcp-config. (e.g. child.output[3])
       */
      stdio: ['pipe', 'inherit', 'inherit', 'pipe'],
      input
    },
  );
  
  if (child.status !== 0 || !child.output[3] || child.output[3].length === 0)
    throw new Error(`Error running ${spawnArgv[0]} (exitCode=${child.status})`);

  const serializedOutput = String(child.output[3]);
  const configFrags = KVIN.parse(serializedOutput);
  configFrags.internalConfig = require('dcp/dcp-config');

  debug('dcp-client:init')('fetched configuration fragments', Object.keys(configFrags));
  return configFrags;
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
  var env = { FORCE_COLOR: 1 };
  
  if (reportErrors === false)
    argv.push('--silent');
  if (typeof url !== 'string')
    url = url.href;
  argv.push(url);

  child = spawnSync(argv[0], argv.slice(1), { 
    env: Object.assign(env, process.env), shell: false, windowsHide: true,
    stdio: [ 'ignore', 'inherit', 'inherit', 'pipe' ],

    /**
     * Setting the largest amount of data in bytes allowed on stdout or stderr to 10 MB
     * so that dcp-client-bundle.js (~5.2 MB built in debug mode with source-mapped line
     * in late jan 2023) can be downloaded without the child exiting with a status of 
     * null (i.e. ENOBUFS).
     */
    maxBuffer: 10 * 1024 * 1024,
  });

  if (child.status !== 0)
    throw new Error(`Child process returned exit code ${child.status}`);
  return child.output[3].toString('utf-8');
}

exports.__KVIN = KVIN;
exports.__require = require;

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
