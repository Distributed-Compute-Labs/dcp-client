/**
 *
 * @class GPUQueueRegistery
 */
class GPUQueueRegistery
{
  /**
   * @constructor
   */
  constructor()
  {
    /** @type Map<String, GPUQueue> */
    this.queues = new Map();

    /** @type Map<GPUQueue, DOMHighResTimeStamp[]> */
    this.submissionTimeQueue = new Map();
  }

  /**
   * Add a queue to the registry, returns the newly registered queue.
   * @param {GPUQueue} queue
   * @returns {GPUQueue}
   */
  add(queue)
  {
    this.queues.set(queue.label, queue);
    return queue;
  }


  /**
   * Add a submission to the registry.
   *
   * @param {GPUQueue | String} queue the Queue you wish to submit to, or the label of the queue
   * @param {GPUCommandBuffer[]} commandBuffers the command buffers you wish to submit
   * @returns {undefined}
   */
  addSubmission(queue, commandBuffers)
  {
    // we assume the queue is always already in the registry, should be enforced by changing all the
    // places where a queue can be created to use the registery
    if (typeof queue === 'string')
    {
      queue = this.find(queue);
    }

    if (!this.submissionTimeQueue.has(queue))
    {
      this.submissionTimeQueue.set(queue, []);
    }

    this.submissionTimeQueue.get(queue).push(performance.now());
    
    // submit returns undefined but just in case the user does something weird with the return value
    // we return it to it's a drop in replacement
    return queue.submit(commandBuffers);
  }


  /**
   * Get the last submission time for a queue in FIFO order. Our special GPUQueueTimingPromise can use
   * this to determine an upperbournd for when the queue has finished executing the command buffers.
   * 
   * If the queue has not been submitted to, returns undefined.
   * 
   * @param {GPUQueue | String | string} queue the Queue you wish to submit to, or the label of the queue
   * @returns {DOMHighResTimeStamp | undefined} the last submission time for the queue
  */
  getLastSubmittedTime(queue)
  {
    if (typeof queue.toString() === 'string')
    {
      queue = this.find(queue);
    }

    const submissionQueue = this.submissionTimeQueue.get(queue);
    return submissionQueue.shift();
  }

  /** 
   * Get a queue from the registry by label. If a queue with the given label is not
   * found, returns undefined.
   *
   * @function find
   * @param {String} label
   * @returns {GPUQueue}
   */
  find(label)
  {
    return this.queues.get(label);
  }
}
