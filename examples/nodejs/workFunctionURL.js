#! /usr/bin/env node

/**
 * Deploy a job using URL for the work function
 * work function should be defined and sent on the wire as a string.
 */
const SCHEDULER_URL = new URL('https://scheduler.distributed.computer');
const express = require('express');
 
 /** Main program entry point */
async function main() {
  const compute = require('dcp/compute');
  
  const app = express();
  const port = 12347;
  app.get('/', (req, res) => {
    let workerFunction = `async function(c){
      let sum = 0;
      for (let i = 0; i < 10000000; i += 1) {
        progress(i / 10000000);
        sum += Math.random();
      }
      return c;
    }`
    res.send(workerFunction);
  })
  app.listen(port, () => {
    console.log(`port ${port} is ready!`);
  })

  let dcp_workFunction_url = new URL(`http://localhost:${port}/`)  

  const job = compute.for(
    ['hello','world'],
    dcp_workFunction_url,
  );

  job.on('accepted', () => {
    console.log(` - Job accepted by scheduler, waiting for results`);
    console.log(` - Job has id ${job.id}`);
  });

  job.on('readystatechange', (arg) => {
    console.log(`new ready state: ${arg}`);
  });

  job.on('result', (ev) => {
    console.log(ev);
  });

  job.public.name = 'URL-workFunction-example';

  const results = await job.exec(0.0000001);
  console.log('results=', Array.from(results));
 }
 
 /* Initialize DCP Client and run main() */
require('../..')
  .init(SCHEDULER_URL)
  .then(main)
  .catch(console.error)
  .finally(process.exit);
  