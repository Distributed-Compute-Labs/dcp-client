#! /usr/bin/env node
/** 
 * @file      events.html
 *
 *            Sample NodeJS application showing how to deploy a minimal DCP job.
 * @author    Wes Garland, wes@kingsds.network
 * @date      Aug 2019
 */ 
async function main() {
  const compute = require('dcp/compute')
  let results

  results = await compute.for(1, 10,
                              function(i) {
                                let result = i*3
                                console.log(`Calculated result for slice #${i}`)
                                progress(i/10)
                                return result
                              }).exec(compute.marketValue)

  console.log(results)
}

require('dcp-client').init().then(main).finally(() => setImmediate(process.exit))
