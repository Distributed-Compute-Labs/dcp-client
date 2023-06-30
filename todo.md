1. need to intercept the gpu allocation so they are always in our control


# ask Ryan
```js
serviceEvents.measurerTimeout = realSetTimeout(endOfRealEventCycle, 1);
```
Why the 1ms delay
