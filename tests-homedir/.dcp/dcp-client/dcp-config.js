// Note: we are also using these test configs to test accepted forms
// this file tests that we can use global keys like 'scheduler' and that
// we can return an object
scheduler.location.pathname = '/from/tests-homedir/dcp-client/dcp-config';

return {
  "homeDir": "in-homedir",
  "homeDirProgramName": "in-homedir",
  "etcOverriden": "in-homedir",
  "etcProgramNameOverridden": "in-homedir",
  "homeDirOverridden": "in-homedir",
  "homeDirProgramNameOverriden": "in-homedir"
}
