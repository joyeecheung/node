'use strict';

// A target for probe attach tests whose main thread is blocked in a synchronous read until its
// stdin is closed, so it cannot answer inspector requests.
require('fs').writeSync(1, 'ready\n');
require('fs').readSync(0, Buffer.alloc(1));
