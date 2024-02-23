# @file        index.py
#              PythonMonkey loader for the dcp-client package.
#
#              Question: should this by a PythonMonkey .py CommonJS Module, or a Python module?
#                        It is current a CJS module.
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
        dcp_config_js = urllib.request.urlopen('https://scheduler.distributed.computer/etc/dcp-config.js').read().decode();
        pm.eval('globalThis.window = {}; globalThis.dcpConfig =' + dcp_config_js);
        pm.eval('delete globalThis.window') # we might need to keep window?
        pm.eval('globalThis.dcpConfig.build = "debug";'); # we should fix the bundle so that this is not necessary
        pm.eval('globalThis.crypto = {};');
        pm.globalThis['crypto']['getRandomValues'] = dcp_support['getRandomValues']

        bundle_code = fs_basic['readFile'](dcp_client_bundle_filename)
        dcp_client_modules = pm.eval(bundle_code)
        pm.eval('globalThis')['dcp'] = dcp_client_modules;
        pm.eval('Object.assign')(pm.globalThis.dcp['fs-basic'], fs_basic);
        dcp_client_modules['utils']['expandPath'] = os.path.expanduser;

        if (callback):
            cb_retval = callback()
    except Exception as error:
        print('Error loading bundle:', error)
    await pm.wait() # blocks until all asynchronous calls finish
    return cb_retval

def init(callback):
    asyncio.run(load_dcp_client(callback))
    
# exports of dcp-client python-language CommonJS module
exports['init'] = init;
