/**
 * @file        setup-testenv.js
 *              Library code to set up the test environment for Peter .simple tests, so that the tests
 *              do not require a running scheduler, and are not influenced by the testing user's personal
 *              nor machine-wide configs, nor the scheduler's configs.
 * @author      Wes Garland, wes@kingsds.network
 * @date        Sep 2020
 */
'use strict';

const path = require('path');

process.env.DCP_HOMEDIR = path.resolve(path.dirname(module.filename), '../test-pseudo-root/home/username');
process.env.DCP_ETCDIR  = path.resolve(path.dirname(module.filename), '../test-pseudo-root/etc');
if (!process.env.DCP_CONFIG_LOCATION)
   process.env.DCP_CONFIG_LOCATION = '';
if (process.env.DCP_SCHEDULER_LOCATION)
  process.env.DCP_SCHEDULER_LOCATION = '';
process.env.DCP_REGISTRY_BASEKEY = `Software\\Distributive\\DCP-Client-Tests\\Peter`;

if (require('os').platform() === 'win32')
{
  require('child_process').spawnSync('reg.exe', [ 'delete', 'HKLM\\' + process.env_DCP_REGISTRY_BASEKEY, '-f' ]);
  require('child_process').spawnSync('reg.exe', [ 'delete', 'HKCU\\' + process.env_DCP_REGISTRY_BASEKEY, '-f' ]);
}

/* Some tests don't load dcp-client */
var dcpDcp;
try
{
  dotDcp = require('dcp/dcp-dot-dir');
}
catch(e) {};
if (dcpDcp)
  dotDcp.setHomeDir(process.env.DCP_HOMEDIR);
