// Flags: --expose-internals
'use strict';
const common = require('../common');
common.skipIfInspectorDisabled();
const assert = require('assert');
const { NodeInstance } = require('../common/inspector-helper.js');
const fixtures = require('../common/fixtures');
const { pathToFileURL } = require('url');

const script = fixtures.path('emit-and-clear-interval.js');
const scriptUrl = pathToFileURL(script).toString();

async function setupDebugger(session) {
  console.log('[test]', 'Setting up a debugger');
  const commands = [
    { 'method': 'Runtime.enable' },
    { 'method': 'Debugger.enable' },
    { 'method': 'Debugger.setAsyncCallStackDepth',
      'params': { 'maxDepth': 0 } },
    { 'method': 'Debugger.setBlackboxPatterns',
      // eslint-disable-next-line no-useless-escape
      'params': { 'patterns': ['^node-internal:\/\/'] } },
    { 'method': 'Runtime.runIfWaitingForDebugger' },
  ];
  session.send(commands);
  await session.waitForNotification('Runtime.consoleAPICalled');
}

async function verifyBlackboxingInternals(session) {
  console.log('[test]', 'Breaking into run()');
  const commands = [
    // Break in global.run()
    { 'method': 'Debugger.setBreakpointByUrl',
      'params': { 'lineNumber': 13,
                  'url': scriptUrl,
                  'columnNumber': 0,
                  'condition': ''
      }
    },
    { 'method': 'Runtime.evaluate',
      'params': { 'expression': 'run()' }
    }
  ];
  session.send(commands);
  let msg = await session.waitForNotification('Debugger.paused');
  let topFrame = msg.params.callFrames[0];
  assert.strictEqual(topFrame.url, scriptUrl);
  assert.strictEqual(topFrame.functionName, 'run');

  console.log('[test]',
              'See if we step straight into onTest instead of emitter.emit');
  session.send({ 'method': 'Debugger.stepInto' });
  msg = await session.waitForNotification('Debugger.paused');
  topFrame = msg.params.callFrames[0];
  assert.strictEqual(topFrame.url, scriptUrl);
  assert.strictEqual(topFrame.functionName, 'onTest');

  session.send([
    { 'method': 'Debugger.stepInto' }
  ]);
  console.log('[test]', 'See if the first clearInterval is blackboxed');
  msg = await session.waitForNotification('Debugger.paused');
  topFrame = msg.params.callFrames[0];
  assert.strictEqual(topFrame.url, scriptUrl);
  assert.strictEqual(topFrame.functionName, 'onTest');
}

async function verifyInternalsAfterRemovingBlackbox(session) {
  console.log('[test]', 'Reset blackbox pattern and step into again');
  session.send([
    { 'method': 'Debugger.setBlackboxPatterns',
      'params': { 'patterns': [] } },
    { 'method': 'Debugger.stepInto' }
  ]);
  console.log('[test]', 'Step into clearInterval after removing blackbox');
  let msg = await session.waitForNotification('Debugger.paused');
  let topFrame = msg.params.callFrames[0];
  assert.notStrictEqual(topFrame.url, scriptUrl);
  assert.strictEqual(topFrame.functionName, 'clearInterval');

  console.log('[test]', 'Step out and back in onTest');
  session.send([
    { 'method': 'Debugger.stepOut' }
  ]);
  msg = await session.waitForNotification('Debugger.paused');
  topFrame = msg.params.callFrames[0];
  assert.strictEqual(topFrame.url, scriptUrl);
  assert.strictEqual(topFrame.functionName, 'onTest');
}

async function runTests() {
  const child = new NodeInstance(['--inspect=0'], undefined, script);
  const session = await child.connectInspectorSession();
  await setupDebugger(session);
  await verifyBlackboxingInternals(session);
  await verifyInternalsAfterRemovingBlackbox(session);
  await session.runToCompletion();
  assert.strictEqual((await child.expectShutdown()).exitCode, 0);
}

runTests();
