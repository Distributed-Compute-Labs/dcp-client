/** 
 *  @file       globalPolyfillHelper.js
 * 
 *  Helper file for tests of scripts in libexec/sandbox. Most of the scripts assume
 *  some specific global symbols exist, so this script polyfills most of them. Depending on
 *  the scripts being tested, more polyfills may be required, which should be implemented
 *  in the individual test files. This file also executes the scripts provided in the global scope.
 * 
 *  @author     Ryan Saweczko, ryansaweczko@kingsds.network
 *  @date       January 2022
 */


const fs = require('fs');

/**
 * Initializes the global scope by evaluating a list of files. Typically,
 * sandbox initialization files to setup necessary symbols to run test.
 *
 * Accepts a callback to make spying on post messages easier for test
 * assertions.
 *
 * @param {string[]} files - A list of files to execute in the global scope.
 * @param {(message: object) => void} [outputTesting] - Callback that receives post messages.
 */
exports.init = function init(files, outputTesting)
{
  let code = ''
  for (const file of files)
  {
    const fd = fs.openSync(file, 'r');
    code += fs.readFileSync(fd, 'utf-8') + '\n';
    fs.closeSync(fd);
  }

  // The node worker injects several symbols into the context of the evaluator when it
  // is started. These symbols are expected to exist on the global object within the evaluator.
  // Emulate the expected global symbols that are most commonly used.
  self = global;
  global.KVIN = require('kvin');
  global.performance = { now: Date.now };

  // postMessage is:
  //   a) expected to be a symbol in the evaluator
  //   b) the method almost always used to get information out of the evaluator.
  // for this purpose, a callback function should be defined in each test to check
  // whatever desired functionality works.
  // eslint-disable-next-line vars-on-top
  global.postMessage = (line) =>
  {
    line = KVIN.unmarshal(line)
    if (typeof outputTesting === 'function')
      outputTesting(line);
  }

  // Simulate die with process.exit
  global.die = process.exit

  // Very, very, very badly created event listener implementation - but suits the needs
  const eventsListening = {}
  global.addEventListener = (event,callback) =>
  {
    if (!eventsListening[event])
      eventsListening[event] = [];
    eventsListening[event].push(callback)
  }
  global.emitEvent = (event, data) =>
  {
    if (eventsListening[event])
      for (let cb of eventsListening[event])
        process.nextTick(() => cb.call(null, data));
  }

  const indirectEval = eval
  indirectEval(code)
  // At this point a very primitive version of the evaluator exists - all global symbols defined in
  // by the supplied evaluator scripts 'files' exist/are overwritten in the global scope.
  // Tests can now use such symbols, or event listeners that would be set up by the files to run tests over them.
}

