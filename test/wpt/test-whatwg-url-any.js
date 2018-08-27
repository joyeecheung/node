'use strict';

// This file is generated with `git node wpt`, please do not modify it.
// Last update was based on https://github.com/web-platform-tests/wpt/tree/b1db4409a5/url

// Flags: --expose-internals

require('../common');
const { WPTRunner } = require('../common/wpt');

const anyJsTests = [
  'historical.any.js',
  'idlharness.any.js',
  'url-searchparams.any.js',
  'url-tojson.any.js',
  'urlencoded-parser.any.js',
  'urlsearchparams-append.any.js',
  'urlsearchparams-constructor.any.js',
  'urlsearchparams-delete.any.js',
  'urlsearchparams-foreach.any.js',
  'urlsearchparams-get.any.js',
  'urlsearchparams-getall.any.js',
  'urlsearchparams-has.any.js',
  'urlsearchparams-set.any.js',
  'urlsearchparams-sort.any.js',
  'urlsearchparams-stringifier.any.js'
];
const requireIntlTests = [
  'url-constructor',
  'historical',
  'url-origin',
  'url-setters',
  'toascii'
];
const skippedTests = {
  'idlharness': 'TODO: import idlharness',
  'urlencoded-parser': 'missing Request and Response',
  'urlsearchparams-constructor': 'missing brand checks in DOMException'
};

const runner = new WPTRunner('url');
runner.addJsTests(anyJsTests);
runner.requireIntl(requireIntlTests);
runner.shouldSkip(skippedTests);
runner.run();
