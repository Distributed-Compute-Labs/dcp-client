# dcp-client

Contains a built and minified version of the Compute and Protocol classes.

Compute contains the protocol, so if you need the miner you only need compute.

# Install

```
    npm install dcp-client
```

# Usage Examples:

nodejs server with protocol

```
// Creates a global instance global.protocol
require('dcp-client/dist/protocol.min.js')

const myPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

// Add your wallet key
protocol.keychain.addPrivateKey(myPrivateKey, true)

// Set some options
protocol.setOptions({
  acceptAddresses: [protocol.keychain.currentAddress],
  memoryForTimestamps: true
})
```

nodejs server with protocol and miner

```
// Creates a global instance global.protocol
// Creates a global instance global.compute
require('dcp-client/dist/compute.min.js')

const myPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

// Add your wallet key
protocol.keychain.addPrivateKey(myPrivateKey, true)

// Set some options
protocol.setOptions({
  acceptAddresses: [protocol.keychain.currentAddress],
  memoryForTimestamps: true
})

const numberOfTheads = 4

compute.mine(4)
```

browser with protocol

```
<script src='dcp-client/dist/protocol.min.js'></script>
<script>
  const myPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

  // Add your wallet key
  protocol.keychain.addPrivateKey(myPrivateKey, true)

  // Set some options
  protocol.setOptions({
    acceptAddresses: [protocol.keychain.currentAddress],
    memoryForTimestamps: true
  })
</script>
```

browser with protocol and miner

```
<script src='dcp-client/dist/compute.min.js'></script>
<script>
  const myPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001'

  // Add your wallet key
  protocol.keychain.addPrivateKey(myPrivateKey, true)

  // Set some options
  protocol.setOptions({
    acceptAddresses: [protocol.keychain.currentAddress],
    memoryForTimestamps: true
  })

  const numberOfTheads = 4

  compute.mine(4)
</script>
```
