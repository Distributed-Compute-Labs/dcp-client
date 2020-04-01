/**
 *  @file       dcp-client.js
 *              Interface/loader for web browser consumers of the dcp-client bundle.
 *
 *              Once this script has been loaded in a vanilla-web environment, the dcp and dcpConfig
 *              symbols should be available to any scripts below this one in the DOM tree. This
 *              script is also aware of the following attributes on its own SCRIPT tag:
 *              - onload:    code to run when completely loaded; dcpConfig will be defined.
 *              - onready:   same as onload, but dcp is also defined.
 *              - scheduler: set the URL for the scheduler, also used to locate dcpConfig
 *              - bundle:    set the URL for the bundle to load, default is the one in this directory
 *  @author     Wes Garland, wes@kingsds.network
 *  @date       Aug 2019
 */
(function namespaceIIFE() {
  var _dcpConfig = typeof dcpConfig === 'object' ? dcpConfig : undefined;
  
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
    let thisScriptURL = new URL(thisScript.src)
    let schedulerURL;
    let dcpConfigHref;

    if (_dcpConfig && _dcpConfig.scheduler && _dcpConfig.scheduler.location && _dcpConfig.scheduler.location.href)
      schedulerURL = new URL(_dcpConfig.scheduler.location.href);
    else if (thisScript.getAttribute('scheduler'))
      schedulerURL = new URL(thisScript.getAttribute('scheduler'));

    if (schedulerURL)
      dcpConfigHref = schedulerURL.origin + schedulerURL.pathname + 'etc/dcp-config.js' + (schedulerURL.search || thisScriptURL.search);
    else
      dcpConfigHref = thisScriptURL.origin + thisScriptURL.pathname.replace(/\/dcp-client\/dcp-client.js$/, '/etc/dcp-config.js') + thisScriptURL.search;

    /** Load dcp-config.js from scheduler, and merge with running dcpConfig */
    function loadConfig() {
      var configScript = document.createElement('SCRIPT');
      configScript.setAttribute('type', 'text/javascript');
      configScript.setAttribute('src', dcpConfigHref);
      configScript.setAttribute('id', '_dcp_config');
      if (_dcpConfig) { /* Preserve local configuration as overrides */
        if (!thisScript.id)
          thisScript.id='_dcp_client_loader';
        thisScript.localDcpConfig = _dcpConfig;
        document.write(configScript.outerHTML +
                       `<script>Object.assign(dcpConfig, document.getElementById('${thisScript.id}').localDcpConfig);</scr`+`ipt>`
                      );
      } else {
        document.write(configScript.outerHTML);
      }
      configScript = document.getElementById(configScript.id);
      configScript.onerror = function(e) {
        alert('Error DCP-1001: Could not load or parse scheduler configuration from URL ("' + configScript.getAttribute('src') + '")');
        console.error('dcpConfig load error: ', e);
      };
    }
    
    /* Load dcp-client bundle from the same lcoation as this module, extract the exports 
     * from it, and attach them to the global dcp object.
     */
    function loadBundle() {
      var bundleScript = document.createElement('SCRIPT');
      var bundleSrc = thisScript.getAttribute("bundle") || (thisScript.src.replace('/dcp-client.js', '/dist/dcp-client-bundle.js'));
      var tmp;
      
      bundleScript.setAttribute('type', 'text/javascript');
      bundleScript.setAttribute('src', bundleSrc);
      bundleScript.setAttribute('id', '_dcp_client_bundle');
      bundleScript.setAttribute('dcp-env', 'vanilla-web');
      bundleScript.setAttribute('onerror', `alert('Error DCP-1002: Could not load dcp-client bundle from URL ("${bundleSrc}")')`);
      bundleScript.setAttribute('onload', thisScript.getAttribute('onload'));
      thisScript.removeAttribute('onload');
      bundleScript.setAttribute('onready', thisScript.getAttribute('onready'));
      thisScript.removeAttribute('onready');
      document.write(bundleScript.outerHTML);
      document.write(`<script>
;(function bundleReadyIIFE() {
  let bundleScript = document.getElementById("_dcp_client_bundle");
  let ready = bundleScript.getAttribute('onready');
  window.dcp = bundleScript.exports;
  if (ready)
    window.setTimeout(function bundleReadyFire() { let indirectEval=eval; indirectEval(ready) }, 0);
})();
</scr` + `ipt>`);  
      bundleScript = document.getElementById('_dcp_client_bundle');
      if (bundleScript)
        bundleScript.onerror = function(e) {
          console.error('Bundle load error:', e);
          bundleScript.removeAttribute('onready');
        };
    }

    /* Load the modal stylesheet
     *  Add our favicon (unless they've already got one)
     */
    function loadLinks () {
      const head = document.getElementsByTagName('head')[0];
      let styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = thisScript.src.replace('/dcp-client.js', '/templates/dcp-modal.css');
      head.prepend(styleLink);

      if (document.querySelector("link[rel*='icon']")) return
      let faviconLink = document.createElement('link');
      faviconLink.type = 'image/x-icon';
      faviconLink.rel = 'shortcut icon';
      faviconLink.href = thisScript.src.replace('/dcp-client.js', '/favicon.ico');
      head.appendChild(faviconLink);
    }
  }

  loadConfig();
  loadBundle();
  loadLinks();
})();
