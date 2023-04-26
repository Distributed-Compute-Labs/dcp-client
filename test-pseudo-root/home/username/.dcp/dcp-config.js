/**
 * @file        tests-homedir/.dcp/dcp-client/dcp-config.js
 *              a dcp config frame file for the tests to use with homedir overrides
 * @author      Wes Garland, wes@kingds.network
 * @date        Aug 2020
 */
// Note: we are also using these test configs to test accepted forms
// this file tests that we can use global keys like 'scheduler' and that
// we can return an object
const bootstrapConfig = require('dcp/dcp-config');
dcpConfig.bank.location = bootstrapConfig.bank.location;
dcpConfig.bank.location.pathname = '/from/tests-homedir/dcp-client/dcp-config';

return {
  "homeDir": "in-homedir",
  "homeDirProgramName": "in-homedir",
  "etcOverriden": "in-homedir",
  "etcProgramNameOverridden": "in-homedir",
  "homeDirOverridden": "in-homedir",
  "homeDirProgramNameOverriden": "in-homedir"
}
