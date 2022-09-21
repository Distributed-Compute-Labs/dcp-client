// How to deploy a job using TypeScript.

import { init } from 'dcp-client';

const { compute } = await init();

const inputSet = [1, 2, 3, 4];

const workFunction = (input) => {
  // Send a mandatory progress update to the scheduler.
  progress();
  return input ** 2;
};

const job = compute.for(inputSet, workFunction);

job.public.name = 'TypeScript example';

job.on('accepted', () => {
  console.log('Job accepted with id:', job.id);
});

job.on('result', ({ result }) => {
  console.log('Received a result:', result);
});

const results = await job.exec();

console.log(results);
