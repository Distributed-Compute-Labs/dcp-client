/** 
 *  @file       cjs2-init.js            dcp-client initialization code for CommonJS Modules/2.0 environments.
 *  @author     Wes Garland, wes@kingsds.network
 *  @date       Aug 2019
 */

(function initIIFE()
{
  var thisUrl = new URL(document.currentScript.src);
  
  require.paths.push('/internal');
  require.paths.push('/webpack');

  require.memoize('/internal/dcp/env-native', [], function envNative (_require, exports, _module) { exports.platform = bravojs ? "bravojs" : "cjs2-generic" });
  require.memoize('/internal/tty',            [], function tty       (_require, exports, _module) { exports.isatty = () => false });

  function init(dcp)
  {
    for (let moduleName of Object.keys(dcp))
      require.memoize('/webpack/dcp/' + moduleName, [], (_require, exports, module) => { module.exports = dcp[moduleName] });
  }

  require.memoize('/internal/dcp/cjs2-shim', [], function cjs2Shim (_require, exports, _module) { exports.init = init; });
})();
