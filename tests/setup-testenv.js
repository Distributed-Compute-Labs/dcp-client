/**
 * @file        setup-testenv.js
 *              Library code tosSet up the test environment for Peter .simple tests, so that the tests
 *              do not require a running scheduler, and are not influenced by the testing user's personal
 *              nor machine-wide configs, nor the scheduler's configs.
 * @author      Wes Garland, wes@kingsds.network
 * @date        Sep 2020
 */
const path = require('path');

process.env.DCP_HOMEDIR = path.resolve(path.dirname(module.filename), '../tests-homedir');
process.env.DCP_ETCDIR  = path.resolve(path.dirname(module.filename), '../tests-etc');
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
