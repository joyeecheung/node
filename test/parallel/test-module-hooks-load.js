'use strict';

const common = require('../common');
const assert = require('assert');
const fixtures = require('../common/fixtures');
const { readFileSync } = require('fs');

const {
  localRequire, localImport, revert, matcherArgs, hookArgs, register,
} = require('../fixtures/es-modules/module-hooks/load-with-load-hook');


(async() => {
  const revert = register();

  {
    const foo = localRequire('foo');
    const filename = fixtures.path('es-modules', 'module-hooks', 'node_modules', 'foo', 'foo.js')
    assert.deepStrictEqual(matcherArgs, [filename]);
    const code = readFileSync(filename, 'utf-8');
    assert.deepStrictEqual(hookArgs, [{ code, filename }]);
    assert.deepStrictEqual(foo, { hello: 'foo' });
  }

  matcherArgs.splice(0, 1);
  hookArgs.splice(0, 1);

  {
    const foo = await localImport('foo-esm');
    const filename = fixtures.path('es-modules', 'module-hooks', 'node_modules', 'foo-esm', 'foo-esm.js')
    assert.deepStrictEqual(matcherArgs, [filename]);
    const code = readFileSync(filename, 'utf-8');
    assert.deepStrictEqual(hookArgs, [{ code, filename }]);
    assert.deepStrictEqual({...foo}, { hello: 'foo-esm' });
  }

  matcherArgs.splice(0, 1);
  hookArgs.splice(0, 1);

  revert();

  // Later loads are unaffected.

  {
    const bar = localRequire('bar');
    assert.deepStrictEqual(matcherArgs, []);
    assert.deepStrictEqual(hookArgs, []);
    assert.deepStrictEqual(bar, { $key: 'bar' });
  }

  {
    const bar = await localImport('bar-esm');
    assert.deepStrictEqual(matcherArgs, []);
    assert.deepStrictEqual(hookArgs, []);
    assert.deepStrictEqual({...bar}, { $key: 'bar-esm' });
  }
})().catch(common.mustNotCall());
