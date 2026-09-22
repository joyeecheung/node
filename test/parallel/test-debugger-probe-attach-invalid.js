// This tests that probe mode rejects malformed --attach and --pid usage.
'use strict';

const common = require('../common');
common.skipIfInspectorDisabled();

const { assertProbeCliError } = require('../common/debugger-probe');

const probe = ['--probe', 'app.js:1', '--expr', 'x'];

// --attach with a child script.
assertProbeCliError(
  [...probe, '--attach', '127.0.0.1:9229', 'app.js'],
  /--pid and --attach cannot be combined with a child script/);

// --pid with a child script.
assertProbeCliError(
  [...probe, '--pid', '123', 'app.js'],
  /--pid and --attach cannot be combined with a child script/);

// --pid and --attach together.
assertProbeCliError(
  [...probe, '--pid', '123', '--attach', '127.0.0.1:9229'],
  /--pid and --attach are mutually exclusive/);

// --attach and --port together.
assertProbeCliError(
  [...probe, '--attach', '127.0.0.1:9229', '--port', '9230'],
  /--attach and --port are mutually exclusive/);

// Malformed --attach target.
assertProbeCliError(
  [...probe, '--attach', 'localhost'],
  /--attach requires <host>:<port>/);

// Non-numeric --pid.
assertProbeCliError(
  [...probe, '--pid', 'abc'],
  /Invalid pid: abc/);

// Duplicate --attach.
assertProbeCliError(
  [...probe, '--attach', '127.0.0.1:9229', '--attach', '127.0.0.1:9230'],
  /Duplicate --attach/);

// Duplicate --pid.
assertProbeCliError(
  [...probe, '--pid', '123', '--pid', '124'],
  /Duplicate --pid/);
