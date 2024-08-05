#! /usr/bin/env node
/**
 * @file   simple-job-remote-input.js 
 *          
 *         Sample NodeJS application showing how to deploy a simple DCP job with remote input data 
 *         that is serialized with either json or kvin (https://github.com/wesgarland/kvin).
 *
 *         *********************************** NOTE 1 ***********************************
 *         Your keystore should be placed in your home directory in .dcp/default.keystore.
 *         When using the dcp-client API in NodeJS, this keystore will be used for communicating over DCP.
 * 
 *         *********************************** NOTE 2 ***********************************
 *         Executing Job with DCP Worker
 * 
 *         - Run the following commands in your terminal:
 *         ```
 *            npm add --global dcp-worker
 *            dcp-worker --allowedOrigins http://localhost:<port number>
 *         ```
 * 
 * @authors
 *   - Nazila Akhavan <nazila@kingsds.network>
 *   - Kevin Yu <kevin@distributive.network>
 * @date   June 2024
 */

// Serialization library for JavaScript types for transmission over a network
const kvin = require('kvin');
const http = require('http');
const portA = 1234;
const portB = 2345;

/**
 * Setup server to serve JSON serialized input data at api-endpoint
 * 
 * @returns {void} 
 */
function startBackendServerA() {
  const serverA = http.createServer((req, res) => {
    // Set appropriate headers so workers on web can fetch data
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    const data = { value: 'foo' };
    res.end(JSON.stringify(data));
  });
  
  serverA.listen(portA, () => {
    console.log(`Remote data available at http://localhost:${portA}/`);
  });
}

/**
 * Setup server to serve KVIN serialized input data at api-endpoint
 * 
 * @returns {void} 
 */
function startBackendServerB() {
  const serverB = http.createServer((req, res) => {
    // Set appropriate headers so workers on web can fetch data
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/x-kvin');

    const data = { value: 'bar' };
    res.end(kvin.serialize(data));
  });

  serverB.listen(portB, () => {
    console.log(`Remote data available at http://localhost:${portB}/`);
  });
}

/**
 * Setup event listeners for jobs
 *
 * @param {object} job - the job handle object
 * @returns {void} 
 */
function addJobEventListeners(job) {
  // Log the job's assigned id.
  job.on('accepted', ({ id }) => console.log(`Job accepted with id ${id}`));

  // Log returned slice results
  job.on('result', (result) => console.log('Received result:', result));
}

/**
 * Main function to deploy a job with remote work function
 *
 * @returns {void} 
 */
async function main()
{
  const compute = require('dcp/compute');

  // Start up server to host slice data  
  startBackendServerA();
  startBackendServerB();

  // Fetched remote input data
  const remoteData = [new URL(`http://localhost:${portA}/`), new URL(`http://localhost:${portB}/`)];

  // Creates a Job for the distributed computer. 
  // https://docs.dcp.dev/specs/compute-api.html#compute-for
  const job = compute.for(
    remoteData,
    (datum) => {
      // If a progress event is not emitted within 30 seconds, 
      // the scheduler will throw an ENOPROGRESS error.
      progress(1);
      return datum.value.toUpperCase();
    },
  );

  // Listen for job emitted events
  addJobEventListeners(job);

  // Deploy job
  const results = await job.exec(compute.marketValue);
  console.log('Job completed, here are the results: ', Array.from(results));
}

require('../../..').init().then(main);
