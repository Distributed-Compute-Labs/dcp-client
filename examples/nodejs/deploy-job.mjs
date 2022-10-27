// How to deploy a job using ES6 modules.

import { init } from '../../index.js';

const { compute } = await init();

const inputSet = [1, 2, 3, 4];

const workFunction = (input) => {
  progress();
  return input;
};

const job = compute.for(inputSet, workFunction);

job.public.name = 'ESM example';

job.on('accepted', ({ job: { id } }) => {
  console.log('Job accepted with id', id);
});

job.on('result', ({ result }) => {
  console.log('Received a result:', result);
});

const results = await job.exec();

console.log(results);
