#!/usr/bin/env node

/**
 * @file        events.js
 *              Sample node application showing how to deploy a DCP job whilst receiving
 *              events describing the current state of the job, processing results
 *              as they are received, and so on.
 *
 *              Note: Your keystore should be placed in your home directory in .dcp/default.keystore.
 *              When using the dcp-client API in NodeJS, this keystore will be used for communicating over DCP.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Aug 2019, April 2020
 */

const SCHEDULER_URL = new URL('https://scheduler.distributed.computer');

/** Main program entry point */
async function main() {
  const compute = require('dcp/compute');
  const wallet = require('dcp/wallet');
  let startTime;

  const job = compute.for(
    ['red', 'green', 'yellow', 'blue', 'brown', 'orange', 'pink'],
    (colour) => {
      progress(0);
      let sum = 0;
      for (let i = 0; i < 10000000; i += 1) {
        progress(i / 10000000);
        sum += Math.random();
      }
      return { colour, sum };
    },
  );

  job.on('accepted', () => {
    console.log(` - Job accepted by scheduler, waiting for results`);
    console.log(` - Job has id ${job.id}`);
    startTime = Date.now();
  });

  job.on('readystatechange', (arg) => {
    console.log(`new ready state: ${arg}`);
  });

  job.on('result', (ev) => {
    console.log(
      ` - Received result for slice ${ev.sliceNumber} at ${
        Math.round((Date.now() - startTime) / 100) / 10
      }s`,
    );
    console.log(` * Wow! ${ev.result.colour} is such a pretty colour!`);
  });

  job.public.name = 'events example, nodejs';

  const ks = await wallet.get(); /* usually loads ~/.dcp/default.keystore */
  job.setPaymentAccountKeystore(ks);
  const results = await job.exec(compute.marketValue);
  console.log('results=', Array.from(results));
}

/* Initialize DCP Client and run main() */
require('dcp-client')
  .init(SCHEDULER_URL, true)
  .then(main)
  .catch(console.error)
  .finally(process.exit);
