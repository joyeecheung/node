'use strict';

const path = require('path');
const { Hook } = require('./require-hooks');

new Hook(['express', 'mongodb'], function (exports, name, basedir) {
  const version = require(path.join(basedir, 'package.json')).version;

  console.log('loading %s@%s', name, version);

  exports._version = version;

  return exports;
});
