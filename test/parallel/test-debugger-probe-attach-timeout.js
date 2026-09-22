// This tests that an attach session without --max-hit ends at --timeout with exit 0, listing the
// probes that never hit. Their `locations` distinguish a probe on code that did not run from a
// probe that matched no script.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { runAttachedProbe } = require('../common/debugger-probe');

// The deadline also bounds the startup of the session, so leave room for a slow machine.
const timeout = common.platformTimeout(2000);

// Line 14 only runs at startup.
runAttachedProbe('probe-attach-loop.js', [
  '--timeout', `${timeout}`,
  '--probe', 'probe-attach-loop.js:14', '--expr', '1',
  '--probe', 'no-such-file.js:14', '--expr', '1',
], {
  status: 0,
  report: {
    v: 2,
    probes: [{
      expr: '1', target: { suffix: 'probe-attach-loop.js', line: 14 },
      locations: [{ url: fixtures.fileURL('debugger', 'probe-attach-loop.js').href, line: 14, column: 1 }],
    }, { expr: '1', target: { suffix: 'no-such-file.js', line: 14 }, locations: [] }],
    results: [{
      event: 'timeout',
      pending: [0, 1],
      error: {
        code: 'probe_timeout',
        message: `Session timed out after ${timeout}ms waiting for probes: probe-attach-loop.js:14, ` +
          'no-such-file.js:14, detaching from the target',
      },
    }],
  },
}).then(common.mustCall());
