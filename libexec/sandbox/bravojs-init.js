/**
 *  @file       worker/evaluator-lib/bravojs-init.js
 *              Copyright (c) 2020-2022, Distributive, Ltd. All Rights Reserved.
 *
 *              This file sets up the environment for BravoJS to load properly.
 *
 *  @author     Ryan Rossiter, ryan@kingsds.network
 *  @date       Sept 2020
 */

self.wrapScriptLoading({ scriptName: 'bravojs-init' }, function bravojsInit$$fn(protectedStorage)
{
  self.bravojs = {
    url: '/bravojs/bravo.js',
    mainModuleDir: '.'
  }
});
