# DCP-Client

This is the official client library for DCP, the Distributed Compute Protocol.  This library allows client applications to communicate with the Scheduler, Bank, and other parts of a DCP network. This library is redistributable and may be included with other programs under the terms of the MIT license.

## Release Notes

### Implementation Status
DCP is currently (May 2021) in testing for a limited set of developers under our Early Developer Preview program.  If you would like to be part of our *First Dev* cohort, visit https://dcp.dev/ and sign up! We expect the network to be ready for at-scale, arbitrary workload in June 2021.

**Note:** This document discusses [BravoJS](https://github.com/wesgarland/bravojs), however, BravoJS support is not ready at this time. It will be finished during the Early Developer Preview, in time for our general public release; the documentation is geared toward that release.

### Supported Platforms
The DCP-Client code can be made to run in nearly any JavaScript environment which supports ES5 and XMLHttpRequest.  Our officially-supported platforms are
- Node.js version 12 (LTS)
- BravoJS, latest version
- Vanilla Web - no module system at all

### Related Products
Other utilities for developers working with DCP can be retrieved via npm, and include:

* [`dcp-util`](https://npmjs.com/package/dcp-util) - a series of utilities for working with DCP; manipulate keystores, cancel jobs, etc.
* [`niim`](https://www.npmjs.com/package/niim) - a command-line debugger for Node.js (fork of node-inspect) which can debug DCP programs (passphrase prompts cause problems with node-inspect mainline)
* [`bravojs`](https://www.npmjs.com/package/bravojs) - a module system, used internally by DCP, capable of running the same modules in the browser, Node.js, or a DCP Worker without transpilation, server software, or CORS headaches.

## Installation
The source code for this library is hosted online at https://github.com/Distributed-Compute-Labs/dcp-client, and the installation package is available via NPM at https://www.npmjs.com/package/dcp-client.

### Node.js
To use DCP from Node.js, you need to `npm i dcp-client` from your project's source directory, which will update your `package.json`, making this library a dependency of your application.

If you are a Node developer looking to get started quickly, there is a sample project template on GitHub that might interest you at https://github.com/wesgarland/dcp-client.

### Vanilla-Web
To use the DCP Client library from a plain vanilla web platform, you must make the contents of the npm package visible to your web application, or use our CDN. Distributed Compute Labs hosts the latest version of the library at https://cdn.distributed.computer/dcp-client/dcp-client.js.

If you are a web developer looking to get started quickly, there are is a sample project on JS Fiddle that might interest you at https://jsfiddle.net/KingsDistributedSystems/58e6up4b/

#### Self-Hosted Bundle
To host the bundle on your own server, simply acquire the dcp-client package and copy the files `dcp-client.js` and `dcp-client.css` into a directory on your web server that your web clients can access. We recommend using the `dcp/` directory under your document root.

### BravoJS (EDP: not implemented)
To use the DCP Client library with BravoJS, you must make the bundle and the loader visible to your web application.

## DCP-Client API
While methods of initializing dcp-client vary somewhat from platform to platform or framework to framework (see below), after initializing, you will have a way to access the key exports of the dcp-client library:
1. `compute` - Compute API; `compute.run`, `compute.for`, etc.
2. `wallet` - Wallet API; used to manipulate data types related to cryptographic authorization, authentication, and access control
3. `worker` - Worker API; used for creating embedded Workers on the web or in Node.js
4. `dcp-config` - a configuration object which can override various core options, such as the location of a local HTTP proxy; the initial default is downloaded from `protocol://location.of.scheduler/etc/dcp-config`
5. A global symbol, XMLHttpRequest, which understands HTTP, HTTPS, and HTTP-KeepAlive.  This is the native implementation on the browser platforms and polyfilled in Node.js via the `dcp-xhr` module. The polyfill includes deep network-layer debugging hooks.

### init() and initSync() - CommonJS
From your Node.js application (or any other using the CommonJS `require` function), you can invoke `require('dcp-client').init()` which initializes the dcp-client library. This function returns a promise that, once resolved, signals that the DCP modules have been injected into the Node.js module memo (more about DCP modules below). Alternatively, you may call `initSync` with the same arguments and behavior as `init` except that the initialization is performed synchronously.

The `init` function takes zero or more arguments, allowing the developer to create an object which overrides the various DCP defaults; in particular, the location of the scheduler and the name of the code bundle which is executed to provide the APIs.   This object has the same "shape" as the `dcpConfig` export from the library, and this is no coincidence: *any* parameter specified in the configuration will override the same-pathed property provided by the scheduler's configuration object that lives at `etc/dcp-config.js` relative to the scheduler's location.

#### Plain Object
A plain configuration object with the following properties is compatible with the DCP config.js library.
|property path|meaning|default|
|:--|:--|:--|
|scheduler.location|instance of URL which describes the location of your scheduler.|https://scheduler.distributed.computer/|
|autoUpdate|`true` to download the latest version of the webpack bundle and use (eval) that code to implement<br>the protocol which accesses the scheduler, bank, etc. Otherwise, the bundle which shipped with the dcp-client npm package is used.|`false`|
|bundle.location|an instance of URL or a filename that describes the location of the code bundle, overriding whatever the default location.

#### String
If you pass a string to `init`, it will be treated as a filename; the contents of this file will be evaluated and the result will be used as the configuration object.

**Note:** filenames in this API are resolved relative to the calling module's location; all files are assumed to contain UTF-8 text.

#### Object which is an instance of URL
If the first argument object is an instance of URL, the URL will be treated as the location of the scheduler, the second parameter will be treated as the value of `autoUpdate`, and the third parameter will be treated as the value of `bundle.location`.

#### Local Defaults
In addition to application-specified options, users of Node.js applications may add a local configuration file to override any baked-in defaults.  This file is located in `~/.dcp/dcp-client/dcp-config.js`, and should contain a JavaScript object literal in the UTF-8 character set.

### Abbreviated Examples
```javascript
/* Use the default scheduler */
await require('dcp-client').init();
let compute = require('dcp/compute');

/* Preferences are stored in my-dcp-config.js */
await require('dcp-client').init('my-dcp-config.js');
let compute = require('dcp/compute');

/* Use an alternate scheduler string */
await require('dcp-client').init('https://scheduler.distributed.computer');
let compute = require('dcp/compute');

/* Use an alternate scheduler URL that is supported on node version 10 and above */
await require('dcp-client').init(new URL('https://scheduler.distributed.computer'));
let compute = require('dcp/compute');

/* Use an alternate scheduler using dcp-config fragment. a dcp-config is an object which can have
 * scheduler.location, bundle.location, and bundle.autoUpdate. */
await require('dcp-client').init({
  scheduler: { location: new URL('https://scheduler.distributed.computer') },
}
let compute = require('dcp/compute');
```

### Additional Functionality
In addition to exporting the key APIs, when running dcp-client from Node.js, the following modules are automatically injected into the Node.js module memo, so that they can be used in `require()` statements:

Module         | Description
:------------- | :----------------
dcp/compute    | The Compute API
dcp/dcp-build  | Object containing version information, etc. of the running bundle
dcp/cli        | Provides a standard set of DCP CLI options and related utility functions via yargs
dcp/dcp-events | Provides classes related to cross-platform event emitting
dcp/dcp-config | The running configuration object (result of merging various options to `init()`)
dcp/wallet     | The Wallet API
dcp/worker     | The Worker API

## Working with DCP-Client

### General Use

**Node** - After calling `init` (see examples below), modules can be `require`d using the module name that follows the initial `dcp/`.

```javascript
await require('dcp-client').init();
const { EventEmitter } = require('dcp/dcp-events');
```

**Web** - After the `dcp-client` script tag is loaded (see examples below), modules are available as properties of a global `dcp` symbol.

```javascript
const { EventEmitter } = dcp['dcp-events'];
```

### examples/bravojs
The examples in this directory show how to use DCP from a web page using the BravoJS module system and no special web server. The usage is virtually identical to Node.js, except that your web page must include a *main module* which is a SCRIPT tag with a `module.declare` declaration.

####  Abbreviated Examples
```html
<script src="/path/to/bravojs/bravo.js"></script>
<script src="/path/to/dcp-client/bravojs-shim.js"></script>
<script>
module.declare(["dcp-client/index"], async function(require, exports, module) {
  /* Use the default scheduler */
  await require('dcp-client').init();
  let compute = require('dcp/compute');
  compute.for(....)
})
</script>
```

### examples/vanilla-web
The example in this directory shows how to use DCP from a web page with no module system at all. Configuration is performed by loading a dcp-config file from your preferred scheduler, overriding options in the global `dcpConfig` as needed, and then loading the dcp-client.js bundle, which immediately initializes the API.  DCP libraries are exported via the global symbol `dcp` since there is no module system in this environment.

```javascript
<!-- use an alternate scheduler -->
<SCRIPT id='dcp-client' src="/path/dcp-client/dcp-client.js" scheduler="https://myscheduler.com/"></SCRIPT>
```

```javascript
const { compute } = dcp;
let job = compute.for(...);
job.on("ENOFUNDS", (fundsRequired) => {
  await job.escrow(fundsRequired);
  job.resume();
})

let results = await job.exec(compute.marketValue);
console.log(results);
```

**Note** For the first-dev release, terms like `compute.marketValue` and the value of DCC are not tied to anything. It's a placeholder for testing/experimental purposes. The MVP release will include an implementation of the costing and metering algorithms fundamental to tying DCC balance to actual work done.

## Executing Jobs

At its core, a job can be thought of as an input set, a Work function; executing a job yields an output set.

Jobs (job handles) are generally created with the `compute.for` function, which is described in detail in the Compute API documentation. To execute the job, we invoke the `exec()` method of the job handle.

An input set can be described with arguments to `compute.for()` with `RangeObject` notation or passed directly as an enumerable object (such as an array or function* generator).

### Examples
run Work on the whole numbers between 1 and 10:
```javascript
job = compute.for(1, 10, Work)
```
run Work on the numbers 6, 9, 12, 15:
```javascript
job = compute.for(6, 16, 3, Work)
```

run Work on the colors red, green, and blue:
```javascript
job = compute.for(["red", "green" "blue"], Work)
```

### Limitations to Consider
The Work function must be either a string or stringifyable via `toString()`.  This means that native functions (i.e. Node functions written in C++) cannot be used for Work.   Additionally, the function must be completely defined and not a closure, since stringification cannot take the closure environment into account. A rule of thumb is that if you cannot `eval()` it, you cannot distribute it.

## Troubleshooting 
### Deployment Events
Deploying a job involves several steps, each of which can take several seconds.  The easiest way to track these is to trap the `readyStateChange` event from your client application. ```javascript job.on('readystatechange', (newState) => console.log(newState)); ``` A typical job deployment goes through the following states: 
* exec 
* deploying 
* authorizeHold 
* authorizeFeeStructure 
* deployed 

### Result Events Results flow into the job's result set one at a time, as they are completely, throughout the work cycle.  Eventually, `job.exec()` resolves with an Array-like object, the result set, but you can see the results piecemeal by registering for the `result` event: 
```javascript
job.on("result", ev => console.log(ev));
``` 
### Using console.log from Work Functions
Every JavaScript programming environment features an implementation of `console.log`, and DCP is no different.  When your work function invokes `console.log()`, the log message is stringified and sent over the network to the scheduler, which relays it to your DCP client application.    To capture these events in your client program, simply ```javascript job.on('console', (message) => console.log(message)); ``` ## Uncaught exceptions in Work Functions If your work function throws an uncaught exception, its details will be relayed back to your client application as an event.  Note that your job will be cancelled by the scheduler if it does this too many times!  To capture events in your client program, simply ```javascript job.on('error', (message) => console.log(message)); ``` 

### ENOPROGRESS
This exception is thrown when your Work Function has not called the `progress()` function within 30 seconds, or you have not called `progress()` at all during the work function.  Remember that some Worker computers can be much slower than yours!

*Every Work Function must invoke `progress()` at least once.*

The ideal way to invoke `progress()` is to place it somewhere in your inner loop where you can reasonably expect it to be invoked every 3 
or 4 seconds.  If your program goes crazy and invokes it too many times, DCP will automatically throttle these calls to help your workload run faster. 
Don't be tempted to use `setInterval()` or `setTimeout()` to invoke `progress()` -- it probably won't behave the way you think it will, unless you are 
very familiar the inner workings of the JavaScript event loop.

## Debugging
The DCP Compute API includes a function called `localExec` which  can be used in place of the `exec` method on the JobHandle.  When this function is invoked, a DCP client will create a worker which receives your job from the scheduler, and this job will be limited to that worker. In the browser, this is implemented inside a Web Worker; in NodeJS this is implemented with a standalone worker running within the client process. In either case, it should be possible to use the `debugger` keyword in your work function to trigger a breakpoint in your favourite debugger. 

*Note:* using localExec on Node.js requires that you install `dcp-client`'s peer dependency, `dcp-worker`.

### niim
The [`niim`](https://www.npmjs.com/package/niim) debugger is a command-line debugger for Node.js which is a fork of node-inspect. If you are debugging a dcp-client with niim and it asks you for a passphrase, use the send function:
```send "passpharse\n"```

## Exposed APIs
The DCP Client bundle comes with a number of DCP APIs exposed for use in your own programs.

### Compute API
* provides a JavaScript interface to software developers, allowing them to describe data sets and work functions for transmission to the Scheduler. See https://docs.dcp.dev/specs/compute-api.

### Wallet API
* provides a JavaScript interface to software developers for the management of Addresses, Wallets, and Keystores. See https://docs.dcp.dev/specs/wallet-api.

### Protocol API
* provides a JavaScript interface to software developers and the Compute API which enables the transmission of data and work functions between
   - the scheduler and the worker
   - the scheduler and the bank
   - other entities as necessary
* provides a JavaScript interface to software developers and other software components for the cryptographic operations needed by the protocol  See https://docs.dcp.dev/specs/wallet-api.

## Keys and Keystores
Every application which uses DCP must have an identity to communicate on the network, and to identify itself to the scheduler. An identity keystore, generally named `id.keystore`, can be downloaded from the DCP Portal at https://portal.distributed.computer/, under the "Your Keys to DCP". This key can be revoked at any time, and is safe to share without an encrypted passphrase.

Each end-user who is deploying work on the Distributed Computer must have a bank account on the portal in order to pay for their work. A bank account keystore, generally named `default.keystore`, can be downloaded from the Accounts tab. This keystore should be created with a password; this keystore grants "withdraw" access to said bank account, and it cannot be revoked!  Should you lose control of a bank keystore, you should immediately transfer the funds into a different bank account and delete the account.

To use keystores with Node.js, place in them the `.dcp` directory under your home directory.  If you are writing a browser application, place `id.keystore` in the same directory as your web application.  Users will be automatically prompted via a modal dialog box to supply their bank account credentials when necessary. It is also possible to provide keystores via other means, such as the Windows Register, `/etc` files on UNIX platforms, etc. 

*Note*: We are improving this workflow so that end-users can eventually be unaware of the existence of keystores, however the flow in this section will be preserved for backward compatibility. Future versions of DCP will also allow application developers or owners to pay for work instead of their users.

## Exposed Third-Party modules
Versions of the following modules are used by dcp-client and are automatically available to Node.js programs after the dcp-client bundle has been initialized:
 - ethereumjs-util
 - ethereumjs-wallet
 - ethereumjs-tx
 - bignumber.js
 - socket.io-client

## Glossary

<!-- TITLE: Glossary -->
<!-- SUBTITLE: Official definitions of DCP-related terminology -->

### Entities

#### Scheduler
A server which
* receives work functions and data sets from Compute API
* slices data into smaller sets
* transmits work and data points to Worker
* determines cost of work and instructs the Bank to distribute funds between entities accordingly
* ensures that all tasks eventually complete, provided appropriate financial and computation resources can be deployed in furtherance of this goal

#### Bank
A server which
* manages a ledger for DCC which are not on the blockchain
* enables the movement of DCC between entities requesting work and entities performing work
* enables the movement of DCC between the ledger and the blockchain
* enables the placement of DCC in escrow on behalf of the Scheduler for work which is anticipated to be done

#### Portal
A user-facing web application which allows or enables
* creation and management of user accounts
* management of bank accounts (ledgers)
* transfer of DCC between bank accounts
* transfer of DCC to and from the blockchain
* execution of the browser-based Worker

#### Worker
A JavaScript program which includes a Supervisor and one or more Sandboxes
* performs computations
* retrieves work and data points from Scheduler
* retrieves work dependencies from Package Server
* returns results and cost metrics to Scheduler
* Specific instances of Worker include
  - a browser-based Worker
  - a standalone Worker operating on Google's v8 engine

#### Sandbox
A component of a Worker used to execute arbitrary JavaScript code in a secure environment.  Currently implemented by the DistributedWorker class (whose name will change someday).  Generally speaking, we use one Sandbox per CPU core, although we might use more in order to work around system scheduler deficiencies, network overhead, etc.   Sandboxes in the web browser are implemented using `window.Worker()`.

#### Supervisor
The component of a Worker which communicates with the Scheduler and Sandboxen.

### Concepts
#### Job
The collection consisting of an input set, Work Function, and result setup.  Referred to in early versions of the Compute API (incorrectly) as a Generator.

#### Slice
A unit of work, represented as source code plus data and metadata, which has a single entry point and return type.  Each Slice in a Job corresponds to exactly one element in the Job's input set.

#### Task
A unit of work which is composed of one or more slices, which can be executed by a single worker.  Each Slice of each Task will be from the same Job.

#### Work or Work Function
A function that is executed once per Slice for a given Job, accepting the input datum and returning a result which is added to the result set.

#### Module
A unit of source code that can be used by, but addressed independently of, a Work Function. Compute API modules are similar to CommonJS modules.

#### Package
A group of related modules

#### Distributed Computer
A parallel supercomputer consisting of one or more schedulers and workers.  When used as a proper noun, the distributed computer being discussed is the one hosted at https://portal.distributed.computer/

#### Bank Account
A ledger that acts as a repository for DCC which is not on the blockchain.  The Bank can move DCC between Bank Accounts much more quickly than it can move DCC between Addresses on the Ethereum blockchain network.  Metadata attached to bank accounts can restrict certain operations, such as ear-marking funds for use only by job deployment.

#### Address
A unique identifier in DCP that can be used as a Bank Account identifier (account number) or Address on the Ethereum network.

#### Wallet
In the general (blockchain) sense, a wallet is a piece of software that allows the user to interact with the greater economy as a whole.  So as your actual wallet in your pocket has your cash and credit cards and you access your wallet in order to make a purchase and keep records (by pulling out cash or cards, and stuffing receipts back in), a blockchain wallet performs a similar function in that it gives you a place to store your private keys (your money), it provides a balance of what all those moneys add up to, it provides a way to receive moneys and send moneys, and provides a record of all those sends and receives. Most blockchain wallets provide at least 3 basic functions
1. generate and stores your public/private key pairs
2. allow you to use those key pairs through transactions (allows you to craft and transmit transactions to the peers)
3. keep a record of the transactions

Additionally, most of the current crypto wallets (such as Bitcoin core) provide blockchain validation and consensus functions in that they can act to create or validate new blocks to the chain in addition to creating or validating transactions.

##### Distributed.Computer Wallet
The Distributed.Computer acts as a Wallet; the platform exposes Wallet-related functionality both via software APIs and the portal web site.
 - Public/private key pairs are generated via the portal, wallet API, and command-line utilities
 - Public/private key pairs are stored in the database as passphrase-protected Keystores
 - Public/private key pairs stored in the Distributed.Computer Wallet can be retrieved via the portal website

#### Keystore
A data structure that stores an encrypted key pair (address + private key). Generally speaking, the keystore will be encrypted with a passphrase.

### Keystore File
A file that stores a JSON-encoded Keystore.
