self.wrapScriptLoading({ scriptName: 'condition-variable' }, function conditionVariable$$fn(protectedStorage) {
  /**
   * The classic condition variable (cv) implemented using Promises. The point is *not* to protect access since
   * JavaScript is single threaded any way. But rather, provides a convenient way to get notified about a condition
   * instead of busy polling via setTimeout. This can be desired if you want to ensure your continuation is serviced as
   * soon as possible.
   *
   * Interfaces stolen from Rust, which is stolen from C++, which is probably stolen from pthreads.
   */
  class ConditionVariable 
  {
    #awaiters;

    constructor() 
    {
      this.#awaiters = [];
    }

    /**
     * Wait until someone calls `notifyOne` or `notifyAll`
     * @function wait
     * @returns {Promise} resolves when someone calls `notifyOne` or `notifyAll`
     */
    wait() 
    {
      return new Promise((resolve) => 
      {
        this.#awaiters.push(resolve);
      });
    }

    /**
     * Wait until someone calls `notifyOne` or `notifyAll` *and* the predicate is not true.
     *
     * Note: Even if the predicte becomes true under any circumstances, the promise won't be resolved until someone calls
     * `notifyOne` or `notifyAll`.
     * @function wait
     * @returns {Promise} resolves when someone calls `notifyOne` or `notifyAll`
     */
    waitWhile(predicate) 
    {
      return this.wait().then(() => 
      {
        if (predicate())
          return this.waitWhile(predicate);
      });
    }

    /**
     * Notify the one Promise in the queue to be resolved. Currently, the first one that enqueues via `wait` and `waitAll`
     * will be notified.
     * @function notifyOne
     */
    notifyOne() 
    {
      const luckyIndividual = this.#awaiters.shift();
      if (luckyIndividual)
        luckyIndividual();
    }

    /**
     * Notify all enqueued Promises.
     * @function notifyAll
     */
    notifyAll() 
    {
      // grab a copy and clear the original, in case when notifying, the queue is modified
      const toCall = this.#awaiters;
      this.#awaiters = [];
      toCall.forEach((awaiter) => awaiter());
    }
  }

  protectedStorage.ConditionVariable = ConditionVariable;
});
