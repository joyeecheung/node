'use strict';

process.stdin.on('data', (chunk) => {
  if (chunk === '1') {
    process.exit(0);
  } else {
    process.stdout.write(chunk);
  }
});
