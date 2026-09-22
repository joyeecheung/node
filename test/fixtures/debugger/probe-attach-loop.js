'use strict';

// A long-running target for probe attach tests. It increments a counter on a
// timer so probes have a changing value to read, and prints `ready` once the
// timer is scheduled.
let count = 0;

function tick() {
  count = count + 1;
}

setInterval(tick, 50);

console.log('ready');
