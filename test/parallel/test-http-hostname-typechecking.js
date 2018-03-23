'use strict';

const common = require('../common');
const http = require('http');

// All of these values should cause http.request() to throw synchronously
// when passed as the value of either options.hostname or options.host
const vals = [
  [{}, 'Object'],
  [[], 'Array'],
  [NaN, 'number'],
  [Infinity, 'number'],
  [-Infinity, 'number'],
  [true, 'boolean'],
  [false, 'boolean'],
  [1, 'number'],
  [0, 'number'],
  [new Date(), 'Date']
];

vals.forEach(([v, type]) => {
  common.expectsError(
    () => http.request({ hostname: v }),
    {
      code: 'ERR_INVALID_ARG_TYPE',
      type: TypeError,
      message: 'The "options.hostname" property must be one of ' +
               'type string, undefined, or null. ' +
               `Received type ${type}`
    }
  );

  common.expectsError(
    () => http.request({ host: v }),
    {
      code: 'ERR_INVALID_ARG_TYPE',
      type: TypeError,
      message: 'The "options.host" property must be one of ' +
               'type string, undefined, or null. ' +
               `Received type ${type}`
    }
  );
});

// These values are OK and should not throw synchronously.
// Only testing for 'hostname' validation so ignore connection errors.
const dontCare = () => {};
['', undefined, null].forEach((v) => {
  http.request({ hostname: v }).on('error', dontCare).end();
  http.request({ host: v }).on('error', dontCare).end();
});
