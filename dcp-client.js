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

  console.log(`%c
   _____ _____ ___________   _   
  /  ___|_   _|  _  | ___ \\ | |  
  \\ \`--.  | | | | | | |_/ / | |  
   \`--. \\ | | | | | |  __/  |_|  
  /\\__/ / | | \\ \\_/ / |      _   
  \\____/  \\_/  \\___/\\_|     |_|  
                                    
%c
The console is a browser feature intended for developers. If somebody told you to paste something here it may be a scam and your information could be stolen. Help us keep security in mind and keep your keystores safe.
  ~ DCP Team

https://distributed.computer/`, "font-weight: bold; font-size: 1.2em; color: #00a473;", "font-size: 1.2em;");

  var _dcpConfig = typeof dcpConfig === 'object' ? dcpConfig : undefined;
  
  {
    let allScripts = document.getElementsByTagName('SCRIPT');
    let thisScript = allScripts[allScripts.length - 1];
    let thisScriptURL = new URL(thisScript.src)
    let schedulerURL;
    let dcpConfigHref = thisScript.getAttribute('dcpConfig');
    let configScript;
    
    if (_dcpConfig && _dcpConfig.scheduler && _dcpConfig.scheduler.location && _dcpConfig.scheduler.location.href)
      schedulerURL = new URL(_dcpConfig.scheduler.location.href);
    else if (thisScript.getAttribute('scheduler'))
      schedulerURL = new URL(thisScript.getAttribute('scheduler'));

    if (!dcpConfigHref) {
      if (schedulerURL)
        dcpConfigHref = schedulerURL.origin + schedulerURL.pathname + 'etc/dcp-config.js' + (schedulerURL.search || thisScriptURL.search);
      else
        dcpConfigHref = thisScriptURL.origin + thisScriptURL.pathname.replace(/\/dcp-client\/dcp-client.js$/, '/etc/dcp-config.js') + thisScriptURL.search;
    }

    /** Load dcp-config.js from scheduler, and merge with running dcpConfig */
    function loadConfig()
    {
      configScript = document.createElement('SCRIPT');
      configScript.setAttribute('type', 'text/javascript');
      configScript.setAttribute('src', dcpConfigHref);
      configScript.setAttribute('id', '_dcp_config');

      if (!thisScript.id)
        thisScript.id = '_dcp_client_loader';

      let html = configScript.outerHTML;

      /* If we know about an alternate scheduler location - by any means but usually script attribute -
       * add it into our local configuration delta; generate this delta as-needed.
       */
      if (schedulerURL)
      {
        if (!_dcpConfig)
          _dcpConfig = {};
        if (!_dcpConfig.scheduler)
          _dcpConfig.scheduler = {};
        _dcpConfig.scheduler.location = schedulerURL;
      }

      /* Preserve the config delta so that it can be merged on top of the remote config, before the
       * bundle is completely initialized. The global dcpConfig is replaced by this new script.
       */
      if (_dcpConfig)
      {
        thisScript.mergeConfig = mergeConfig;
        html += `<script>document.getElementById('${thisScript.id}').mergeConfig();</scr` + 'ipt>';
      }

      document.write(html);
      configScript.onerror = (function(e) {
        alert('Error DCP-1001: Could not load or parse scheduler configuration from URL ("' + configScript.getAttribute('src') + '")');
        console.error('dcpConfig load error: ', e);
      }).toString();
    }

    function mergeConfig()
    {
      leafMerge(dcpConfig, _dcpConfig);

      function leafMerge() /* lifted from dcp-client obj-merge.js c32e780fae88071df1bb4aebe3282220d518260e */
      {
        var target = {};

        for (let i=0; i < arguments.length; i++)
        {
          let neo = arguments[i];
          if (neo === undefined)
            continue;

          for (let prop in neo)
          {
            if (!neo.hasOwnProperty(prop))
              continue;
            if (typeof neo[prop] === 'object' && neo[prop] !== null && !Array.isArray(neo[prop]) && ['Function','Object'].includes(neo[prop].constructor.name))
              target[prop] = leafMerge(target[prop], neo[prop]);
            else
              target[prop] = neo[prop];
          }
        }

        return target;
      }
    }

    /* Shim to make CommonJS Modules/2.0d8 environment (BravoJS, NobleJS) work with dcpClient in requireNative mode */
    function loadCJS2Shim()
    {
      var shimScript = document.createElement('SCRIPT');
      var shimSrc = thisScript.getAttribute("shim") || (thisScript.src.replace('/dcp-client.js', '/cjs2-shim.js'));
      var tmp;
      
      shimScript.setAttribute('type',    'text/javascript');
      shimScript.setAttribute('src',     shimSrc);
      shimScript.setAttribute('id',      '_dcp_client_cjs2_shim');
      shimScript.setAttribute('dcp-env', 'vanilla-web');
      shimScript.setAttribute('onerror', `alert('Error DCP-1003: Could not load cjs2 shim from URL ("${shimSrc}")')`);

      document.write(shimScript.outerHTML);
    }

    /** 
     * This function is never run directly; it is stringified and emitted in a 
     * SCRIPT tag that is injected into the document. As such, it cannot close 
     * over any non-global variables.
     */
    function bundleReadyIIFE() {
      const configScript = document.getElementById("_dcp_config");
      const bundleScript = document.getElementById("_dcp_client_bundle");
      const ready        = bundleScript.getAttribute('onready');
      const dcp          = bundleScript.exports;
      const leafMerge    = dcp.utils.leafMerge;
      const KVIN         = new dcp.kvin.KVIN();

      if (typeof module !== 'undefined' && typeof module.declare !== 'undefined')
        require('/internal/dcp/cjs2-shim').init(bundleScript.exports); /* CommonJS Modules/2.0d8 environment (BravoJS, NobleJS) */
      else
        window.dcp = dcp; /* vanilla JS */

      /** Let protocol know where we got out config from, so origin can be reasoned about vis a vis security */
      dcp.protocol.setSchedulerConfigLocation_fromScript(configScript);

      /**
       * Slide baked-in config underneath the remote config to provide default values.
       */
      KVIN.userCtors.dcpUrl$$DcpURL  = dcp['dcp-url'].DcpURL;
      KVIN.userCtors.dcpEth$$Address = dcp.wallet.Address;
      dcpConfig = dcp['dcp-config'] = dcp.utils.leafMerge(KVIN.unmarshal(dcp['dcp-default-config']), dcp['dcp-config']);

      /**
       * Transform instances of Address-like values into Addresses. Necessary since
       * the config can't access the Address class before the bundle is loaded.
       */ 
      dcp.wallet.Address.patchUp(dcpConfig);
      dcp['dcp-url'].patchup(dcpConfig);

      if (ready)
        window.setTimeout(function bundleReadyFire() { let indirectEval=eval; indirectEval(ready) }, 0);
    }

    /* Load dcp-client bundle from the same location as this module, extract the exports 
     * from it, and attach them to the global dcp object.
     */
    function loadBundle(shimCallback) {
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
      document.write(`<script id='_dcp_bundleReadyIIFE'>/* bundleReadyIIFE */;(${bundleReadyIIFE})()</scr` + `ipt>`);
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

    let shimCallback;
    if (typeof module === 'object' && typeof module.declare === 'function')
      shimCallback = loadCJS2Shim(); /* BravoJS, NobleJS, etc - set up for requireNative */

    loadConfig();
    loadBundle(shimCallback);
    loadLinks();
  }
})();
 
