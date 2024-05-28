'use strict';

const ts = require('../../snapshot/typescript');
const { addHooks } = require('node:module');
const path = require('path');
const extensions = {
  '.cts': 'typescript-commonjs',
  '.mts': 'typescript-esm',
  '.ts': 'typescript',
};

const output = {
  'typescript-commonjs': {
    options: { module: ts.ModuleKind.CommonJS },
    format: 'commonjs',
  },
  'typescript-esm': {
    options: { module: ts.ModuleKind.ESNext },
    format: 'module',
  },
  'typescript': {
    options: { module: ts.ModuleKind.NodeNext },
    format: 'commonjs',
  },
};

function resolve(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context);
  const ext = path.extname(resolved.filename);
  const supportedFormat = extensions[ext];
  if (!supportedFormat) {
    return resolved;
  }
  const result = {
    ...resolved,
    format: supportedFormat,
  };
  return result;
}

function load(context, nextLoad) {
  const loadResult = nextLoad(context);
  const { source: rawSource, format } = loadResult;
  if (!format || !format.startsWith('typescript')) {
    return { format, source: rawSource };
  }

  const transpiled = ts.transpileModule(rawSource, {
    compilerOptions: output[format].options
  });

  const result = {
    ...loadResult,
    format: output[format].format,
    source: transpiled.outputText,
  };

  return result;
}

addHooks({ resolve, load });
