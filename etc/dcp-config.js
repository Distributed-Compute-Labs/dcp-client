/**
 * @file        dcp-config.js
 *              Bare-bones config for worker loaded. For use with localexec,
 *              or so the tree exists for 
 *
 * @author      Ryan Saweczko <ryan@kingsds.network>
 * @date        Sep 2022
 */

return {
  worker: {
    /* Allow lists permitting supervisor network access beyond DCP messages to services */
    allowOrigins: {
      any: [],
      fetchWorkFunctions: [],
      fetchArguments: [],
      fetchData: [],
      sendResults: [],
    },

    minimumWage: {
      CPU:  0,
      GPU:  0,
      'in': 0,
      out:  0,
    },

    computeGroups: {},              // integer-one-indexed; format is 1:{ joinKey,joinHash } or 2:{ joinKey, joinSecret }
    jobAddresses: [],               // Specific job addresses the worker may work on. If not empty, worker will only work on those jobs.
    maxWorkingSandboxes: 1,
    paymentAddress: null,    // user must to specify
    evaluatorOptions: {}
  },

  standaloneWorker:
  {
    quiet: false,
    debug: process.env.DCP_SAW_DEBUG,
    evaluatorConnectBackoff:
    {
      maxInterval:   5 * 60 * 1000, // max: 5 minutes
      baseInterval:      10 * 1000, // start: 10s
      backoffFactor: 1.1            // each fail, back off by 10%
    },
    reloadBehaviour: 'process.exit(12)',
  },
}
 