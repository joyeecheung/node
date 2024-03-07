// Flags: --experimental-require-module --abort-on-uncaught-exception
'use strict';

import { mustCall } from '../common/index.mjs';
const fn = mustCall(() => {
  console.log('hello');
});
fn();
