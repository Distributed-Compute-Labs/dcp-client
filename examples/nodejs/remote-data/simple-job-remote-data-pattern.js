/**
 * @file   simple-job-remote-data-pattern.js
 *
 *         Simple NodeJS application showing how to use RemoteDataPattern class that works for slices which their uri's has similar patterns
 *         For more information please refer to:
 *         https://gitlab.com/Distributed-Compute-Protocol/dcp-docs-wes/-/blob/wip/scheduler/remote-storage.md#data-movement
 * 
 *         *********************************** NOTE 1 ***********************************
 *         Your keystore should be placed in your home directory in .dcp/default.keystore.
 *         When using the dcp-client API in NodeJS, this keystore will be used for communicating over DCP.
 * 
 *         *********************************** NOTE 2 ***********************************
 *         Executing Job with DCP Worker
 * 
 *         - Run the following commands in your terminal:
 *           ```
 *              npm add --global dcp-worker
 *              dcp-worker --allowedOrigins http://localhost:<port number>
 *           ```
 *            
 * @authors
 *   - Nazila Akhavan <nazila@kingsds.network>
 *   - Kevin Yu <kevin@distributive.network>
 * @date   Sep. 2021, June 2024
 */

const http = require('http');
const port = 1234;

/**
 * Setup server to serve JSON serialized input data at api-endpoint
 * 
 * @returns {void} 
 */
function startBackendServer()
{
  const server = http.createServer((req, res) => {
    // Set appropriate headers so workers on web can fetch data
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/slice-1.json')
    {
      res.setHeader('Content-Type', 'application/json');
      const data = { value: 'foo' };
      res.end(JSON.stringify(data));
    }
    else if (req.url === '/slice-2.json')
    {
      res.setHeader('Content-Type', 'application/json');
      const data = { value: 'bar' };
      res.end(JSON.stringify(data));
    }
    else
    {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    console.log(`Remote data available at http://localhost:${port}/`);
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
async function main() {
  const compute = require('dcp/compute');
  
  // Start up server to host slice data  
  startBackendServer();
  
  // Prevents repeating URI’s that have the similar pattern and allow passing the pattern and the number of slices.
  // https://docs.dcp.dev/advanced/data-uri.html
  const { RemoteDataPattern } = require('dcp/compute');

  // URL where the work function is located
  const remoteData = new RemoteDataPattern(`http://localhost:${port}/slice-{slice}.json`, 2);

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
 
require('../../..').init().then(main).catch(console.error).finally(process.exit);
