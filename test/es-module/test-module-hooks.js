'use strict';

require('../common');
const fixtures = require('../common/fixtures');
const { spawnSyncAndAssert } = require('../common/child_process');
const assert = require('assert');

spawnSyncAndAssert(process.execPath,
                   [
                     '--require',
                     fixtures.path('es-modules', 'module-hooks', 'transpiler-hooks.js'),
                     fixtures.path('es-modules', 'module-hooks', 'log-user.ts'),
                   ], {
                     trim: true,
                     stdout: 'UserAccount { name: \'john\', id: 100 }'
                   });

// Test inline require().
require('../fixtures/es-modules/module-hooks/transpiler-hooks.js');
const { UserAccount } = require('../fixtures/es-modules/module-hooks/user.ts');
assert.strictEqual(typeof UserAccount, 'function');

// TODO(joyeecheung): test chaining hooks, maybe a transpiler + a test thing
// TODO(joyeecheung): test error paths?
// TODO(joyeecheung): test manipulation of file paths.
