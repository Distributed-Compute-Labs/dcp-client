#! /usr/bin/env node

global.Promise = Promise = require("./promiseDebug").hook()

async function main() {
debugger
  const protocol = require('dcp/protocol')
  const compute = require('dcp/compute')
  const numberOfThreads = 4

  compute.work(numberOfThreads)
}

require('dcp-client').init().then(main).finally(() => setImmediate(process.exit))

