#! /usr/bin/env node

async function main() {
debugger
  const protocol = require('dcp/protocol')
  const compute = require('dcp/compute')
  const myPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

  protocol.keychain.addPrivateKey(myPrivateKey, true)
/*  protocol.setOptions({
    acceptAddresses: [protocol.keychain.currentAddress],
    memoryForTimestamps: true
  })
*/
  const numberOfTheads = 4
  compute.mine(4)
}

require('dcp-client').init().then(main).finally(() => setImmediate(process.exit))

