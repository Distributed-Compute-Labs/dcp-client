/**
 *  @file       worker/evaluator-lib/access-lists.js
 *
 *              This file applies access lists and polyfills to the global object.
 *
 *  @author     Sam Cantor, sam@kingsds.network
 *  @date       Sept 2020
 */

self.wrapScriptLoading({ scriptName: 'access-lists', ringTransition: true }, function accessLists$$fn(protectedStorage, ring0PostMessage)
{
  const ring1PostMessage = self.postMessage;
  const global = typeof globalThis === 'undefined' ? self : globalThis;

  // aggregated from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects#Reflection
  const allowList = new Set([
    '__proto__',
    'addEventListener',
    'applyAccesslist',
    'Array',
    'ArrayBuffer',
    'AsyncFunction',
    'Atomics',
    'BigInt',
    'BigInt64Array',
    'BigUint64Array',
    'Boolean',
    'Blob',
    'bravojs',
    'clearInterval',
    'clearTimeout',
    'console',
    'constructor',
    'DataView',
    'Date',
    'decodeURI',
    'decodeURIComponent',
    'encodeURI',
    'encodeURIComponent',
    'Error',
    'escape',
    'eval',
    'EvalError',
    'File',
    'FileReader',
    'Float32Array',
    'Float64Array',
    'Function',
    'Headers',
    'Infinity',
    'Int16Array',
    'Int32Array',
    'Int8Array',
    'isFinite',
    'isNaN',
    'JSON',
    'Map',
    'Math',
    'module',
    'NaN',
    'navigator',
    'null',
    'Number',
    'Object',
    'OffscreenCanvas',
    'onerror',
    'onmessage',
    'parseFloat',
    'parseInt',
    'performance',
    'postMessage',
    'Promise',
    'propertyIsEnumerable',
    'Proxy',
    'pt0',
    'RangeError',
    'ReferenceError',
    'Reflect',
    'RegExp',
    'removeEventListener',
    'requestAnimationFrame',
    'require',
    'Response',
    'self',
    'Set',
    'setInterval',
    'setTimeout',
    'setImmediate',
    'sleep',
    'String',
    'Symbol',
    'SyntaxError',
    'TextDecoder',
    'TextEncoder',
    'toLocaleString',
    'toString',
    'TypeError',
    'URIError',
    'URL',
    'Uint16Array',
    'Uint32Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'undefined',
    'unescape',
    'valueOf',
    'WeakMap',
    'WeakSet',
    'WebAssembly',
    'WebGL2RenderingContext',
    'WebGLTexture',
    'WorkerGlobalScope',
    // Our own Webgpu symbols
    'WebGPUWindow',
    'GPU',
    'GPUBufferUsage',
    'GPUShaderStage',
    'GPUMapMode',
    // Our own symbols
    'progress',
    'work',
  ]);

  // Origin time for performance polyfill
  const pt0 = new Date().getTime(); 

  // Add polyfills for any non-allowed symbols
  const polyfills = {
    location: {
      search: "",
      href: 'DCP Worker',
    },
    // Assumption that if performance exists, performance.now must exist
    performance: typeof performance !== 'undefined' ? performance : { 
      now: ()=>{ 
        res = new Date().getTime() - pt0;
        return res;
      } 
    },
    importScripts: function () {
      throw new Error('importScripts is not supported on DCP');
    },
    WorkerGlobalScope: typeof globalThis === 'undefined' ? self : globalThis,
    globalThis: typeof globalThis === 'undefined' ? self : globalThis,
    // For browsers/SA-workers that don't support btoa/atob, modified from https://github.com/MaxArt2501/base64-js/blob/master/base64.js
    btoa: function (string) {
      var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

      string = String(string);
      var bitmap, a, b, c,
        result = "", i = 0,
        rest = string.length % 3;

      for (; i < string.length;) {
        if ((a = string.charCodeAt(i++)) > 255
          || (b = string.charCodeAt(i++)) > 255
          || (c = string.charCodeAt(i++)) > 255)
          throw new TypeError("Failed to execute 'btoa': The string to be encoded contains characters outside of the Latin1 range.");

        bitmap = (a << 16) | (b << 8) | c;
        result += b64.charAt(bitmap >> 18 & 63) + b64.charAt(bitmap >> 12 & 63)
          + b64.charAt(bitmap >> 6 & 63) + b64.charAt(bitmap & 63);
      }

      // If there's need of padding, replace the last 'A's with equal signs
      return rest ? result.slice(0, rest - 3) + "===".substring(rest) : result;
    },
    atob: function (string) {
      var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      string = String(string).replace(/[\t\n\f\r ]+/g, "");

      // Adding the padding if missing, for semplicity
      string += "==".slice(2 - (string.length & 3));
      var bitmap, result = "", r1, r2, i = 0;
      for (; i < string.length;) {
        bitmap = b64.indexOf(string.charAt(i++)) << 18 | b64.indexOf(string.charAt(i++)) << 12
          | (r1 = b64.indexOf(string.charAt(i++))) << 6 | (r2 = b64.indexOf(string.charAt(i++)));

        result += r1 === 64 ? String.fromCharCode(bitmap >> 16 & 255)
          : r2 === 64 ? String.fromCharCode(bitmap >> 16 & 255, bitmap >> 8 & 255)
            : String.fromCharCode(bitmap >> 16 & 255, bitmap >> 8 & 255, bitmap & 255);
      }
      return result;
    },
    // Polyfill for Blob
    Blob: class Blob {
      /** @type {Array.<(Blob|Uint8Array)>} */
      #parts = [];
      #type = '';
      #size = 0;
      #endings = 'transparent';
    
      /**
       * The Blob() constructor returns a new Blob object. The content
       * of the blob consists of the concatenation of the values given
       * in the parameter array.
       *
       * @param {*} blobParts
       * @param {{ type?: string, endings?: string }} [options]
       */
      constructor (blobParts = [], options = {}) {
        if (typeof blobParts !== 'object' || blobParts === null) {
          throw new TypeError('Failed to construct \'Blob\': The provided value cannot be converted to a sequence.');
        }
    
        if (typeof blobParts[Symbol.iterator] !== 'function') {
          throw new TypeError('Failed to construct \'Blob\': The object must have a callable @@iterator property.');
        }
    
        if (typeof options !== 'object' && typeof options !== 'function') {
          throw new TypeError('Failed to construct \'Blob\': parameter 2 cannot convert to dictionary.');
        }
    
        if (options === null) options = {};
    
        const encoder = new TextEncoder();

        for (const element of blobParts) {
          let part;

          if (ArrayBuffer.isView(element)) {
            part = new Uint8Array(element.buffer.slice(element.byteOffset, element.byteOffset + element.byteLength));
          } else if (element instanceof ArrayBuffer) {
            part = new Uint8Array(element.slice(0));
          } else if (element instanceof Blob) {
            part = element;
          } else {
            part = encoder.encode(`${element}`);
          }
    
          const size = ArrayBuffer.isView(part) ? part.byteLength : part.size;
          // Avoid pushing empty parts into the array to better GC them
          if (size) {
            this.#size += size;
            this.#parts.push(part);
          }
        }
    
        this.#endings = `${options.endings === undefined ? 'transparent' : options.endings}`;
        const type = options.type === undefined ? '' : String(options.type);
        this.#type = /^[\x20-\x7E]*$/.test(type) ? type : '';
      }
    
      /**
       * The Blob interface's size property returns the
       * size of the Blob in bytes.
       */
      get size() {
        return this.#size;
      }
    
      /**
       * The type property of a Blob object returns the MIME type of the file.
       */
      get type() {
        return this.#type;
      }
    
      /**
       * The text() method in the Blob interface returns a Promise
       * that resolves with a string containing the contents of
       * the blob, interpreted as UTF-8.
       *
       * @return {Promise<string>}
       */
      async text() {
        debugger;
        // More optimized than using this.arrayBuffer()
        // that requires twice as much ram
        const decoder = new TextDecoder();
        let str = '';

        for await (const part of toIterator(this.#parts, false)) {
          str += decoder.decode(part, { stream: true });
        }

        // Remaining
        str += decoder.decode();
        return str;
      }
    
      /**
       * The arrayBuffer() method in the Blob interface returns a
       * Promise that resolves with the contents of the blob as
       * binary data contained in an ArrayBuffer.
       *
       * @return {Promise<ArrayBuffer>}
       */
      async arrayBuffer() {
        // Easier way... Just a unnecessary overhead
        // const view = new Uint8Array(this.size);
        // await this.stream().getReader({mode: 'byob'}).read(view);
        // return view.buffer;
    
        const data = new Uint8Array(this.size);
        let offset = 0;

        for await (const chunk of toIterator(this.#parts, false)) {
          data.set(chunk, offset);
          offset += chunk.length;
        }
    
        return data.buffer;
      }
    
      /**
       * stream() requires a polyfill for "ReadableStream" so leave it NYI for
       * now, in case of feature testing
       */
      // stream() {
      // }
    
      /**
       * The Blob interface's slice() method creates and returns a
       * new Blob object which contains data from a subset of the
       * blob on which it's called.
       *
       * @param {number} [start]
       * @param {number} [end]
       * @param {string} [type]
       */
      slice(start = 0, end = this.size, type = '') {
        const { size } = this;
    
        let relativeStart = start < 0 ? Math.max(size + start, 0) : Math.min(start, size);
        let relativeEnd = end < 0 ? Math.max(size + end, 0) : Math.min(end, size);
    
        const span = Math.max(relativeEnd - relativeStart, 0);
        const parts = this.#parts;
        const blobParts = [];
        let added = 0;
    
        for (const part of parts) {
          // don't add the overflow to new blobParts
          if (added >= span) {
            break;
          }
    
          const size = ArrayBuffer.isView(part) ? part.byteLength : part.size;
          if (relativeStart && size <= relativeStart) {
            // Skip the beginning and change the relative
            // start & end position as we skip the unwanted parts
            relativeStart -= size;
            relativeEnd -= size;
          } else {
            let chunk;

            if (ArrayBuffer.isView(part)) {
              chunk = part.subarray(relativeStart, Math.min(size, relativeEnd));
              added += chunk.byteLength;
            } else {
              chunk = part.slice(relativeStart, Math.min(size, relativeEnd));
              added += chunk.size;
            }

            relativeEnd -= size;
            blobParts.push(chunk);
            relativeStart = 0; // All next sequential parts should start at 0
          }
        }
    
        const blob = new Blob([], { type: String(type).toLowerCase() });
        blob.#size = span;
        blob.#parts = blobParts;
    
        return blob;
      }
    
      get[Symbol.toStringTag]() {
        return 'Blob';
      }
    
      static[Symbol.hasInstance](object) {
        return (
          object &&
          typeof object === 'object' &&
          typeof object.constructor === 'function' &&
          (
            typeof object.stream === 'function' ||
            typeof object.arrayBuffer === 'function'
          ) &&
          /^(Blob|File)$/.test(object[Symbol.toStringTag])
        );
      }
    }
  };

  /** @param {(Blob | Uint8Array)[]} parts */
  async function * toIterator (parts, clone = true) {
    for (const part of parts) {
      if ('stream' in part) {
        yield * (/** @type {AsyncIterableIterator<Uint8Array>} */ (part.stream()))
      } else if (ArrayBuffer.isView(part)) {
        if (clone) {
          let position = part.byteOffset
          const end = part.byteOffset + part.byteLength
          while (position !== end) {
            const size = Math.min(end - position, POOL_SIZE)
            const chunk = part.buffer.slice(position, position + size)
            position += chunk.byteLength
            yield new Uint8Array(chunk)
          }
        } else {
          yield part
        }
      /* c8 ignore next 10 */
      } else {
        // For blobs that have arrayBuffer but no stream method (nodes buffer.Blob)
        let position = 0, b = (/** @type {Blob} */ (part))
        while (position !== b.size) {
          const chunk = b.slice(position, Math.min(b.size, position + POOL_SIZE))
          const buffer = await chunk.arrayBuffer()
          position += buffer.byteLength
          yield new Uint8Array(buffer)
        }
      }
    }
  }

  // Polyfill for TextEncoder/Decoder
  var fromCharCode = String.fromCharCode;
	var Object_prototype_toString = ({}).toString;
	var sharedArrayBufferString = Object_prototype_toString.call(self["SharedArrayBuffer"]);
	var undefinedObjectString = '[object Undefined]';
	var NativeUint8Array = self.Uint8Array;
	var patchedU8Array = NativeUint8Array || Array;
	var nativeArrayBuffer = NativeUint8Array ? ArrayBuffer : patchedU8Array;
	var arrayBuffer_isView = nativeArrayBuffer.isView || function(x) {return x && "length" in x};
	var arrayBufferString = Object_prototype_toString.call(nativeArrayBuffer.prototype);
	var tmpBufferU16 = new (NativeUint8Array ? Uint16Array : patchedU8Array)(32);

  if (typeof TextEncoder === "undefined") {
    self.TextEncoder = function TextEncoder(){};
    var TextEncoderPrototype = TextEncoder["prototype"];
    TextEncoderPrototype["encode"] = function(inputString){
      // 0xc0 => 0b11000000; 0xff => 0b11111111; 0xc0-0xff => 0b11xxxxxx
      // 0x80 => 0b10000000; 0xbf => 0b10111111; 0x80-0xbf => 0b10xxxxxx
      var encodedString = inputString === void 0 ? "" : ("" + inputString), len=encodedString.length|0;
      var result=new patchedU8Array((len << 1) + 8|0), tmpResult;
      var i=0, pos=0, point=0, nextcode=0;
      var upgradededArraySize=!NativeUint8Array; // normal arrays are auto-expanding
      for (i=0; i<len; i=i+1|0, pos=pos+1|0) {
        point = encodedString.charCodeAt(i)|0;
        if (point <= 0x007f) {
          result[pos] = point;
        } else if (point <= 0x07ff) {
          result[pos] = (0x6<<5)|(point>>6);
          result[pos=pos+1|0] = (0x2<<6)|(point&0x3f);
        } else {
          widenCheck: {
            if (0xD800 <= point) {
              if (point <= 0xDBFF) {
                nextcode = encodedString.charCodeAt(i=i+1|0)|0; // defaults to 0 when NaN, causing null replacement character
  
                if (0xDC00 <= nextcode && nextcode <= 0xDFFF) {
                  //point = ((point - 0xD800)<<10) + nextcode - 0xDC00 + 0x10000|0;
                  point = (point<<10) + nextcode - 0x35fdc00|0;
                  if (point > 0xffff) {
                    result[pos] = (0x1e/*0b11110*/<<3) | (point>>18);
                    result[pos=pos+1|0] = (0x2/*0b10*/<<6) | ((point>>12)&0x3f/*0b00111111*/);
                    result[pos=pos+1|0] = (0x2/*0b10*/<<6) | ((point>>6)&0x3f/*0b00111111*/);
                    result[pos=pos+1|0] = (0x2/*0b10*/<<6) | (point&0x3f/*0b00111111*/);
                    continue;
                  }
                  break widenCheck;
                }
                point = 65533/*0b1111111111111101*/;//return '\xEF\xBF\xBD';//fromCharCode(0xef, 0xbf, 0xbd);
              } else if (point <= 0xDFFF) {
                point = 65533/*0b1111111111111101*/;//return '\xEF\xBF\xBD';//fromCharCode(0xef, 0xbf, 0xbd);
              }
            }
            if (!upgradededArraySize && (i << 1) < pos && (i << 1) < (pos - 7|0)) {
              upgradededArraySize = true;
              tmpResult = new patchedU8Array(len * 3);
              tmpResult.set( result );
              result = tmpResult;
            }
          }
          result[pos] = (0xe/*0b1110*/<<4) | (point>>12);
          result[pos=pos+1|0] =(0x2/*0b10*/<<6) | ((point>>6)&0x3f/*0b00111111*/);
          result[pos=pos+1|0] =(0x2/*0b10*/<<6) | (point&0x3f/*0b00111111*/);
        }
      }
      return NativeUint8Array ? result.subarray(0, pos) : result.slice(0, pos);
    };
  }
  
  if (typeof TextDecoder === "undefined") {
    self.TextDecoder = function TextDecoder(){};
    TextDecoder["prototype"]["decode"] = function(inputArrayOrBuffer){
      var inputAs8 = inputArrayOrBuffer, asObjectString;
      if (!arrayBuffer_isView(inputAs8)) {
        asObjectString = Object_prototype_toString.call(inputAs8);
        if (asObjectString !== arrayBufferString && asObjectString !== sharedArrayBufferString && asObjectString !== undefinedObjectString)
          throw TypeError("Failed to execute 'decode' on 'TextDecoder': The provided value is not of type '(ArrayBuffer or ArrayBufferView)'");
        inputAs8 = NativeUint8Array ? new patchedU8Array(inputAs8) : inputAs8 || [];
      }

      var resultingString = "", tmpStr = "", index = 0, len = inputAs8.length | 0, lenMinus32 = len - 32 | 0, nextEnd = 0, nextStop = 0, cp0 = 0, codePoint = 0, minBits = 0, cp1 = 0, pos = 0, tmp = -1;
      // Note that tmp represents the 2nd half of a surrogate pair incase a surrogate gets divided between blocks
      for (; index < len;) {
        nextEnd = index <= lenMinus32 ? 32 : len - index | 0;
        for (; pos < nextEnd; index = index + 1 | 0, pos = pos + 1 | 0) {
          cp0 = inputAs8[index] & 0xff;
          switch (cp0 >> 4) {
            case 15:
              cp1 = inputAs8[index = index + 1 | 0] & 0xff;
              if ((cp1 >> 6) !== 2 || 247 < cp0) {
                index = index - 1 | 0;
                break;
              }
              codePoint = ((cp0 & 7) << 6) | (cp1 & 63);
              minBits = 5; // 20 ensures it never passes -> all invalid replacements
              cp0 = 0x100; //  keep track of th bit size
            case 14:
              cp1 = inputAs8[index = index + 1 | 0] & 0xff;
              codePoint <<= 6;
              codePoint |= ((cp0 & 15) << 6) | (cp1 & 63);
              minBits = (cp1 >> 6) === 2 ? minBits + 4 | 0 : 24; // 24 ensures it never passes -> all invalid replacements
              cp0 = (cp0 + 0x100) & 0x300; // keep track of th bit size
            case 13:
            case 12:
              cp1 = inputAs8[index = index + 1 | 0] & 0xff;
              codePoint <<= 6;
              codePoint |= ((cp0 & 31) << 6) | cp1 & 63;
              minBits = minBits + 7 | 0;

              // Now, process the code point
              if (index < len && (cp1 >> 6) === 2 && (codePoint >> minBits) && codePoint < 0x110000) {
                cp0 = codePoint;
                codePoint = codePoint - 0x10000 | 0;
                if (0 <= codePoint/*0xffff < codePoint*/) { // BMP code point
                  //nextEnd = nextEnd - 1|0;

                  tmp = (codePoint >> 10) + 0xD800 | 0;   // highSurrogate
                  cp0 = (codePoint & 0x3ff) + 0xDC00 | 0; // lowSurrogate (will be inserted later in the switch-statement)

                  if (pos < 31) { // notice 31 instead of 32
                    tmpBufferU16[pos] = tmp;
                    pos = pos + 1 | 0;
                    tmp = -1;
                  } else {// else, we are at the end of the inputAs8 and let tmp0 be filled in later on
                    // NOTE that cp1 is being used as a temporary variable for the swapping of tmp with cp0
                    cp1 = tmp;
                    tmp = cp0;
                    cp0 = cp1;
                  }
                } else nextEnd = nextEnd + 1 | 0; // because we are advancing i without advancing pos
              } else {
                // invalid code point means replacing the whole thing with null replacement characters
                cp0 >>= 8;
                index = index - cp0 - 1 | 0; // reset index  back to what it was before
                cp0 = 0xfffd;
              }
              // Finally, reset the variables for the next go-around
              minBits = 0;
              codePoint = 0;
              nextEnd = index <= lenMinus32 ? 32 : len - index | 0;
            /*case 11:
            case 10:
            case 9:
            case 8:
              codePoint ? codePoint = 0 : cp0 = 0xfffd; // fill with invalid replacement character
            case 7:
            case 6:
            case 5:
            case 4:
            case 3:
            case 2:
            case 1:
            case 0:
              tmpBufferU16[pos] = cp0;
              continue;*/
            default:
              tmpBufferU16[pos] = cp0; // fill with invalid replacement character
              continue;
            case 11:
            case 10:
            case 9:
            case 8:
          }
          tmpBufferU16[pos] = 0xfffd; // fill with invalid replacement character
        }
        tmpStr += fromCharCode(
          tmpBufferU16[0], tmpBufferU16[1], tmpBufferU16[2], tmpBufferU16[3], tmpBufferU16[4], tmpBufferU16[5], tmpBufferU16[6], tmpBufferU16[7],
          tmpBufferU16[8], tmpBufferU16[9], tmpBufferU16[10], tmpBufferU16[11], tmpBufferU16[12], tmpBufferU16[13], tmpBufferU16[14], tmpBufferU16[15],
          tmpBufferU16[16], tmpBufferU16[17], tmpBufferU16[18], tmpBufferU16[19], tmpBufferU16[20], tmpBufferU16[21], tmpBufferU16[22], tmpBufferU16[23],
          tmpBufferU16[24], tmpBufferU16[25], tmpBufferU16[26], tmpBufferU16[27], tmpBufferU16[28], tmpBufferU16[29], tmpBufferU16[30], tmpBufferU16[31]
        );
        if (pos < 32) tmpStr = tmpStr.slice(0, pos - 32 | 0);//-(32-pos));
        if (index < len) {
          //fromCharCode.apply(0, tmpBufferU16 : NativeUint8Array ?  tmpBufferU16.subarray(0,pos) : tmpBufferU16.slice(0,pos));
          tmpBufferU16[0] = tmp;
          pos = (~tmp) >>> 31;//tmp !== -1 ? 1 : 0;
          tmp = -1;

          if (tmpStr.length < resultingString.length) continue;
        } else if (tmp !== -1) {
          tmpStr += fromCharCode(tmp);
        }

        resultingString += tmpStr;
        tmpStr = "";
      }

      return resultingString;
    }
  }


  // Set values to true to disallow access to symbols
  const blockList = {
    OffscreenCanvas: false,
  };

  const blockListRequirements = {
    OffscreenCanvas: "environment.offscreenCanvas"
  };
  /**
   * Applies a allow list and a block list of properties to an object. After this function, if someone tries
   * to access non-allowed or blocked properties, a warning is logged and it will return undefined. The allow
   * list and block list are not mutually exclusive. If an item is in both lists, then the block list will be
   * enacted upon it.
   *
   * @param {object} obj - The object, which will have the allow list applied to its properties.
   * @param {Set} allowList - A set of properties to allow people to access.
   * @param {Set} blockList - An object of property names mapping to booleans to indicate whether access is allowed or not.
   * @param {Set} blockListRequirements - An object of property names mapping requirement path strings, used to print useful warnings.
   * @param {Set} polyfills - An object of property names that have been polyfilled.
   */
  function applyAccessLists(obj, allowList, blockList = {}, blockListRequirements = {}, polyfills = {}) {
    if (!obj) { return; }
    Object.getOwnPropertyNames(obj).forEach(function (prop) {
      if (Object.getOwnPropertyDescriptor(obj, prop).configurable) {
        if (!allowList.has(prop)) {
          let isSet = false;
          let propValue;
          Object.defineProperty(obj, prop, {
            get: function () {
              if (isSet) {
                return propValue;
              } else {
                if (prop in polyfills) {
                  return polyfills[prop];
                }
                return undefined;
              }
            },
            set: function (value) {
              propValue = value;
              isSet = true;
            },
            configurable: false
          });
        } else if (prop in blockList) {
          let isSet = false;
          let blocked = blockList[prop];
          let requirement = blockListRequirements[prop];
          let propValue = obj[prop];
          Object.defineProperty(obj, prop, {
            get: function () {
              if (blocked && !isSet) {
                return undefined;
              } else {
                return propValue;
              }
            },
            set: function (value) {
              propValue = value;
              isSet = true;
            },
            configurable: false
          });
        }
      }

    });
  }

  /**
   * Applies a list of polyfills to symbols not present in the global object. Will apply
   * this list through the objects entire prototype chain
   * 
   * @param {Object} obj - The global object to add properties on
   * @param {Set} polyfills - An object of property names to create/polyfill 
   */
  function applyPolyfills(obj, polyfills = {}) {
    // Apply symbols from polyfill object
    for (let prop in polyfills) {
      let found = false;
      for (let o = obj; o.__proto__ && (o.__proto__ !== Object); o = o.__proto__) {
        if (o.hasOwnProperty(prop)) {
          found = true;
          break;
        }
      }
      if (found) { continue; }
      let propValue = polyfills[prop];
      Object.defineProperty(obj, prop, {
        get: function () {
          return propValue;

        },
        set: function (value) {
          propValue = value;
        },
        configurable: false
      });
    }
  }

  /**
   * Applies the allowList and blockList to all global scopes.
   * This must be called after the requirements are assigned to the sandbox
   * so that the blockList is accessible to modify w/o adding it to the allowList.
   */
  function applyAllAccessLists() {
    // We need to apply the access lists to global, global.__proto__, and global.__proto__.__proto__,
    // because there's networking-accessing functions inside global.__proto__.__proto__, like fetch.
    //
    // If we're in a robust environment (node, browser, WebWorker, basically anything but v8),
    // then we have to climb the prototype chain and apply the allowList there, but we have to stop
    // before we allow Object's properties

    var global = typeof globalThis === 'undefined' ? self : globalThis;
    // Save them in scope because they'll get hidden by the allowList
    let _allowList = allowList;
    let _blockList = blockList;
    let _polyfills = polyfills;

    // Ternary expression to avoid a ReferenceError on navigator
    let _navigator = typeof navigator !== 'undefined' ? navigator : undefined;
    let _GPU       = ((typeof navigator !== 'undefined') && (typeof navigator.gpu !== 'undefined')) ? navigator.gpu : 
      (typeof GPU !== 'undefined'? GPU : undefined);
    let _blockListRequirements = blockListRequirements;
    let _applyAccessLists = applyAccessLists;
    let _applyPolyfills = applyPolyfills;

    for (let g = global; g.__proto__ && (g.__proto__ !== Object); g = g.__proto__) {
      applyAccessLists(g, allowList, blockList, blockListRequirements, polyfills);
    }

    if (typeof _navigator === 'undefined') {
      _navigator = navigator = {
        userAgent: 'not a browser',
        gpu: _GPU, 
      };
    } else {
      // We also want to allowList certain parts of navigator, but not others.
      
      navAllowlist = new Set([
        'userAgent',
        'gpu',
      ]);
      let navPolyfill = {
        userAgent: typeof navigator.userAgent !== 'undefined'? navigator.userAgent : 'not a browser',
        gpu: _GPU 
      };
      applyAccessLists(navigator.__proto__, navAllowlist, {}, {}, navPolyfill);
      applyPolyfills(navigator.__proto__, navPolyfill);
    }
  }

  /* Polyfill section of workerBootstrap */

  // Define properties for symbols that are not present in the global object
  applyPolyfills(global, polyfills);

  // At time of writing, Chrome defines requestAnimationFrame inside web workers, but
  // Firefox doesn't.
  if (typeof requestAnimationFrame == 'undefined') {
    global.requestAnimationFrame = callback => setTimeout(callback, 0);
  }

  if (typeof OffscreenCanvas !== 'undefined') {

    // This deals with Firefox bug 1529995, which causes the tab to crash if fenceSync is called.
    if (navigator.userAgent.indexOf('Firefox') >= 0) {
      new OffscreenCanvas(640, 480).getContext('webgl2').__proto__.fenceSync = null;
      // Note: We can't just do the following, since WebGL2RenderingContext isn't defined
      // in Firefox until the first webgl2 context is created.
      // WebGL2RenderingContext.prototype.fenceSync = undefined
    }

    // Make it so that if getContext throws on a given type of context, return null
    // instead of throwing an exception. This replicates Chrome's behaviour.
    OffscreenCanvas.prototype.oldGetContext = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function getContextPolyfill(type) {
      try {
        return this.oldGetContext(type);
      } catch (e) {
        return null;
      }
    };
  }

  addEventListener('message', async (event) => {
    try {
      if (event.request === 'applyRequirements') {
        // This event is fired when the worker is initialized with job requirements,
        // apply restrictions to the environment based on the requirements.
        // Assume the scheduler gave us a nicely-shaped req object.
        const requirements = event.requirements;
        blockList.OffscreenCanvas = !requirements.environment.offscreenCanvas;
        applyAllAccessLists();

        ring1PostMessage({ request: 'applyRequirementsDone' });
      }
    } catch (error) {
      ring1PostMessage({
        request: 'error',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      });
    }
  });
});
