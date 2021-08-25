#! /usr/bin/env node

/**
 * Deploy a job using URL
 * There are two ways to stringify input data before sending on the wire
 * - JSON: It is a default method
 * - KVIN: if kvin.serialize(inputData)is being used we need to define the Content-Type `res.header("Content-Type", "application/x-kvin")`
 *     
 */
const SCHEDULER_URL = new URL('https://scheduler.distributed.computer');
const kvin = require('kvin');
const express = require('express');
 
 /** Main program entry point */
async function main() {
  const compute = require('dcp/compute');
  
  const slice1 = express();
  const port1 = 12345;
  slice1.get('/', (req, res) => {
    let a = {x:1, y:2}
    res.send(a)
  })
  slice1.listen(port1, () => {
    console.log(`port ${port1} is ready!`)
  })

  const slice2 = express();
  const port2 = 12346;
  slice2.get('/', (req, res) => {
    let a = {x:1, y:2}
    res.header("Content-Type", "application/x-kvin");
    res.send(kvin.serialize(a));
  })
  slice2.listen(port2, () => {
    console.log(`port ${port2} is ready!`)
  })

  let dcp_urls = [new URL('http://localhost:12345/') , new URL('http://localhost:12346/') ];
  
  let workerFunction = `async function(c){
    let sum = 0;
    for (let i = 0; i < 10000000; i += 1) {
      progress(i / 10000000);
      sum += Math.random();
    }
    return c;
  }`

  const job = compute.for(
    dcp_urls,
    workerFunction,
  );

  job.on('console', (ev) => {
    console.log(ev)
  })

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

  job.public.name = 'URL-data-example';

  const results = await job.exec(0.0000001);
  console.log('results=', Array.from(results));
 }
 
 /* Initialize DCP Client and run main() */
require('../..')
  .init(SCHEDULER_URL)
  .then(main)
  .catch(console.error)
  .finally(process.exit);
  