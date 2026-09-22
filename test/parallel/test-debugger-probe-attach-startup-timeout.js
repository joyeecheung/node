// This tests that --timeout bounds the startup of an attach session when the target's main thread
// is blocked and never answers Runtime.enable.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const { runAttachedProbe } = require('../common/debugger-probe');

runAttachedProbe('probe-attach-blocked.js', [
  '--timeout', '1000', '--probe', 'probe-attach-blocked.js:5', '--expr', '1',
], {
  status: 1,
  report: {
    v: 2,
    probes: [{ expr: '1', target: { suffix: 'probe-attach-blocked.js', line: 5 }, locations: [] }],
    results: [{
      event: 'error',
      pending: [0],
      error: {
        code: 'probe_failure',
        message: 'Timed out after 1000ms waiting for the target to respond before probes: probe-attach-blocked.js:5. ' +
          'Its main thread may be blocked in synchronous work. Try increasing `--timeout`.',
        details: { lastCdpMethod: 'Runtime.enable' },
      },
    }],
  },
}).then(common.mustCall());
