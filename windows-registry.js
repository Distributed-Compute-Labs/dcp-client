/**
 * @file        windows-registry.js
 *              Windows registry configuration/integration utility for DCP. All exported functions
 *              return false on non-Windows platforms.
 *
 *              Basic idea: summarize registry into an objects which can be used as the
 *              initializer object for DCP Client and wallet cache. Multiple hives are read
 *              to support higher-priviledged overrides for Administrators writing Group
 *              Policy files in Enterprise installs.
 *
 *              Note: In registry-speak, keys are like directories and values are like files -- i.e. a key can
 *              contain keys and/or values, but values cannot contain keys; only strings and numbers and stuff.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Jul 2020
 */

const machHive = 'HKLM';
const userHive = 'HKCU';
const regedit = require('regedit');

exports.baseKey = 'Software\\Kings Distributed Systems';

/** Join multiple registry keys fragments together into a full path. 
 *  @param      {string|Array} ...
 *  @returns    {string}
 */
function keyJoin(/*...*/) {
  var args = Array.from(arguments);
  var flat = args.reduce((arr, x) => arr.concat(x), []);

  return flat.join('\\');
}

/** Get all of the entries for a given key.  Keys are returned in a property
 *  named keys.  Values are returned in a property named values.
 */
async function getEntries(key) {
  var entries = {};

  return new Promise(function (resolve, reject) {
    try {
      let stream = regedit.list([key]);

      stream.on('data', function(entry) {
        entries[entry.key] = entry.data;
      });

      stream.on('finish', function () {
        resolve(entries);
      })
    } catch(e) {
      reject(e);
    }
  })
}

/** Get all of the keys for a given key */
async function getKeys(key) {
  let entries = await getEntries(key);
  return entries[key].keys || [];
}

/** Get all of the values for a given key */
async function getValues(key) {
  let entries = await getEntries(key);
  return entries[key].values || {};
}

/** Returns true if a given key exists in the registry. Strange algorithm works
 *  around bugs in the npm regedit package.
 *
 *  @param      {string}        key            The key to check, eg HKLM\\Software\\Kings Distributed Systems
 *  @returns Promise which resolves to boolean
 */
async function XXXkeyExists(key) {
  console.log('checking', key);
  var components = key.split('\\');
  var parent = components.slice(0, components.length - 1).join('\\');
  var keyBase = components[components.length - 1];
  var parentSubKeys;

  if (components.length === 1)
    return true; /* assume all hives exist */

  if (!keyExists(parent))
    return false;

  parentSubKeys = await getKeys(parent);
  return (parentSubKeys.map((a) => a.toUpperCase()).filter((a) => a === keyBase.toUpperCase())).length !== 0;
}

/** Returns true if a given key exists in the registry. Strange algorithm works
 *  around bugs in the npm regedit package.
 *
 *  @param      {string}        key            The key to check, eg HKLM\\Software\\Kings Distributed Systems
 *  @returns Promise which resolves to boolean
 */
async function keyExists(key) {
  console.log('checking', key);

  var lhs, rhs;

  for (rhs = key.split('\\'), lhs = rhs.splice(0,2).join('\\');
       rhs.length;
       lhs += '\\' + rhs.shift()) {
    console.log('lhs', lhs);
    let subKeys = await getKeys(lhs);
    console.log('subKeys of', lhs, 'are', subKeys);
    if ((subKeys.map((a) => a.toUpperCase()).filter((a) => a === rhs[0].toUpperCase())).length === 0)
      return false;
  }
  return true;
}

/**
 * Return the registry tree, including both keys and values, from the rootPath on down. 
 * keys are represented as JS objects, values are represented as JS values. For example,
 * a registry with \\HKCU\KDS\dcp-client\scheduler\location = 'https://scheduler.kds.net'
 * would become { 'dcp-client': scheduler: { location: 'https://scheduler.kds.net' } } if
 * the rootPath were \\HKCU\KDS.
 *
 * @param {string}      rootPath        The registry key to traverse
 * @param {object}      tree            [optional]      the JS object to decorate with the registry tree
 * @returns tree or a newly-created object
 */
async function regTree(rootPath, tree) {
  var values;

  if (arguments.length !== 2)
    tree = {};

  for (let path of await getKeys(rootPath)) {
    tree[path] = {};
  }

  for (let path in tree) {
    await regTree(rootPath + '\\' + path, tree[path]);
  }

  values = await getValues(rootPath);
  for (let prop in values) {
    tree[prop] = values[prop].value;
  }

  return tree;
}

exports.getObject = async function dcpClient$$windowsRegistry$getObject(hive, keyTail) {
  var tree = {};

  keyTail = keyTail.replace(/\//g, '\\');
  key = `${hive}\\${exports.baseKey}\\${keyTail}`;

  if (await keyExists(key))
    await regTree(key, tree);
  else
    return false;
  
  return tree;
}

/** 
 * @deprecated
 * Get a DCP Config object for a certain configuration "level". Levels always exist in a
 * 'this program' and 'any program' sandwhich, provided programName is not falsey.
 *
 * @param {string}     hive             the hive to check: used to allow us to
 *                                      differentiate between user-specific and 
 *                                      machine-wide configuration entries.
 * @param {string}     programName      the name of the program doing the configuration
 *                                      lookup (ignored if falsey).
 * @param {boolean}    override         true if we are looking at the top-most level
 *                                      of configury; used, for example, by registry
 *                                      entries written by an adminsitrator as some
 *                                      kind of group policy.
 *
 * @returns {object} a DCP config object describing the overrides at this specific configuration 
 *                   "level", with no inheritance from levels either below or above this one.
 */
async function getDcpConfig(hive, programName, override) {
  var tree = {};
  var baseKey = keyJoin(hive, exports.baseKey, override ? 'override' : 'dcp-client');

  if (await keyExists(keyJoin(baseKey, programName, 'dcp-config')))
    await regTree(keyJoin(baseKey, programName, 'dcp-config'), tree);
  if (await keyExists(keyJoin(baseKey, 'dcp-config')))
    await regTree(keyJoin(baseKey, 'dcp-config'), tree);

  return tree;
}

/** Return any DCP Config values defined in the registry for the user 
 * @deprecated
 */
exports.getUserDcpConfig = async function dcpClient$$windowsRegistry$getUserDcpConfig(programName) {
  if (!programName && programName !== false)
    programName = path.basename(process.argv[1], '.js');
  return getDcpConfig(userHive, programName, false);
}

/** Return any DCP Config values defined in the registry for the machine
 * @deprecated
 */
exports.getMachDcpConfig = async function dcpClient$$windowsRegistry$getMachDcpConfig(programName) {
  if (!programName && programName !== false)
    programName = path.basename(process.argv[1], '.js');
  return getDcpConfig(machHive, programName, false);
}

/** Return any DCP Config values defined in the registry as administrative overrides 
 * @deprecated
 */
exports.getOverrideDcpConfig = async function dcpClient$$windowsRegistry$getOverrideDcpConfig() {
  if (!programName && programName !== false)
    programName = path.basename(process.argv[1], '.js');
  return getDcpConfig(machHive, programName, true)
}

/** Make all exported functions fast-path false return on non-windows */
if (require('os').platform() !== 'win32') {
  for (let exp in exports) {
    if (typeof exports[exp] === 'function') {
      exports[exp] = function() { return false };
    }
  }
}
