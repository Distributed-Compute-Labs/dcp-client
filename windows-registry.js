/**
 * @file        windows-registry.js
 *		Windows registry configuration/integration utility for DCP.
 *              Basic idea: summarize registry into an objects which can be used as the
 *              initializer object for DCP Client and wallet cache. Multiple hives are read
 *              to support higher-priviledged overrides for Administrators writing Group
 *              Policy files in Enterprise installs.
 *
 * @note        In registry-speak, keys are like directories and values are like files -- i.e. a key can 
 *              contain keys and/or values, but values cannot contain keys; only strings and numbers and stuff.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Jul 2020
 */

const privHive = 'HKLM';
const userHive = 'HKCU';
const baseKey = '\\Software\\Kings Distributed Systems\\';
const regedit = require('regedit');

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

let dcpClientConfig = {};

//addConfig(dcpClientConfig, 'dcp-client');
(async function() {
  var userTree, privTree;

  if (await keyExists(privHive + baseKey + 'dcp-client'))
    privTree = await regTree(privHive + baseKey + 'dcp-client');

  if (await keyExists(userHive + baseKey + 'dcp-client'))
    userTree = await regTree(userHive + baseKey + 'dcp-client');

  console.log(userTree, privTree);
})().then(process.exit);

