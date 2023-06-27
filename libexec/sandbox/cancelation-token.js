self.wrapScriptLoading({ scriptName: 'cancelation-token' }, function cancellationToken$$fn(protectedStorage) {
  // poor persons' strong typing, check the return value of `Cancellation::canceled` against this constant to see if
  // the token is canceled
  class _CancelToken { }
  const CANCELED_TOKEN = new _CancelToken();

  /**
   * A CancelationToken provides you way to get notified when someones instructs you to stop waiting for a condition
   * and return early/stop trying to do what you're doing. It's basically a specialize version of condition variable.
   *
   * Typical usage looks like:
   * @example <caption> you're almost certainly using it wrong if you don't use it with Promise.race </caption>
   * var token; // defined somewhere else 
   * const stuff = Promise.race(token.canceled(), otherPromise);
   * if (stuff === CANCLED_TOKEN)
   *   return; // canceled, return early
   *
   * @class CancelationToken
   * @function cancel - cancel the underlying token
   * @function canceled - returns a promise that will be resolved once someone calls cancel
   */
  class CancelationToken
  {
    #isCanceled;
    #awaiters;

    /**
     * Constructs a new cancelation token, it 
     * @constructor
     * @param {Boolean} startOutAsCancled - if true, the cancelation token is already canceled on creation
     * @returns {CancelationToken} 
     */
    constructor(startOutAsCancled = false)
    {
      this.#isCanceled = startOutAsCancled;
      this.#awaiters = [];
    }

    /**
     * @function cancel
     * cancel the underlying token
     */
    cancel()
    {
      this.#isCanceled = true;

      for (const awaiter of this.#awaiters)
        awaiter(CANCELED_TOKEN);
    }

    /**
     * @function canceled
     * @returns {Promise<Symbol>} a Promise that will resolve once someone cancels us, check the revolved against the 
     * `CANCELED_TOKEN` in `Promise.race` to ensure you know which one returned
     */
    canceled()
    {
      const that = this;
      return new Promise((resolve) => {
        if (that.#isCanceled)
          resolve(CANCELED_TOKEN);
        else
          this.#awaiters.push(resolve);
      });
    }
  }

  protectedStorage.CANCELED_TOKEN = CANCELED_TOKEN;
  protectedStorage.CancelationToken = CancelationToken;
});
