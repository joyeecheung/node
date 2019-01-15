'use strict';

// In worker threads, execute the script sent through the
// message port.

const {
  prepareUserCodeExecution
} = require('internal/bootstrap/pre_execution');

const {
  getEnvMessagePort,
  threadId
} = internalBinding('worker');

const {
  createMessageHandler,
  createWorkerFatalExeception
} = require('internal/process/worker_thread_only');

const debug = require('util').debuglog('worker');
debug(`[${threadId}] is setting up worker child environment`);

prepareUserCodeExecution();

// Set up the message port and start listening
const port = getEnvMessagePort();
port.on('message', createMessageHandler(port));
port.start();

// Overwrite fatalException
process._fatalException = createWorkerFatalExeception(port);
