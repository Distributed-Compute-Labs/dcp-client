# @file        index.py
#              PythonMonkey loader for the dcp-client package.
#
#              During module initialization, we load dist/dcp-client-bundle.js from the
#              same directory as this file, and setup a minimum compatibility environment
#              for dcp-client to execute in.
#
#              Note that while this code may use PythonMonkey"s require() to get things done,
#              require is not exposed as a symbol to JS here; the environment used by dcp-client
#              for PythonMonkey looks pretty much like a web browser to keep things like SocketIO
#              happy.
#
#              A few OS-level interfaces are plumbed in, however, so that the dcp-client UX
#              remains somewhat similar to Node.js.  In particular,
#              - window.localStorage is on disk and compatible with the Node.js version
#              - id and bank keystores are loaded from the same location on disk as the Node.js version
#              - FUTURE: support for oAuth
#              - FUTURE: support for dcp-config fragments based on the Node.js loader (./index.js)
#              - FUTURE: support for bundle auto-update similar to the Node.js loader
#
# @author      Will Pringle, will@distributive.network
# @author      Wes Garland, wes@distributive.network
# @date        Feb 2024
#
import pythonmonkey as pm
import os
import asyncio

# @todo determine dcp_client_bundle_filename inside JS via require.resolve
dcp_client_bundle_filename = os.path.dirname(__file__) + "/dist/dcp-client-bundle.js"

# load dcp-client, then run the callback function
async def load_dcp_client(*args, **kwargs):
    if len(args) == 1:
        callback = args[0]
        if callable(callback) != True:
            raise Exception("callback must be callable")
    elif len(args) != 0:
        raise Exception("invalid arguments; expected 0 or 1")
    cb_retval = None

    def fetch(url):
        try:
            import urllib.request
            return urllib.request.urlopen(url).read().decode()
        except Exception as error:
            print("Error loading", url)
            raise error

    here = { "filename": __file__, "fromPythonFrame": True }
    dcp_client_modules = pm.eval("""'use strict';(
function iife(callback, kwargs, fetch, require, bootstrapRequire)
{
  const fsBasic = require('./fs-basic');
  const dcpSupport = require('./dcp-support');
  const debug = bootstrapRequire('debug');
  const vm = bootstrapRequire('vm');
  debug('dcp-client:')('initializing');

  const schedulerLocation = kwargs.scheduler || python.getenv('DCP_SCHEDULER_LOCATION') || 'https://scheduler.distributed.computer';
  const configLocation = kwargs.config || python.getenv('DCP_CONFIG_LOCATION') || schedulerLocation + '/etc/dcp-config.js';
  globalThis.window = globalThis; /** @todo fix in pythonmonkey */
  globalThis.crypto = Object.assign({}, { getRandomValues: dcpSupport.getRandomValues }, globalThis.crypto);

  /** @todo extract baked-in defaults from bundle */
  if (!globalThis.dcpConfig)
    globalThis.dcpConfig = {};

  if (configLocation === false || configLocation === '') /* explicitly request no remote config */
  {
    debug('dcp-client:config')('no remote config')
    if (!globalThis.dcpConfig)
      globalThis.dcpConfig = {};
    Object.assign(globalThis.dcpConfig, { scheduler: { configLocation: false } });
  }
  else
  {
    /** @todo use KVIN version instead */
    debug('dcp-client:config')('fetching config from', configLocation);
    const dcpConfigCode = fetch(configLocation);
    Object.assign(globalThis.dcpConfig, vm.runInContext(dcpConfigCode, undefined, { "filename": configLocation }));
  }

  globalThis.dcpConfig.build = 'debug' /** @todo fix the bundle so that this is not necessary */
  const bundleFilename = require.resolve('./dist/dcp-client-bundle');
  debug('dcp-client:bundle')('loading bundle', bundleFilename);
  const bundleCode = fsBasic.readFile(bundleFilename);
  debug('dcp-client:bundle')('evaluating bundle', bundleFilename);
  /** @todo after PM #298:
  const dcpClientExports = vm.runInContext(bundleCode, undefined, { "filename": bundleFilename });
  */
  require = undefined;
  const dcpClientExports = eval(bundleCode);
  debug('dcp-client:bundle')('loaded bundle', bundleFilename);
  globalThis.dcp = dcpClientExports;
  Object.assign(dcpClientExports['fs-basic'], fsBasic);
  return dcpClientExports;
}) /* iife */;
""", here)(*args, kwargs, fetch, pm.createRequire(__file__), pm.bootstrap.require)

    dcp_client_modules["utils"]["expandPath"] = os.path.expanduser

    if (callback):
        cb_retval = await callback()

    await pm.wait()
    return cb_retval

def init(*args, **kwargs):
    asyncio.run(load_dcp_client(*args, **kwargs))

# exports of dcp-client python-language CommonJS module
exports["init"] = init;
