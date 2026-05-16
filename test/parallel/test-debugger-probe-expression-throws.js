// This tests that a probe expression throwing an exception is recorded as
// a per-hit error and does not fail the session.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const fixtures = require('../common/fixtures');
const { spawnSyncAndExit } = require('../common/child_process');
const { assertProbeJson } = require('../common/debugger-probe');

const cwd = fixtures.path('debugger');
const fixture = 'probe-paused-target.js';
const timeoutMs = common.platformTimeout(500);
const probes = [{ expr: '(() => { throw new Error("boom"); })()', target: { suffix: fixture, line: 3 } }];
const location = { url: fixtures.fileURL('debugger', fixture).href, line: 3, column: 1 };

spawnSyncAndExit(process.execPath, [
  'inspect', '--json', `--timeout=${timeoutMs}`,
  '--probe', `${fixture}:3`, '--expr', probes[0].expr,
  fixture,
], { cwd }, {
  // Session continues until --timeout fires.
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
        error: {
          message: 'Error: boom\n<stack>',
          details: {
            exception: {
              exceptionId: 1,
              text: 'Uncaught',
              lineNumber: 0,
              columnNumber: 9,
              scriptId: '<scriptId>',
              stackTrace: { callFrames: '<callFrames>' },
              exception: { type: 'object', subtype: 'error', description: 'Error: boom\n<stack>' },
            },
          },
        },
      }, {
        event: 'timeout',
        pending: [],
        error: {
          code: 'probe_timeout',
          message: `Timed out after ${timeoutMs}ms waiting for target completion`,
        },
      }],
    });
  },
  trim: true,
});
