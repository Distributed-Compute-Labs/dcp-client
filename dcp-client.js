/**
 *  @file       dcp-client.js
 *              Interface/loader for web browser consumers of the dcp-client bundle.
 *  @author     Wes Garland, wes@kingsds.network
 *  @date       Aug 2019
 */
(function namespaceIIFE() {
  if (typeof module !== 'undefined' && typeof module.declare !== 'undefined') {
    /* CommonJS Modules/2.0d8 environment (BravoJS, NobleJS) */
    module.declare(['./cjs2-init'], function (require, exports, module) {
      let other = require('./cjs2-init')
      Object.assign(exports, other)
      Object.setPrototypeOf(exports, Object.getPrototypeOf(other))
    })
  } else {
    let allScripts = document.getElementsByTagName('SCRIPT');
    let thisScript = allScripts[allScripts.length - 1];
    let localDcpConfig = typeof dcpConfig === 'object' ? dcpConfig : {};
    let schedulerDcpConfig;
    let schedulerBaseHref = (localDcpConfig && localDcpConfig.scheduler && localDcpConfig.scheduler.location && localDcpConfig.scheduler.location.href)
                         || thisScript.getAttribute('scheduler') && thisScript.getAttribute('scheduler').replace(/([^/])$/, '$1/')
                         || thisScript.src.replace(/\/dcp-client\/dcp-client.js$/, '/')

    /** Load dcp-config.js from scheduler, and merge with running dcpConfig */
    function loadConfig() {
      var configScript = document.createElement('SCRIPT');
      configScript.setAttribute('type', 'text/javascript');
      configScript.setAttribute('src', schedulerBaseHref + 'etc/dcp-config.js');
      configScript.setAttribute('id', '_dcp_config');
      document.write(configScript.outerHTML + `<script>Object.assign(dcpConfig, JSON.parse('${JSON.stringify(localDcpConfig)}'));</script>`);
    }
    
    /* Load dcp-client bundle from the same lcoation as this module, extract the exports 
     * from it, and attach them to the global dcp object.
     */
    function loadBundle() {
      var bundleScript = document.createElement('SCRIPT');
      bundleScript.setAttribute('type', 'text/javascript');
      bundleScript.setAttribute('src', thisScript.getAttribute("bundle") || (thisScript.src.replace('/dcp-client.js', '/dist/dcp-client-bundle.js')));
      bundleScript.setAttribute('id', '_dcp_client_bundle');
      bundleScript.setAttribute('dcp-env', 'vanilla-web');
      document.write(bundleScript.outerHTML + '<script>window.dcp = document.getElementById("_dcp_client_bundle").exports</script>');
    }
  }

  loadConfig();
  loadBundle();
})();
