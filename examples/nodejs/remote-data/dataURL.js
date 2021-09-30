#! /usr/bin/env node
/**
 * @file   dataURL.js - An example on deploying a job using URL for input data
 * 
 * @author Nazila Akhavan <nazila@kingsds.network>
 * @date   Sep. 2021
 * 
 * 
 * There are two ways to stringify input data before sending on the wire
 * - JSON: It is a default method
 * - KVIN: if kvin.serialize(inputData)is being used we need to define the Content-Type `res.header("Content-Type", "application/x-kvin")`
 * 
 * Note that to allow workers fetch data from URLs, 
 *  - in the node worker: add `-a 'http://localhost:12345' 'http://localhost:12346'` at the end of starting worker command.
 * 
 *  - in the localExec: 
 *    ```dcpConfig = require('dcp/dcp-config');
 *       dcpConfig.worker.allowOrigins.any.push(['http://localhost:12345' 'http://localhost:12346']);
 *    ```
 *  - in the browser worker: in the console run `dcpConfig.worker.allowOrigins.any.push('http://localhost:12345', 'http://localhost:12346')` also,
 *    you need to add following lines in the response function in slice.get
 *    ```res.header("Access-Control-Allow-Headers", "content-type");
 *       res.header("Access-Control-Allow-Origin", "*");
 *    ``` 
 */

const SCHEDULER_URL = new URL('https://scheduler.distributed.computer');
const kvin = require('kvin');
const express = require('express');
 
 /** Main program entry point */
async function main() {
  const compute = require('dcp/compute');
  
  /* example of using the default */
  const slice1 = express();
  const port1 = 12345;
  slice1.get('/', (req, res) => {
    let a = {x:1, y:2};
    res.send(a);
  })
  slice1.listen(port1, () => {
    console.log(`port ${port1} is ready!`)
  })

  /* example of using the kvin */
  const slice2 = express();
  const port2 = 12346;
  slice2.get('/', (req, res) => {
    let a = {x:1, y:2};
    res.header("Content-Type", "application/x-kvin");
    res.send(kvin.serialize(a));
  })
  slice2.listen(port2, () => {
    console.log(`port ${port2} is ready!`);
  })

  let dcp_inputDataArray_urls = [new URL(`http://localhost:${port1}/`) , new URL(`http://localhost:${port2}/`) ];
  
  let workerFunction = `async function(c){
    let sum = 0;
    for (let i = 0; i < 10000000; i += 1) {
      progress(i / 10000000);
      sum += Math.random();
    }
    return c;
  }`

  const job = compute.for(
    dcp_inputDataArray_urls,
    workerFunction,
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

  job.public.name = 'URL-data-example';

  const results = await job.exec(compute.marketValue);
  console.log('results=', Array.from(results));
 }
 
 /* Initialize DCP Client and run main() */
require('../../..')
  .init(SCHEDULER_URL)
  .then(main)
  .catch(console.error)
  .finally(process.exit);
  