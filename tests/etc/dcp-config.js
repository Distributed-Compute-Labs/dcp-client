/**
 * @file        etc/dcp-config.js
 *              DCP Config file fragment for the simple config test
 * @author      Wes Garland, wes@distributive.network
 * @date        Sep 2022
 */
{
  stack: {
    '/etc/dcp/dcp-config': 'should be overridden',
    './etc/dcp-config.js': 'yes',
    '/home/username/.dcp/dcp-config.js': undefined,
    '/home/username/.dcp/config.simple': undefined,
    '/home/username/.dcp/config-simple-scope': undefined,
    'initConfig': undefined,
    '/etc/dcp/override-dcp-config': undefined,
    '/etc/dcp/config-simple-scope': undefined,
  }
}
