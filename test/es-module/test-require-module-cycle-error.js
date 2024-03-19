// Flags: --experimental-require-module
'use strict';

const common = require('../common');
const assert = require('assert');

(async () => {
  let error;
  try {
    await import('../fixtures/es-modules/esm-cjs-esm-cycle-error/b.mjs');
  } catch (e) {
    error = e;
  }
  assert.notStrictEqual(error, undefined);

  error = undefined;
  try {
    await import('../fixtures/es-modules/esm-cjs-esm-cycle-error/d.mjs');
  } catch (e) {
    error = e;
  }
  assert.notStrictEqual(error, undefined);
})().then(common.mustCall());
