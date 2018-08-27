/* eslint-disable node-core/required-modules */
'use strict';

const assert = require('assert');
const common = require('../common');
const fixtures = require('../common/fixtures');
const fs = require('fs');
const { URL, URLSearchParams } = require('url');
const vm = require('vm');

// https://github.com/w3c/testharness.js/blob/master/testharness.js
exports.harness = {
  test: (fn, desc) => {
    try {
      fn();
    } catch (err) {
      console.error(`In ${desc}:`);
      throw err;
    }
  },
  async_test(fn) {
    fn({
      step_func_done: common.mustCall
    });
  },
  promise_test(fn, desc) {
    console.log(desc);
    fn();
  },
  done() { },
  idl_test() {
    // TODO: implement this
  },
  assert_equals: assert.strictEqual,
  assert_true: (value, message) => assert.strictEqual(value, true, message),
  assert_false: (value, message) => assert.strictEqual(value, false, message),
  assert_throws: (code, func, desc) => {
    assert.throws(func, function(err) {
      return typeof err === 'object' &&
        'name' in err &&
        err.name.startsWith(code.name);
    }, desc);
  },
  assert_array_equals(a, b) {
    assert.deepStrictEqual([...a], [...b]);
  },
  assert_unreached(desc) {
    assert.fail(`Reached unreachable code: ${desc}`);
  }
};


function failWithTest(test, reason) {
  let message = reason + ': ' + test.name + '\n';
  message += test.message;
  message += test.stack;
  throw new Error(message);
}

function result_callback(test) {
  let reason;
  if (test.status === 1) {
    reason = 'fail';
  } else if (test.status === 2) {
    reason = 'timeout';
  } else if (test.status === 3) {
    reason = 'incomplete';
  } else {
    return;
  }
  failWithTest(test, reason);
}

function completion_callback(tests, test) {
  if (test.status === 2) {
    failWithTest(test, 'timeout');
  }
}

class WPTRunner {
  constructor(subsystem) {
    this.subsystem = subsystem;
    this.sandbox = null;
    this.context = null;

    this.jsTests = [];
    this.requireIntlTests = [];
    this.skippedTests = {};

    this.initialize();
  }

  createSandbox() {
    const that = this;
    require('internal/errors').useOriginalName = true;
    return {
      fetch(file) {
        const filepath = that.getFixturePath(file);
        return fs.promises.readFile(filepath).then((data) => {
          return {
            json() { return JSON.parse(data.toString()); },
            text() { return data.toString(); }
          };
        });
      },
      location: {},
      GLOBAL: {
        isWindow() { return false; }
      },
      URL,
      URLSearchParams,
      get DOMException() {
        return require('internal/domexception');
      }
    };
  }

  initialize() {
    const sandbox = this.createSandbox();
    const context = vm.createContext(sandbox);

    const harnessPath = 'wpt/resources/testharness.js';
    const harness = fixtures.readSync(harnessPath);
    vm.runInContext(harness, context, { filename: fixtures.path(harnessPath) });

    sandbox.add_result_callback(result_callback);
    sandbox.add_completion_callback(completion_callback);
    sandbox.self = sandbox;

    this.sandbox = sandbox;
    this.context = context;
  }

  getFixturePath(file) {
    return fixtures.path('wpt', this.subsystem, file);
  }

  readFixture(file, ...args) {
    return fs.readFileSync(this.getFixturePath(file), ...args);
  }

  addJsTests(tests) {
    this.jsTests = this.jsTests.concat(tests);
  }

  /**
   * @param {string[]} tests Keywords of tests that should be skipped
   */
  requireIntl(tests) {
    this.requireIntlTests = this.requireIntlTests.concat(tests);
  }

  /**
   * @param {{string: string}} reasons Map of <keyword, reason>
   */
  shouldSkip(reasons) {
    Object.assign(this.skippedTests, reasons);
  }

  expectIntl(file) {
    return this.requireIntlTests.some((name) => file.includes(name));
  }

  expectToFail(file) {
    const key = Object.keys(this.skippedTests)
      .find((name) => file.includes(name));
    if (key) {
      return this.skippedTests[key];
    }
  }

  /**
   * @param {string} test Name of test to get the skip reason for
   * @returns {string|false} If false, the test should not be skipped.
   */
  getSkipReason(test) {
    if (!common.hasIntl && this.expectIntl(test)) {
      return 'missing Intl';
    }
    const reason = this.expectToFail(test);
    if (reason) {
      return reason;
    }
    return false;
  }

  run() {
    for (const test of this.jsTests) {
      const source = this.readFixture(test);
      let reason;
      if (reason = this.getSkipReason(test)) {
        common.printSkipMessage(`Skip ${test}: ${reason}`);
        continue;
      }
      vm.runInContext(source, this.context, {
        filename: this.getFixturePath(test)
      });
    }
  }
}

exports.WPTRunner = WPTRunner;
