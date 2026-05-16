// This tests that a probe expression closing the inspector mid-session
// surfaces as probe_inspector_failure, with downstream probes left pending.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { spawnSyncAndExit } = require('../common/child_process');
const { assertProbeJson } = require('../common/debugger-probe');

const cwd = fixtures.path('debugger');
const fixture = 'probe-inspector-close-two-probes.js';
const marker = 'probe-inspector-close-marker';
const timeoutMs = common.platformTimeout(1000);
const probes = [
  { expr: 'closeInspector()', target: { suffix: fixture, line: 13 } },
  { expr: 'firstProbeLine', target: { suffix: fixture, line: 14 } },
];
const location = { url: fixtures.fileURL('debugger', fixture).href, line: 13, column: 24 };

spawnSyncAndExit(process.execPath, [
  'inspect', '--json', `--timeout=${timeoutMs}`,
  '--probe', `${fixture}:13`, '--expr', probes[0].expr,
  '--probe', `${fixture}:14`, '--expr', probes[1].expr,
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
        error: { message: 'Probe evaluation did not complete' },
      }, {
        event: 'error',
        pending: [1],
        error: {
          code: 'probe_inspector_failure',
          message:
            `Probe session timed out before probes: ${fixture}:14. ` +
            'The probe expression may be slow, hanging, or interfering ' +
            'with the inspector connection. Try increasing `--timeout`; ' +
            'if the failure persists, review the probe expressions.',
          probe: 0,
          stderr: marker,
          details: { lastCdpMethod: 'Debugger.evaluateOnCallFrame' },
        },
      }],
    });
  },
  trim: true,
});
