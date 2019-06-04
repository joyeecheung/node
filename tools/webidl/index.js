'use strict';

const WebIDL2JS = require('webidl2js');

// - internal
//   - webidl
//     - impls
//       - URL_impl.js
//     - wrappers
//       - utils.js
//       - URL.js
// TODO(joyee): perf impact
// TODO(joyee): s/require("web-conversions")/require("internal/deps/web-conversions")/
// TODO(joyee): s/require("./utils.js")/require("internal/webidl/webidl/wrappers/utils")/
// TODO(joyee): s/require("../impls/URL.js")/require("internal/webidl/impls/URL")/
// rules:
//   path.resolve(wrapperDir, id)
//     .replace(wrapperDir, 'internal/webidl/webidl/wrappers')
//     .replace('.js', '')
// TODO(joyee): create export
//  module.exports.URL = require('internal/webidl/webidl/wrappers/URL').interface;

const idlDir = process.env.WEBIDL_DIR || 'idl';
const implDir = process.env.WEBIDL_IMPL_DIR || 'impls';
const wrapperDir = process.env.WEBIDL_WRAPPERS_DIR || 'wrappers';

async function main() {
  const transformer = new WebIDL2JS();
  transformer.addSource(idlDir, implDir);
  await transformer.generate(wrapperDir);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
