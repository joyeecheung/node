'use strict';
const duration = BigInt(parseInt(process.env.TEST_DURATION) || 1000 * 1000 * 1000);
const repeat = parseInt(process.env.TEST_REPEAT) || 10;
const start = process.hrtime.bigint();

function runDuration(duration) {
  let diff;
  do {
    diff = process.hrtime.bigint() - start;
  } while (diff < duration);
  return diff;
}

for (let i = 0; i < repeat; ++i) {
  process.stdout.write(`${runDuration(duration)}\n`);
}
