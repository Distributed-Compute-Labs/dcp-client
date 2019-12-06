#! /usr/bin/env node

global.Promise = Promise = require('./promiseDebug').hook()

/**
 * @file        events.js
 *              Sample node application showing how to deploy a DCP job whilst receiving
 *              events describing the current state of the job, processing results
 *              as they are received, and so on.
 *
 * @author Wes Garland, wes@kingsds.network
 * @date   Aug 2019
 */
async function main() {
  const compute = require('dcp/compute')
  const wallet  = require('dcp/wallet')

  let job, results, startTime

  job = compute.for(["red", "green", "yellow", "blue", "brown", "orange", "pink"],
                    function(colour) {
                      console.log(colour)
                      progress()
                      return colour
                    })

  job.on('accepted',
         function(ev) {
           console.log(` - Job accepted by scheduler, waiting for results`)
           console.log(` - Job has id ${this.id}`)
           startTime = Date.now()
         })

  job.on('complete',
         function(ev) {
           console.log(`Job Finished, total runtime = ${Math.round((Date.now() - startTime) / 100)/10}s`)
         })

  job.on('readystatechange',
         function(arg) {
           console.log(`new ready state: ${arg}`)
         })
  
  job.on('result',
         function(ev) {
           console.log(` - Received result for slice ${ev.sliceNumber} at ${Math.round((Date.now() - startTime) / 100)/10}s`)
           console.log(` * Wow! ${ev.result} is such a pretty colour!`);
         })

  job.public.name = 'events example, nodejs';
  job.public.description = 'DCP-Client Example examples/node/events.js';

  let ks = await wallet.get(); /* usually loads ~/.dcp/default.keystore */
  job.setPaymentAccountKeystore(ks);
  await job.exec(compute.marketValue)
  console.log(results)
}

require('dcp-client').init().then(main).finally(() => setImmediate(process.exit))
