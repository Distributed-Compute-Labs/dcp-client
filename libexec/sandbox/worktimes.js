//self.wrapScriptLoading({ scriptName: 'worktimes' }, function worktimes$$fn(protectedStorage, _ring2PostMessage) {
//// 
function worktimes$$fn(protectedStorage, _ring2PostMessage)
{



//const global = typeof globalThis === 'undefined' ? self : globalThis;
const global = globalThis;

global.WORKTIMES_JS_LOADED = true;

const worktimes = [
  {
    name: 'map-basic',
    versions: ['1.0.0']
  },
  {
    name: 'pyodide',
    versions: ['0.23.2']
  }
];

/*
const ring2PostMessage = self.postMessage

function print(str)
{
ring2PostMessage({
  data: str,
  request: 'willpringle',
});
}
*/
function print(str) {};

print('inside the thing =- the whatever, worktimes.js' + worktimes);


function registerWorktime(name, version)
{
  print(name + '  ' + version);
  for (const worktime of global.worktimes)
  {
    if (worktime.name.toLowerCase() === name.toLowerCase())
    {
      if (!worktime.versions.includes(version))
      {
        worktime.versions.push(version);
        print("COuldn't find worktime --- \nsevern, we never get here...");
      }
      else
      {
        //worktime.versions = [ ...worktime.versions ];
        print("FOUND THE WORKTIME (: ");
      }
      return;
    }
  }

  //global.worktimes.push({ name, versions: [ version ] });
}


// nodejs-like environment
if (typeof module.exports === 'object')
{
  exports.worktimes        = worktimes;
  exports.registerWorktime = registerWorktime;
}
// inside the sandbox
else
{
  global.worktimes        = worktimes;
  global.registerWorktime = registerWorktime;
}

}
////
//});

// nodejs-like environment
if (typeof module.exports === 'object')
  worktimes$$fn();
// inside the sandbox
else
  self.wrapScriptLoading({ scriptName: 'worktimes' }, worktimes$$fn);
