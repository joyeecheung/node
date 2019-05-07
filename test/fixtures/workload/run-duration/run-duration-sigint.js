'use strict';

require('./run-duration');
process.kill(process.pid, "SIGINT");
