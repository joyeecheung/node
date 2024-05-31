'use strict';

require('../common');
const assert = require('assert');
const { load, hook } = require('../fixtures/es-modules/module-hooks/load-with-exports-hook');

const foo = load('foo');
assert.deepStrictEqual(foo, { hello: 'world', _version: '1.0.0' });

hook.unhook();

const bar = load('bar');
assert.deepStrictEqual(bar, { hello: 'world' });
