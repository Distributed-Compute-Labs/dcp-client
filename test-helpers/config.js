/**
 * @file        config.js
 *              This is the actual test called for config-sync.tap and config-async.tap
 *
 * @author      KC Erb
 * @date        Jul 2020
 */
'use strict';
const { test } = require('zora');
const os = require('os');
const dcpConfig = require('dcp/dcp-config');

test('config order', function (t) {
  t.equal(dcpConfig.etcOnly, "in-etc");
  t.equal(dcpConfig.etcProgramName, "in-etc-config-tap");
  t.equal(dcpConfig.homeDir, "in-homedir");
  t.equal(dcpConfig.homeDirProgramName, "in-homedir-config-tap");
  t.equal(dcpConfig.etcOverriden, "in-override");
  t.equal(dcpConfig.etcProgramNameOverridden, "in-override");
  t.equal(dcpConfig.homeDirOverridden, "in-override");
  t.equal(dcpConfig.homeDirProgramNameOverriden, "in-override");
});

test('config language - can call `scheduler` global', function (t) {
  t.ok(dcpConfig.scheduler.canSetProgrammatically);
})

if (os.platform === 'win32') {
  test('check some of that registry stuff', function (t) {
    t.ok(false) // untested on windows!
  })
}
