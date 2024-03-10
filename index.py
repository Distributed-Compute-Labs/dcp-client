# @file        index.py
#              PythonMonkey loader for the dcp-client package.
#
#              During module initialization, we load dist/dcp-client-bundle.js from the
#              same directory as this file, and setup a minimum compatibility environment
#              for dcp-client to execute in.
#
#              Note that while this code may use PythonMonkey's require() to get things done,
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
import urllib.request
import asyncio

dcp_client_bundle_filename = os.path.dirname(__file__) + '/dist/dcp-client-bundle.js'
dcp_support = pm.require('./dcp-support');
fs_basic    = pm.require('./fs-basic');

# load dcp-client, then run the callback function
async def load_dcp_client(callback):
    cb_retval = None
    try:
        here = { 'filename': __file__, 'fromPythonFrame': True }
        scheduler_location = os.getenv('DCP_SCHEDULER_LOCATION')
        if (scheduler_location == None):
            scheduler_location = 'https://scheduler.distributed.computer'
        bundle_location = scheduler_location + '/etc/dcp-config.js'
        dcp_config_js = urllib.request.urlopen(bundle_location).read().decode();
        pm.eval('globalThis.window = {}; globalThis.dcpConfig =' + dcp_config_js, { 'filename': bundle_location });
        pm.eval('delete globalThis.window', here) # we might need to keep window?
        pm.eval('globalThis.dcpConfig.build = "debug";', here); # we should fix the bundle so that this is not necessary
        pm.eval('globalThis.crypto = {};', here);
        pm.globalThis['crypto']['getRandomValues'] = dcp_support['getRandomValues']

        bundle_code = fs_basic['readFile'](dcp_client_bundle_filename)
        dcp_client_modules = pm.eval(bundle_code, { 'filename': dcp_client_bundle_filename })
        pm.eval('globalThis', here)['dcp'] = dcp_client_modules;
        pm.eval('Object.assign', here)(pm.globalThis.dcp['fs-basic'], fs_basic);
        dcp_client_modules['utils']['expandPath'] = os.path.expanduser;

        if (callback):
            cb_retval = await callback()
    except Exception as error:
        print('Error loading bundle:', error, bundle_location)
    await pm.wait() # blocks until all asynchronous calls finish
    return cb_retval

def init(callback):
    asyncio.run(load_dcp_client(callback))

# exports of dcp-client python-language CommonJS module
exports['init'] = init;
