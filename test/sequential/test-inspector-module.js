'use strict';

const common = require('../common');

common.skipIfInspectorDisabled();

const { Session } = require('inspector');

const session = new Session();

common.expectsError(
  () => session.post('Runtime.evaluate', { expression: '2 + 2' }),
  {
    code: 'ERR_INSPECTOR_NOT_CONNECTED',
    type: Error,
    message: 'Session is not connected'
  }
);

session.connect();
session.post('Runtime.evaluate', { expression: '2 + 2' });

[
  [1, 'number'],
  [{}, 'Object'],
  [[], 'Array'],
  [true, 'boolean'],
  [Infinity, 'number'],
  [undefined, 'undefined']
].forEach(([i, type]) => {
  common.expectsError(
    () => session.post(i),
    {
      code: 'ERR_INVALID_ARG_TYPE',
      type: TypeError,
      message:
        'The "method" argument must be of type string. ' +
        `Received type ${type}`
    }
  );
});

[
  [1, 'number'],
  [true, 'boolean'],
  [Infinity, 'number']
].forEach(([i, type]) => {
  common.expectsError(
    () => session.post('test', i),
    {
      code: 'ERR_INVALID_ARG_TYPE',
      type: TypeError,
      message:
        'The "params" argument must be of type Object. ' +
        `Received type ${typeof i}`
    }
  );
});

common.expectsError(
  () => session.connect(),
  {
    code: 'ERR_INSPECTOR_ALREADY_CONNECTED',
    type: Error,
    message: 'The inspector session is already connected'
  }
);

const session2 = new Session();
common.expectsError(
  () => session2.connect(),
  {
    code: 'ERR_INSPECTOR_ALREADY_CONNECTED',
    type: Error,
    message: 'Another inspector session is already connected'
  }
);

session.disconnect();
// Calling disconnect twice should not throw.
session.disconnect();
