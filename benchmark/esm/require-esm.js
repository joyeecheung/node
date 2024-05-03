'use strict';

const common = require('../common');
const fs = require('fs');
const tmpdir = require('../../test/common/tmpdir');
const path = require('path');
const assert = require('assert');

const bench = common.createBenchmark(main, {
  exports: ['default', 'named'],
  n: [1000],
}, {
  flags: ['--experimental-require-module', '--no-warnings'],
});

function prepare(count, useDefault) {
  tmpdir.refresh();
  const dir = tmpdir.resolve('modules');
  fs.mkdirSync(dir, { recursive: true });
  let mainSource = '';
  let useSource = 'exports.result = 0';
  for (let i = 0; i < count; ++i) {
    let modSource = `const value${i} = 1;\n`;
    if (useDefault) {
      modSource += `export default { value${i} }\n`;
    } else {
      modSource += `export { value${i} };\n`;
    }
    const filename = `mod${i}.mjs`;
    fs.writeFileSync(
      path.resolve(dir, filename),
      modSource,
      'utf8',
    );
    if (useDefault) {
      mainSource += `const { default: { value${i} } } = require('./modules/${filename}');\n`;
    } else {
      mainSource += `const { value${i} } = require('./modules/${filename}');\n`;
    }
    useSource += ` + value${i}`;
  }
  useSource += ';\n';
  const script = tmpdir.resolve('main.js');
  fs.writeFileSync(script, mainSource + useSource, 'utf8');
  return script;
}

function main({ n, exports }) {
  const script = prepare(n, exports === 'default');
  bench.start();
  const { result } = require(script);
  bench.end(n);
  assert.strictEqual(result, 1000);
}
