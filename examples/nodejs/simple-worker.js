#! /usr/bin/env node
/**
 * @file    simple-worker.js
 *
 *          Simple NodeJS application showing how to implement a simple DCP worker using the native evaluator.
 *          Look at https://gitlab.com/Distributed-Compute-Protocol/dcp-native/-/releases to download the evaluator 
 *          and start it using one of the dcp-evaluator-* scripts from the dcp-worker npm package.
 *           
 *          *********************************** NOTE 1 ***********************************
 *          Your keystore should be placed in your home directory in .dcp/default.keystore.
 *          When using the dcp-client API in NodeJS, this keystore will be used for communicating over DCP.
 *  
 *          *********************************** NOTE 2 ***********************************
 *          Executing Job with DCP Worker
 * 
 *          Run the following commands in your terminal:
 *          ```
 *          npm add --global dcp-worker
 *          dcp-worker --allowedOrigins http://localhost:<port number>
 *          ```
 * 
 * @author  Wes Garland  <wes@distributive.network
 * @author  Kevin Yu     <kevin@distributive.network>
 * @date    Aug 2019, April 2020, June 2024
*/

'use strict';

/**
 * Setup event listeners for jobs
 *
 * @param {object} job - the job handle object
 * @returns {void} 
 */
function addWorkerEventListeners(worker)
{
  // The start event fires after the worker is ready to fetch tasks, but
  // before the first task has been fetched.
  worker.on('start', () => {
    console.log('Worker ready to fetch tasks');
  });

  // The fetch event is fired when the worker has fetched a task from the
  // task distributor.
  worker.on('fetch', (task) => {
    if (task.slices)
      console.log(`Worker has fetched ${Object.keys(task.slices).length} slices`);
  });

  // The sandbox event is emitted when a new sandbox is created. The event
  // handler receives as its sole argument an EventEmitter which is used
  // to emit sandbox events
  worker.on('sandbox', (sandbox) => {
    // The progress event is fired to indicate progress throughout a job this is triggered by the progress() call in the work function, however, quickly-repeating calls to progress() may be composited into a single event.
    sandbox.on('progress', (event) => {
      console.log('Sandbox progress', event);
    });
  });

  // After a result is sent to the result-submitter for consideration
  worker.on('payment', (event) => {
    console.log('Work payment', event);
  });

  // Result event is fired immediately after the worker sends a result to
  // the the result data sink
  worker.on('result', (event) => {
    console.log('Worker has sent a result back to the scheduler');
  });

  // Worker has stopped working and no new results will be sent to the
  // result submitter or the result data sink and no more slices will be
  // returned to the scheduler
  worker.on('end', () => {
    console.log('Worker has stopped working');
  });

  // Log errors
  worker.on('error', console.error);
}

/**
 * Main function to deploy a job with remote work function
 *
 * @returns {void} 
 */
async function main()
{
  const wallet = require('dcp/wallet');
  const { Worker: DCPWorker } = require('dcp/worker');

  // Bank account funds will deposit into
  const paymentAddress = (await wallet.get()).address;

  // Retrieve auth keystore object
  const identity = await wallet.getId();

  // Define stand-alone worker options
  const sawOptions = {
    hostname: dcpConfig.evaluator.location.hostname,
    port: Number(dcpConfig.evaluator.location.port),
  };

  // Instantiate DCP worker
  const worker = new DCPWorker(
    identity,
    {
      cores: { cpu: 1 },
      paymentAddress,
      sandboxOptions: {
        SandboxConstructor: require('../../lib/standaloneWorker').workerFactory(sawOptions),
      },
      allowOrigins: {
        any: ['http://localhost:12345', 'http://localhost:12346'],
      },
    });

  // Listen for work emitted events
  addWorkerEventListeners(worker);


  // Start the worker
  await worker.start();
}

require('../../').init().then(main);

