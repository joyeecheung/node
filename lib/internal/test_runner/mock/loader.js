'use strict';
const {
  AtomicsNotify,
  AtomicsStore,
  JSONStringify,
  SafeMap,
} = primordials;
const {
  kBadExportsMessage,
  kMockSearchParam,
  kMockSuccess,
  kMockExists,
  kMockUnknownMessage,
} = require('internal/test_runner/mock/mock');
const { URL, URLParse } = require('internal/url');
let debug = require('internal/util/debuglog').debuglog('test_runner', (fn) => {
  debug = fn;
});

// TODO(cjihrig): The mocks need to be thread aware because the exports are
// evaluated on the thread that creates the mock. Before marking this API as
// stable, one of the following issues needs to be implemented:
// https://github.com/nodejs/node/issues/49472
// or https://github.com/nodejs/node/issues/52219

const mocks = new SafeMap();

function resolve(specifier, context, nextResolve) {
  debug('resolve hook entry, specifier = "%s", context = %o', specifier, context);

  const nextResolveResult = nextResolve(specifier, context);
  const mockSpecifier = nextResolveResult.url;

  const mock = mocks.get(mockSpecifier);
  debug('resolve hook, specifier = "%s", mock = %o', specifier, mock);

  if (mock?.active !== true) {
    return nextResolveResult;
  }

  const url = new URL(mockSpecifier);
  url.searchParams.set(kMockSearchParam, mock.localVersion);

  if (!mock.cache) {
    // With ESM, we can't remove modules from the cache. Bump the module's
    // version instead so that the next import will be uncached.
    mock.localVersion++;
  }

  const { href } = url;
  debug('resolve hook finished, url = "%s"', href);
  return { __proto__: null, url: href, format: nextResolveResult.format };
}

function load(url, context, nextLoad) {
  debug('load hook entry, url = "%s", context = %o', url, context);
  const parsedURL = URLParse(url);
  if (parsedURL) {
    parsedURL.searchParams.delete(kMockSearchParam);
  }

  const baseURL = parsedURL ? parsedURL.href : url;
  const mock = mocks.get(baseURL);

  const original = nextLoad(url, context);
  debug('load hook, mock = %o', mock);
  if (mock?.active !== true) {
    return original;
  }

  // Treat builtins as commonjs because customization hooks do not allow a
  // core module to be replaced.
  // Also collapse 'commonjs-sync' and 'require-commonjs' to 'commonjs'.
  let format = original.format;
  switch (original.format) {
    case 'builtin': // Deliberate fallthrough
    case 'commonjs-sync': // Deliberate fallthrough
    case 'require-commonjs':
      format = 'commonjs';
      break;
    case 'json':
      format = 'module';
      break;
  }

  const result = {
    __proto__: null,
    format,
    shortCircuit: true,
    source: createSourceFromMock(mock, format),
  };

  debug('load hook finished, result = %o', result);
  return result;
}

function createSourceFromMock(mock, format) {
  // Create mock implementation from provided exports.
  const { exportNames, hasDefaultExport, url } = mock;
  const useESM = format === 'module' || format === 'module-typescript';
  const source = `${testImportSource(useESM)}
if (!$__test.mock._mockExports.has(${JSONStringify(url)})) {
  throw new Error(${JSONStringify(`mock exports not found for "${url}"`)});
}

const $__exports = $__test.mock._mockExports.get(${JSONStringify(url)});
${defaultExportSource(useESM, hasDefaultExport)}
${namedExportsSource(useESM, exportNames)}
`;

  return source;
}

function testImportSource(useESM) {
  if (useESM) {
    return "import $__test from 'node:test';";
  }

  return "const $__test = require('node:test');";
}

function defaultExportSource(useESM, hasDefaultExport) {
  if (!hasDefaultExport) {
    return '';
  } else if (useESM) {
    return 'export default $__exports.defaultExport;';
  }

  return 'module.exports = $__exports.defaultExport;';
}

function namedExportsSource(useESM, exportNames) {
  let source = '';

  if (!useESM && exportNames.length > 0) {
    source += `
if (module.exports === null || typeof module.exports !== 'object') {
  throw new Error('${JSONStringify(kBadExportsMessage)}');
}
`;
  }

  for (let i = 0; i < exportNames.length; ++i) {
    const name = exportNames[i];

    if (useESM) {
      source += `export let ${name} = $__exports.namedExports[${JSONStringify(name)}];\n`;
    } else {
      source += `module.exports[${JSONStringify(name)}] = $__exports.namedExports[${JSONStringify(name)}];\n`;
    }
  }

  return source;
}

module.exports = { mocks, load, resolve };
