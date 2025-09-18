'use strict';

const {
  JSONParse,
} = primordials;
const { getOptionValue } = require('internal/options');
const {
  prepareMainThreadExecution,
  markBootstrapComplete,
} = require('internal/process/pre_execution');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  cachedCodeTypes: {
    kCommonJS,
    kESM,
  },
  flushCompileCache,
} = internalBinding('modules');
const {
  enableCompileCache,
} = require('internal/modules/helpers');
const { defaultGetFormatWithoutErrors } = require('internal/modules/esm/get_format');
const { pathToFileURL } = require('internal/url');
const console = require('internal/console/global');
const { compileSourceTextModule } = require('internal/modules/esm/utils');
const { compileFunctionForCJSLoader } = internalBinding('contextify');

const dict = {
  'commonjs': kCommonJS,
  'module': kESM,
  // TODO(joyeecheung): figure out how to support TypeScript
};

// TODO(joyeecheung): not every one of these are necessary
prepareMainThreadExecution(true, true);
markBootstrapComplete();

// Leave it as default and use NODE_COMPILE_CACHE_PORTABLE and NODE_COMPILE_CACHE
// to control the behaviors.
enableCompileCache();

let pathToList = getOptionValue('--compile-cache-for');
assert(pathToList, '--compile-cache-for requires a value');

pathToList = path.resolve(pathToList);
let listContent;
try {
  listContent = fs.readFileSync(pathToList, 'utf8');
} catch (err) {
  console.error(`Failed to read the file specified by --compile-cache-for: ${pathToList}`);
  console.error(err);
  process.exit(1);
}

const list = JSONParse(listContent);
const processedList = [];
for (let i = 0; i < list.length; i++) {
  const item = list[i];
  if (typeof item !== 'object' || item === null) {
    console.log(`Skipping invalid entry #${i}:`, item);
    continue;
  }
  const { source } = item;
  let { format } = item;
  if (typeof source !== 'string' || source.length === 0) {
    console.log(`Skipping invalid "source" field of entry #${i}`, item);
    continue;
  }
  const filename = path.resolve(source);
  const url = pathToFileURL(filename);
  if (format === undefined) {
    // Detect the format by ourselves.
    format = defaultGetFormatWithoutErrors(url);
    if (format === null) {
      console.log(`Skipping ambiguous file #${i} without "format" field`, item);
      continue;
    }
  }

  if (typeof format !== 'string' || dict[format] === undefined) {
    console.log(`Skipping unsupported "format" of entry #${i}`, item);
    continue;
  }

  const content = fs.readFileSync(filename, 'utf8');
  if (format === 'module') {
    compileSourceTextModule(url, content);
  } else if (format === 'commonjs') {
    compileFunctionForCJSLoader(content, filename, false /* is_sea_main */, false /* should_detect_module */);
  }
  // TODO(joyeecheung): handle TypeScript.
}

flushCompileCache();
