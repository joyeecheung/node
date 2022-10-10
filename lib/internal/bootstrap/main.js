'use strict';

const { isMainThread } = internalBinding('worker');
const { getOptionValue } = require('internal/options');
const { guessHandleType } = internalBinding('util');
const { getRawProcessArgv1 } = internalBinding('process_methods');

function runMain(id) {
  require(`internal/bootstrap/main/${id}`);
}

const firstArgv = getRawProcessArgv1();

if (!isMainThread) {
  runMain('worker_thread');
} else if (firstArgv === 'inspect') {
  runMain('inspect');
} else if (getOptionValue('--build-snapshot')) {
  runMain('mksnapshot');
} else if (getOptionValue('--print-help')) {
  runMain('print_help');
} else if (getOptionValue('--prof-process')) {
  runMain('prof_process');
} else if (getOptionValue('[has_eval_string]') && !getOptionValue('--interactive')) {
  runMain('eval_string');
} else if (getOptionValue('--check')) {
  runMain('check_syntax');
} else if (getOptionValue('--test')) {
  runMain('test_runner');
} else if (getOptionValue('--watch') && process.argv.length > 1) {
  runMain('watch_mode');
} else if (firstArgv && firstArgv !== '-') {
  runMain('run_main_module');
} else if (getOptionValue('--interactive') || guessHandleType(0) == 'TTY') {
  runMain('repl');
} else {
  runMain('eval_stdin');
}