#! /usr/bin/env node
/**
 * @file      simple-job-remote-function.js
 *
 *            Simple NodeJS application showing how to implement a simple remote work-function.
 *           
 *            *********************************** NOTE 1 ***********************************
 *            Your keystore should be placed in your home directory in .dcp/default.keystore.
 *            When using the dcp-client API in NodeJS, this keystore will be used for communicating over DCP.
 *            
 *            *********************************** NOTE 2 ***********************************
 *            Executing Job with DCP Worker
 * 
 *            - Run the following commands in your terminal:
 *            ```
 *               npm add --global dcp-worker
 *               dcp-worker --allowedOrigins http://localhost:<port number>
 *            ```
 *
 * @auth Kevin Yu <kevin@distributive.network>
 * @date June 2024
 */

const http = require('http');
const port = 1234;

/**
 * Setup server to serve a work function at api-endpoint
 * 
 * @returns {void} 
 */
function startBackendServer()
{
  const server = http.createServer((req, res) => {
    // Set appropriate headers to allow cross-origin requests
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/')
    {
      // Define work function as string
      const workerFunction = `
      (datum) => {
        // If a progress event is not emitted within 30 seconds, 
        // the scheduler will throw an ENOPROGRESS error.
        progress(1);
        return datum * 2;
      }`;
    
      res.setHeader('Content-Type', 'application/javascript');
      res.end(workerFunction);
    }
    else
    {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    console.log(`Work Function available at http://localhost:${port}/`);
  });
}

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
 * Main function to deploy a job with remote work function
 *
 * @returns {void} 
 */
async function main()
{
  const compute = require('dcp/compute');
  
  // Start up server to host work function
  startBackendServer();

  // URL where the work function is located
  const remoteWorkFunction = new URL(`http://localhost:${port}/`);

  // Creates a Job for the distributed computer. 
  // https://docs.dcp.dev/specs/compute-api.html#compute-for
  const job = compute.for(
    [1, 2, 3, 4],
    remoteWorkFunction,
  );

  // Listen for job emitted events
  addJobEventListeners(job);

  // Deploy job
  const results = await job.exec(compute.marketRate);
  console.log('Job completed, here are the results: ', Array.from(results));
}

require('../../..').init().then(main);
