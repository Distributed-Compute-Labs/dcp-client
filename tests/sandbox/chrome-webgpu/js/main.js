"use strict";

const stupidAssert = (expr) => {
  if (!expr) {
    throw new Error(`Assertion failed: ${expr}`);
  }
}


const webGPUWork = async () => {
  // request our adapter
  const adapter = await navigator.gpu.requestAdapter();
  stupidAssert(adapter !== null);

  // request our device
  const device = await adapter.requestDevice();
  stupidAssert(device !== null);

  return "at least I can access the GPU devices";
}

const computeWork = async () => {
  const { compute } = dcp;

  // I want an unit type in JS
  const job = compute.for([""], webGPUWork);


  job.on('accepted',
    // `this`, yuck
    function (ev) {
      console.log(`job ${this.id} accepted by scheduler`);
    });

  job.on('complete', (ev) => {
    console.log('job finished running', ev);
  });

  job.on('readystatechange', function (arg) {
    // `this`, yuck
    if (this.id)
      console.log(`job ${this.id} entered ready state ${arg}; is currently in ready state ${this.readyState}`);
    else
      console.log(`new job entered ready state ${arg}; is currently in ready state ${this.readyState}`);
  });

  job.on('result', (ev) => {
    console.log('received result', ev);
  });

  job.public = {
    name: 'events example, vanilla-web',
    description: 'dcp-client sample code examples/vanilla-web/events.html',
    link: 'https://www.npmjs.com/package/dcp-client'
  };

  await job.exec(compute.marketValue);
}

const dcpWorker = async () => {
  const {
    wallet,
    worker: { Worker: DCPWorker },
  } = window.dcp;

  const paymentAddress = (await wallet.get()).address;

  const defaultMaxSliceCount = 1;
  // What identity the worker will use to communicate to the scheduler.
  const identity = await new wallet.Keystore(null, "");
  console.debug('identity', identity);

  const worker = new DCPWorker(
    identity,
    {
      defaultMaxSliceCount,
      paymentAddress,
    });

  // Attaching event listeners to see what's going on.
  worker.on('start', () => {
    console.log('Worker started working!');
  });

  worker.on('sandbox', (sandbox) => {
    sandbox.on('ready', (event) => {
      console.log('sandbox ready', event);
    });

    sandbox.on('start', ({ sandbox, job }) => {
      const { name = '', description = '', link = '' } = job;
      console.log(
        `Sandbox ${sandbox.id} started slice for job with`,
        `Name: "${name}",`,
        `Description: "${description}", and`,
        `Link: "${link}"`,
      );
    });

    sandbox.on('sliceProgress', (event) => {
      console.log(`Sandbox ${sandbox.id} progress`, event);
    });

    const sandboxEmit = sandbox.emit.bind(sandbox);
  });

  worker.on('payment', ({ accepted, payment }) => {
    if (accepted) {
      console.log(`You earned ${payment} DCC!`);
    } else {
      console.log('the result you computed was not accepted.');
    }
  });

  // Starting the worker.
  await worker.start();
}
// start our work once DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  Promise.all([dcpWorker(), computeWork()]);
});
