'use strict';

// A target for probe attach tests that finishes on its own. It increments a
// counter on a timer, stops the timer after two seconds so the process can
// exit, and prints `ready` once the timer is scheduled.
let count = 0;

function tick() {
  count = count + 1;
}

const interval = setInterval(tick, 50);

setTimeout(() => {
  clearInterval(interval);
}, 2000);

console.log('ready');
