'use strict';

// Flags: --expose-internals --experimental-worker

require('../common');
const { WPTRunner } = require('../common/wpt');
const perf_hooks = require('perf_hooks');

const runner = new WPTRunner('performance-timeline');

// The APIs are not yet exposed as global
runner.copyGlobalsFromObject(perf_hooks, [
  'performance',
  'PerformanceObserver',
  'PerformanceEntry',
  'PerformanceObserverEntryList'
]);

// The APIs are not yet exposed as global
runner.defineGlobal('setTimeout', {
  value: setTimeout
})

runner.runJsTests();
