const path = require('path');

process.env.DCP_HOMEDIR = path.resolve(path.dirname(module.filename), '../tests-homedir');
process.env.DCP_CONFIG_LOCATION = '';
process.env.DCP_REGISTRY_BASEKEY = `Software\\Kings Distributed Systems\\DCP-Test-Temp.${process.pid}`;
