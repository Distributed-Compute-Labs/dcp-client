/**
 * @file      worktimes.js
 *            Specify available worktimes, allow registering custom worktimes
 * 
 * @author    Will Pringle, will@distributive.network
 *            Hamada Gasmallah, hamada@distributive.network
 */
'use strict';

function worktimes$$fn(protectedStorage, _ring2PostMessage)
{

// when preparing a worktime, add it's globals to this object.
// only if the job assigned to the evaluator uses that worktime, they will
// be added to the allow-list
protectedStorage.worktimeGlobals = {};
protectedStorage.legacyArrayWorktimeFormat = legacyArrayWorktimeFormat;

function legacyArrayWorktimeFormat(worktimes)
{
  const arrayTimes = [];
  for (const wt of Object.keys(worktimes))
    arrayTimes.push({ name: wt, versions: worktimes[wt].versions });
  return arrayTimes;
}

const worktimes = {
  'map-basic': { versions: ['1.0.0'] },
  'pyodide': { versions: ['0.23.2'] },
};

function registerWorktime(name, version)
{
  if (!globalThis.worktimes[name])
    globalThis.worktimes[name] = { versions: [] };
  globalThis.worktimes[name].versions.push(version);
}

// nodejs-like environment
if (typeof module?.exports === 'object')
  exports.worktimes        = legacyArrayWorktimeFormat(worktimes);
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
