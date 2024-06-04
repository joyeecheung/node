'use strict';

require('../common');
const assert = require('assert');
const fixtures = require('../common/fixtures');
const { readFileSync } = require('fs');

const {
  load, revert, matcherArgs, hookArgs,
} = require('../fixtures/es-modules/module-hooks/load-with-load-hook');

const foo = load('foo');
const filename = fixtures.path('es-modules', 'module-hooks', 'node_modules', 'foo', 'foo.js');
assert.deepStrictEqual(matcherArgs, [filename]);
const code = readFileSync(filename, 'utf-8');
assert.deepStrictEqual(hookArgs, [{ code, filename }]);
assert.deepStrictEqual(foo, { hello: 'earth' });

revert();

// Later loads are unaffected.
const bar = load('bar');
assert.deepStrictEqual(matcherArgs, [filename]);
assert.deepStrictEqual(hookArgs, [{ code, filename }]);
assert.deepStrictEqual(bar, { hello: 'world' });
