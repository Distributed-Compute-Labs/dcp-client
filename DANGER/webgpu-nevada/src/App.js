import { useEffect } from 'react';
import './App.css';

import useDCPWorker from "use-dcp-worker";

function App() {


  const stupidWebGPU = async () => {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    return Boolean(device) && Boolean(adapter);
  }

  const work = async () => {
    const dcp = window.dcp;
    const compute = dcp.compute;

    const job = compute.for([""], stupidWebGPU);

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
      name: 'I hate JS',
      description: 'I WANT TYPES',
      link: 'this-deosnt-exist',
    };

    const stuff = await job.exec(compute.marketValue);
    console.log('stuff', stuff);
  };


  useEffect(() => {
    work();
  }, []);
  return (
    <div className="App">
      <p>stupid</p>
    </div>
  );
}

export default App;
