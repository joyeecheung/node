// This tests that a probe expression resuming the target through its own
// inspector.Session surfaces as probe_failure when the outer
// Debugger.resume rejects.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { spawnSyncAndExit } = require('../common/child_process');
const { assertProbeJson } = require('../common/debugger-probe');

const cwd = fixtures.path('debugger');
const fixture = 'probe-paused-target.js';
const timeoutMs = common.platformTimeout(1000);
const probes = [{
  expr: '(() => { const { Session } = require(\'inspector\'); ' +
    'const session = new Session(); session.connect(); ' +
    'session.post(\'Debugger.resume\'); return 1; })()',
  target: { suffix: fixture, line: 3 },
}];
const location = { url: fixtures.fileURL('debugger', fixture).href, line: 3, column: 1 };

spawnSyncAndExit(process.execPath, [
  'inspect', '--json', `--timeout=${timeoutMs}`,
  '--probe', `${fixture}:3`, '--expr', probes[0].expr,
  fixture,
], { cwd }, {
  status: 1,
  signal: null,
  stdout(output) {
    assertProbeJson(output, {
      v: 2,
      probes,
      results: [{
        probe: 0,
        event: 'hit',
        hit: 1,
        location,
        result: { type: 'number', value: 1, description: '1' },
      }, {
        event: 'error',
        pending: [],
        error: {
          code: 'probe_failure',
          message:
            'Probe session failed after a probe evaluation. If the ' +
            'failure repeats, review the most-recently-evaluated probe ' +
            'expression.',
          probe: 0,
          stderr: '',
          details: {
            lastCdpMethod: 'Debugger.resume',
            protocolError: { message: 'Can only perform operation while paused.', code: -32000 },
          },
        },
      }],
    });
  },
  trim: true,
});
