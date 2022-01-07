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

exports.init = function init(files, outputTesting, onreadlnFunction)
{
  onreadlnFunction = onreadlnFunction || ((cb) => (line) => { cb(line) })
  let code = ''
  for (const file of files)
  {
    const fd = fs.openSync(file, 'r');
    code += fs.readFileSync(fd, 'utf-8') + '\n';
    fs.closeSync(fd);
  }

  // Fill in functions that the scripts want to exist but don't
  self = global;
  global.KVIN = require('kvin');
  global.performance = { now: Date.now };
  // eslint-disable-next-line vars-on-top
  global.postMessage = (line) =>
  {
    line = KVIN.unmarshal(line)
    if (typeof outputTesting === 'function')
      outputTesting(line);
  }
  global.die = process.exit
  global.onreadln = onreadlnFunction;

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
        cb.call(null, data);
  }

  const indirectEval = eval
  indirectEval(code)
  // At this point a very primitive version of the evaluator exists - all global symbols defined in
  // by the supplied evaluator scripts 'files' exist/are overwritten in the global scope.
  // Tests can now use such symbols, or event listeners that would be set up by the files to run tests over them.
}

