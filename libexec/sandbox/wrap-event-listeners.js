/** @file       wrap-event-listeners.js
 *              A wrapper to protect the global event listener
 *
 * The purpose of this is to wrap addEventListener to ensure all messages are 
 * deserialized when they come from the supervisor/sandboxHandle before being processed and the
 * command executed (ie all onmessage commands are deserialized).
 * 
 *
 *  @author     Ryan Saweczko, ryansaweczko@kingsds.network
 *  @author     Severn Lortie <severn@distributive.network>
 *  @date       Oct 2021
 *
 */
self.wrapScriptLoading({ scriptName: 'event-loop-virtualization' }, function wrapEventListeners$$fn(protectedStorage)
{
  // Will be removing KVIN in access-lists.js, so need an alias for them
  var unmarshal = KVIN.unmarshal

  const eventListeners = [];
  /**
   * Call registered event handlers when a message from the main thread arrives at the worker. If the MessageEvent has
   * a data marshaled data property, this method will unmarhsal it before passing to handlers. For performance, it is
   * important that the message is unmarhsaled only once for all of the listeners.
   * @param {MessageEvent} messageEvent The MessageEvent from the main thread
   */
  function workerControl$$Worker$handleMessageEvent(messageEvent)
  {
    let unmarshaledData;
    if (messageEvent && messageEvent.data && messageEvent.data._serializeVerId)
      unmarshaledData = unmarshal(messageEvent.data);
    // Just like the baked-in MessageEvents, the unmarshaledData object should be immutable. This is also important since
    // all listeners will have a reference to the same data.
    Object.freeze(unmarshaledData);
    for (const eventListener of eventListeners)
    {
      if (unmarshaledData)
        eventListener(unmarshaledData);
      else
        eventListener(messageEvent);
    }
  }

  const globalAddEventListener    = self.addEventListener;
  const globalRemoveEventListener = self.removeEventListener;
  /**
   * Add an event listener. If the listener is for the "message" event, then any marshaled data will be ummarshaled before being
   * passed to the handler. 
   * @param {string} event The name of the event to listen on
   * @param {function} listener The handler function
   */
  self.addEventListener = function workerControl$$Worker$addEventListener (event, listener)
  {
    if (event === 'message')
      eventListeners.push(listener);
    else
      globalAddEventListener(event, listener);
  }
  /**
   * Remove an event listener.
   * @param {string} event The name of the event that the handler listens on
   * @param {function} listener The handler function
   */
  self.removeEventListener = function workerControl$$Worker$removeEventListener(event, listener)
  {
    if (event === 'message')
      eventListeners.splice(eventListeners.indexOf(listener), 1);
    else
      globalRemoveEventListener(event, listener);
  }
  globalAddEventListener('message', workerControl$$Worker$handleMessageEvent);
});
