'use strict';
const common = require('../common');
const http = require('http');
const Countdown = require('../common/countdown');

const expectedSuccesses = [undefined, null, 'GET', 'post'];
const expectedFails = [
  [-1, 'number'],
  [1, 'number'],
  [0, 'number'],
  [{}, 'Object'],
  [true, 'boolean'],
  [false, 'boolean'],
  [[], 'Array'],
  [Symbol(), 'symbol']
];

const countdown =
  new Countdown(expectedSuccesses.length,
                common.mustCall(() => server.close()));

const server = http.createServer(common.mustCall((req, res) => {
  res.end();
  countdown.dec();
}, expectedSuccesses.length));

server.listen(0, common.mustCall(() => {
  expectedFails.forEach(([method, type]) => {
    common.expectsError(() => {
      http.request({ method, path: '/' }, common.mustNotCall());
    }, {
      code: 'ERR_INVALID_ARG_TYPE',
      type: TypeError,
      message: 'The "method" argument must be of type string. ' +
               `Received type ${type}`
    });
  });

  expectedSuccesses.forEach((method) => {
    http.request({ method, port: server.address().port }).end();
  });
}));
