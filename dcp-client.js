/**
 *  @file       dcp-client.js
 *              Interface/loader for web browser consumers of the dcp-client bundle.
 *  @author     Wes Garland, wes@kingsds.network
 *  @date       Aug 2019
 */

if (typeof module !== 'undefined' && typeof module.declare !== 'undefined') {
  /* CommonJS Modules/2.0 client */
  module.declare(['./cjs2-init'], function (require, exports, module) {
    let other = require('./cjs2-init')
    Object.assign(exports, other)
    Object.setPrototypeOf(exports, Object.getPrototypeOf(other))
  })
} else {
  if (typeof dcpConfig === 'undefined') {
    console.warn('Warning: dcpConfig is undefined')
  }
  
  /* Load dcp-client bundle, extract the exports from it, and attach them 
   * to the global dcp
   */
  (async function () {
    try {
      return await new Promise(function(resolve, reject) {
        var allScripts = document.getElementsByTagName('SCRIPT')
        var thisScript = allScripts[allScripts.length - 1]
        var bundleScript = document.createElement("SCRIPT")
        bundleScript.setAttribute("type", "text/javascript")
        bundleScript.setAttribute("src", thisScript.src.replace('/dcp-client.js', '/dist/dcp-client-bundle.js'))
        bundleScript.setAttribute("id", "_dcp_client_bundle")
        bundleScript.onabort = function dcpClient$$loadAbortCB(ev) {
          reject('aborted bundle load')
        }
        bundleScript.onerror = function dcpClient$$loadErrorCB(ev) {
          let e = new Error("Could not load dcp-client bundle " + bundleScript.getAttribute('src') + ' (' + (typeof ev.message !== 'undefined' ? ev.message : "") +')')
          reject(e)
        }
        bundleScript.onload = function dcpClient$$loadCB(ev) {
          window.dcp = bundleScript.exports
          resolve('loaded bundle')
        }
        document.getElementsByTagName('head')[0].appendChild(bundleScript)
      })
    } catch(e) {
      console.log('dcp-client bundle load failure: ', e)
      alert('dcp-client bundle load failure: ' + (typeof e === 'string' ? e : e.message))
    }
  })()                       
}
