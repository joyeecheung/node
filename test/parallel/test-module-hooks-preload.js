'use strict';

require('../common');
const fixtures = require('../common/fixtures.js');
const { spawnSyncAndAssert } = require('../common/child_process.js');

spawnSyncAndAssert(process.execPath,
                   [
                     '--require',
                     fixtures.path('module-hooks', 'register-typescript-hooks.js'),
                     fixtures.path('module-hooks', 'log-user.ts'),
                   ], {
                     trim: true,
                     stdout: 'UserAccount { name: \'john\', id: 100 }'
                   });

spawnSyncAndAssert(process.execPath,
                   [
                     '--import',
                     fixtures.path('module-hooks', 'register-typescript-hooks.js'),
                     fixtures.path('module-hooks', 'log-user.ts'),
                   ], {
                     trim: true,
                     stdout: 'UserAccount { name: \'john\', id: 100 }'
                   });
