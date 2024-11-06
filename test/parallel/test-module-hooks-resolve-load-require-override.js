'use strict';
// Flags: --experimental-strip-types
// This tests that a mini TypeScript loader works with resolve and
// load hooks when overriding --experimental-strip-types

require('../common');
const assert = require('assert');

// Test inline require().
require('../fixtures/module-hooks/register-typescript-hooks.js');
const { UserAccount } = require('../fixtures/module-hooks/user.ts');
assert.strictEqual((new UserAccount('foo', 1).name), 'foo');
