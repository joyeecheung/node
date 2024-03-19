'use strict';

require('../common');
const assert = require('assert');

// Test inline require().
require('../fixtures/es-modules/module-hooks/transpiler-hooks.js');
const { UserAccount } = require('../fixtures/es-modules/module-hooks/user.ts');
assert.strictEqual(typeof UserAccount, 'function');

// TODO(joyeecheung): test chaining hooks, maybe a transpiler + a test thing
// TODO(joyeecheung): test error paths?
// TODO(joyeecheung): test manipulation of file paths.
