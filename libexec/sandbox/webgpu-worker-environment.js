/**
 *  @file       libexec/sandbox/webgpu-worker-environment.js
 *  @author     Dominic Cerisano, dcerisano@kingsds.network
 *  @date       May 2020
 */

self.wrapScriptLoading({ scriptName: 'webgpu-evaluator' }, function webGpuWorkerEnvironment$$fn(protectedStorage, postMessage)
{
  if (typeof GPU !== 'undefined') {
    try {
      // TODO: Set to the windows string on Windows
      GPU.$setPlatform("linux");

      self.navigator = {"gpu": GPU};

      {
        let devices = [];

        //Timeouts for polyfills
        //Negative numbers to signal clamping override in evaluator engine.
        //nextTickTimeout is for process.nextTick() polyfill
        //immediateTimeout is for setImmediate() polyfill

        self.nextTickTimeout  = -0;
        self.immediateTimeout = -0;

        function deviceTick()
        {
          if (devices) {
            for (let ii = 0; ii < devices.length; ++ii) {
              devices[ii].tick();
            };
          }
        }

        self.setTimeout(deviceTick, self.nextTickTimeout);

        GPUAdapter.prototype.requestDevice = function() {
          let args = arguments;

          return new Promise((resolve, reject) => {
            this._requestDevice(...args).then(device => {
              device._onErrorCallback = function(type, msg) {
                //Polyfill for process.nextTick
                self.setTimeout(() => {
                  switch (type) {
                  case "Error": throw new Error(msg);
                  case "Type": throw new TypeError(msg);
                  case "Range": throw new RangeError(msg);
                  case "Reference": throw new ReferenceError(msg);
                  case "Internal": throw new InternalError(msg);
                  case "Syntax": throw new SyntaxError(msg);
                  default: throw new Error(msg);
                  };
                }, self.immediateTimeout);
              };

              devices.push(device);
              resolve(device);
            });
          });
        };
      }

      //Return a promise instead of a callback

      GPUFence.prototype.onCompletion = function(completionValue) {
        return new Promise(resolve => {
          //Polyfill for setImmediate
          self.setTimeout(() => {
            this._onCompletion(completionValue, resolve);
          }, self.immediateTimeout);
        });
      };

      GPUBuffer.prototype.mapReadAsync = function() {
        return new Promise(resolve => {
          //Polyfill for setImmediate
          self.setTimeout(() => {
            this._mapReadAsync(resolve);
          }, self.immediateTimeout);
        });
      };

      GPUBuffer.prototype.mapWriteAsync = function() {
        return new Promise(resolve => {
          //Polyfill for setImmediate
          self.setTimeout(() => {
            this._mapWriteAsync(resolve);
          }, self.immediateTimeout);
        });
      };

      GPUDevice.prototype.createBufferMappedAsync = function(descriptor) {
        return new Promise(resolve => {
          //Polyfill for setImmediate
          self.setTimeout(() => {
            this._createBufferMappedAsync(descriptor, resolve);
          }, self.immediateTimeout);
        });
      };

      GPUDevice.prototype.createBufferMapped = function(descriptor) {
        return new Promise(resolve => {
          //Polyfill for setImmediate
          self.setTimeout(() => {
            this._createBufferMapped(descriptor, resolve);
          }, self.immediateTimeout);
        });
      };

    } catch(err) {
      console.log("ERROR: ", err);
    }
  }
});
