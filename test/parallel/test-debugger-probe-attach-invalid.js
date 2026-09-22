// This tests that probe mode rejects malformed --pid, --host and --port usage.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const { assertProbeCliError } = require('../common/debugger-probe');

const probe = ['--probe', 'app.js:1', '--expr', 'x'];

// --pid with a child script.
assertProbeCliError(
  [...probe, '--pid', '123', 'app.js'],
  /--pid cannot be combined with a child script/);

// --host with a child script.
assertProbeCliError(
  [...probe, '--host', '127.0.0.1', 'app.js'],
  /--host is only valid when attaching/);

// --port 0 without a script selects attach mode, where 0 is not connectable.
assertProbeCliError(
  [...probe, '--port', '0'],
  /Invalid inspector port for attach: 0/);

// No script and no address flag.
assertProbeCliError(
  probe,
  /Probe mode requires a child script, or --pid, --port or --host to attach to a running process/);

// Non-numeric --pid.
assertProbeCliError(
  [...probe, '--pid', 'abc'],
  /Invalid pid: abc/);

// Duplicate --pid.
assertProbeCliError(
  [...probe, '--pid', '123', '--pid', '124'],
  /Duplicate --pid/);

// Duplicate --host.
assertProbeCliError(
  [...probe, '--host', '127.0.0.1', '--host', 'localhost'],
  /Duplicate --host/);
