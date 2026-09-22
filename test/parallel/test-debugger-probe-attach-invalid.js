// This tests that probe mode rejects malformed --pid, --host and --port usage.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const { assertProbeCliError } = require('../common/debugger-probe');

const probe = ['--probe', 'app.js:1', '--expr', 'x'];

assertProbeCliError([...probe, '--pid', '123', 'app.js'], /--pid and --host cannot be combined with a child script/);
assertProbeCliError([...probe, '--host', '127.0.0.1', 'app.js'], /--pid and --host cannot be combined with a child script/);

// --port 0 without a script selects attach mode, where 0 is not connectable.
assertProbeCliError([...probe, '--port', '0'], /Invalid inspector port for attach: 0/);
assertProbeCliError(probe,
                    /Probe mode requires a child script, or --pid, --port or --host to attach to a running process/);
assertProbeCliError([...probe, '--pid', 'abc'], /Invalid pid: abc/);
assertProbeCliError([...probe, '--pid', '123', '--host', '10.0.0.1'],
                    /--pid requires a loopback --host, got 10\.0\.0\.1\. The target process must be local/);
