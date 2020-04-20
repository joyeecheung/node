'use strict';

process.emitWarning(
  'These APIs are for internal testing only. Do not use them.',
  'internal/test/binding');

// const { NativeModule } = require('internal/bootstrap/loaders');
// module.exports = { NativeModule, internalBinding };

module.exports = { internalBinding };
