/** @file       wrap-event-listeners.js
 *              A wrapper to protect the global event listener
 *
 * The purpose of this is to wrap addEventListener to ensure all messages are 
 * deserialized when they come from the supervisor/sandboxHandle before being processed and the
 * command executed (ie all onmessage commands are deserialized).
 * 
 *
 *  @author     Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       Oct 2021
 *
 */
self.wrapScriptLoading({ scriptName: 'event-loop-virtualization' }, () => {

  // Will be removing KVIN in access-lists.js, so need an alias for them
  var unmarshal = KVIN.unmarshal

  const globalAddEventListener = self.addEventListener;
  self.addEventListener = function workerControl$$Worker$addEventListener (type, listener) {
    if (type === 'message')
    {
      debugger;
      const wrappedListener = (args) => {
        debugger;
        if (args.data && args.data._serializeVerId)
        {
          
          args.data = unmarshal(args.data)
        }
        listener(args);
      }
      globalAddEventListener(type, wrappedListener);
    }
    else
    {
      globalAddEventListener(type, listener);
    }
    
  }

});
