/**
 * @file     autoupdate-check.js
 *           post-init details for auto update tests
 *
 * @author   Wes Garland, wes@distributive.network
 * @date     March 2023
 */
const assert = require('assert').strict;

const runningBundle   = require('dcp/build');
const bootstrapBundle = require('dcp/bootstrap-build');

console.log('  running bundle',   runningBundle.version,   runningBundle.branch);
console.log('bootstrap bundle', bootstrapBundle.version, bootstrapBundle.branch);

assert(runningBundle !== bootstrapBundle);
