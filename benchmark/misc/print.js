'use strict';
const common = require('../common.js');
const { spawn } = require('child_process');

const bench = common.createBenchmark(main, {
  dur: [1],
  string: ["1", "'string'", "process.versions"]
});

function spawnProcess(string) {
  const cmd = process.execPath || process.argv[0];
  const argv = ['-p', string];
  return spawn(cmd, argv);
}

function start(state, string, bench, getNode) {
  const node = getNode(string);
  let stdout = '';
  let stderr = '';

  node.stdout.on('data', (data) => {
    stdout += data;
  });

  node.stderr.on('data', (data) => {
    stderr += data;
  });

  node.on('exit', (code) => {
    if (code !== 0) {
      console.error('------ stdout ------');
      console.error(stdout);
      console.error('------ stderr ------');
      console.error(stderr);
      throw new Error(`Error during node startup, exit code ${code}`);
    }
    state.throughput++;

    if (state.go) {
      start(state, string, bench, getNode);
    } else {
      bench.end(state.throughput);
    }
  });
}

function main({ dur, string }) {
  const state = {
    go: true,
    throughput: 0
  };

  setTimeout(() => {
    state.go = false;
  }, dur * 1000);

  bench.start();
  start(state, string, bench, spawnProcess);
}
