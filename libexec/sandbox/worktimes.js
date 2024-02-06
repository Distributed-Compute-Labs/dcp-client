/**
 * @file      worktimes.js
 *            Specify available worktimes, allow registering custom worktimes
 *            The single source of authority for what Worktimes are available.
 * 
 * @author    Will Pringle     <will@distributive.network>
 *            Hamada Gasmallah <hamada@distributive.network>
 * @date      January 2024
 */
'use strict';

function worktimes$$fn(protectedStorage, _ring2PostMessage)
{
  // when preparing a worktime, add it's globals to this object.
  // only if the job assigned to the evaluator uses that worktime, they will
  // be added to the allow-list
  protectedStorage.worktimeGlobals = {};

  const worktimes = [
    { name: 'map-basic', versions: ['1.0.0'] },
    { name: 'pyodide',   versions: ['0.23.2'] },
  ];

  function registerWorktime(name, version)
  {
    const foundWorktime = globalThis.worktimes.find(wt => wt.name === name);
    // if we found a worktime and the version isn't already added, add it
    if (foundWorktime && !foundWorktime.versions.includes(version))
      foundWorktime.versions.push(version);
    // if this is a new worktime, add it
    else if (!foundWorktime)
      globalThis.worktimes.push({ name, versions: [version]});
  }

  // nodejs-like environment
  if (typeof module?.exports === 'object')
    exports.worktimes = worktimes;
  else // inside the sandbox
  {
    globalThis.worktimes        = worktimes;
    globalThis.registerWorktime = registerWorktime;
  }
}

// nodejs-like environment
if (typeof module?.exports === 'object')
  worktimes$$fn({});
// inside the sandbox
else
  self.wrapScriptLoading({ scriptName: 'worktimes' }, worktimes$$fn);

