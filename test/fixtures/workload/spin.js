'use strict';

function shouldSpin(start, ms) {
  return Date.now() - start < ms;
}

function spin(ms) {
  const start = Date.now();
  while (shouldSpin(start, ms)) {}
}

const ms = parseInt(process.env.NODE_TEST_SPIN_MS, 10) || 1000;
spin(ms);
