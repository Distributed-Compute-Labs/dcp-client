#! /usr/bin/env node
/**
 * @file      attempt-to-fetch.js
 *
 *            Attempt to fetch using nodejs' global fetch. This
 *            should have been blocked after access-lists was
 *            applied.
 *
 *            This test must be called from a bash test so Peter is
 *            able to run it properly despite changes to globalThis.
 *
 * @author    Will Pringle <will@distributive.network>
 * @date      December 2023
 */
const sandboxScripts = '../../libexec/sandbox/';

const files = [
  require.resolve(sandboxScripts + 'script-load-wrapper.js'),
  require.resolve(sandboxScripts + 'access-lists.js'),
];

require('./globalPolyfillHelper').init(files, ()=>{});
emitEvent('message', {request: 'applyRequirements', requirements: {environment: {}}});

setTimeout(() => {
  // let's attempt to use nodejs' fetch to make a request to example.com
  fetch('https://example.com').then(console.log);
})

