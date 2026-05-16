'use strict';
const { Session } = require('inspector');

function callInspectorResume() {
  const session = new Session();
  session.connect();
  session.post('Debugger.resume');
  return 1;
}

module.exports = { callInspectorResume };
globalThis.probeLine = 1;
setInterval(() => {}, 1000);  // Keep it alive to prevent early exit.
