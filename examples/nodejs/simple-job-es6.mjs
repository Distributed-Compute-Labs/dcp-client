#! /usr/bin/env node
/**
 * @file      simple-job-es6.mjs
 *
 *            Sample NodeJS application showing how to deploy a simple DCP job using ES6 modules.
 * 
 *            *********************************** NOTE ***********************************
 *            Your keystore should be placed in your home directory in .dcp/default.keystore.
 *            When using the dcp-client API in NodeJS, this keystore will be used for communicating over DCP.
 * 
 * @author    Kevin Yu <kevin@distributive.network>
 * @date      June 2024
 */

import { init } from '../../index.js';

/**
 * Setup event listeners for jobs
 *
 * @param {object} job - the job handle object
 * @returns {void} 
 */
function addJobEventListeners(job) 
{
  // Log the job's assigned id.
  job.on('accepted', ({ id }) => console.log(`Job accepted with id ${id}`));

  // Log returned slice results
  job.on('result', (result) => console.log('Received result:', result));
}

/**
 * Main function to deploy a job
 *
 * @returns {void} 
 */
async function main() {
  const { compute } = await init();

  // Creates a Job for the distributed computer.
  // https://docs.dcp.dev/specs/compute-api.html#compute-for
  const job = compute.for(
    [1, 2, 3, 4],
    (datum) => {
      // If a progress event is not emitted within 30 seconds,
      // the scheduler will throw an ENOPROGRESS error.
      progress(1);
      return datum * 2;
    });

  // Listen for job emitted events
  addJobEventListeners(job);

  // Deploys the job 
  const results = await job.exec();
  console.log(results);
}

main();
