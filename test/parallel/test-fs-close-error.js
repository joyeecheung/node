'use strict';
const common = require('../common');
const assert = require('assert');
const fs = require('fs');

common.expectsError(
  () => {
    fs.closeSync('test');
  },
  {
    code: 'ERR_INVALID_ARG_TYPE',
    type: TypeError,
    message: 'The "fd" argument must be of type integer'
  }
);

common.expectsError(
  () => {
    fs.close('test');
  },
  {
    code: 'ERR_INVALID_ARG_TYPE',
    type: TypeError,
    message: 'The "fd" argument must be of type integer'
  }
);

assert.throws(
  () => { fs.closeSync(-1); },
  (err) => {
    assert.strictEqual(err.code, 'EBADF');
    assert.strictEqual(
      err.message,
      'EBADF: bad file descriptor, close'
    );
    assert.strictEqual(err.constructor, Error);
    return true;
  }
);

fs.close(-1, common.mustCall((err) => {
  assert.strictEqual(err.code, 'EBADF');
  assert.strictEqual(
    err.message,
    'EBADF: bad file descriptor, close'
  );
  assert.strictEqual(err.constructor, Error);
}));
