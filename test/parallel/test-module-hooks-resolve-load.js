'use strict';

require('../common');
const assert = require('assert');

// Test inline require().
require('../fixtures/module-hooks/transpiler-hooks.js');
const { UserAccount } = require('../fixtures/module-hooks/user.ts');
assert.strictEqual(typeof UserAccount, 'function');
