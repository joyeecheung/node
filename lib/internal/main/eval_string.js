'use strict';

// User passed `-e` or `--eval` arguments to Node without `-i` or
// `--interactive`.

const { prepareUserCodeExecution } =
  require('internal/bootstrap/pre_execution');
const { evalScript } = require('internal/process/execution');
const { addBuiltinLibsToObject } = require('internal/modules/cjs/helpers');

const source = require('internal/options').getOptionValue('--eval');
prepareUserCodeExecution();
addBuiltinLibsToObject(global);
evalScript('[eval]', source, process._breakFirstLine);
