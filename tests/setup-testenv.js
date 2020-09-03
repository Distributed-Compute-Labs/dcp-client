/** Set up the test environment for Peter .simple tests, so that the tests 
 *  do not require a running scheduler (except when absolutely necessary),
 *  and are not influenced by the testing user's personal nor machine-wide
 *  configs.
 */
const path = require('path');

process.env.DCP_HOMEDIR = path.resolve(path.dirname(module.filename), '../tests-homedir');
process.env.DCP_ETCDIR  = path.resolve(path.dirname(module.filename), '../tests-etc');
process.env.DCP_CONFIG_LOCATION = '';
process.env.DCP_REGISTRY_BASEKEY = `Software\\Kings Distributed Systems\\DCP-Client-Tests\\Peter`;

require('child_process').spawnSync('reg.exe', [ 'delete', 'HKLM\\' + process.env_DCP_REGISTRY_BASEKEY, '-f' ]);
require('child_process').spawnSync('reg.exe', [ 'delete', 'HKCU\\' + process.env_DCP_REGISTRY_BASEKEY, '-f' ]);


