'use strict';

require('../common');
const fixtures = require('../common/fixtures.js');
const { spawnSyncAndAssert } = require('../common/child_process.js');

spawnSyncAndAssert(process.execPath,
                   [
                     '--require',
                     fixtures.path('module-hooks', 'transpiler-hooks.js'),
                     fixtures.path('module-hooks', 'log-user.ts'),
                   ], {
                     trim: true,
                     stdout: 'UserAccount { name: \'john\', id: 100 }'
                   });
