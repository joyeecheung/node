'use strict';

const {
  ArrayPrototypeFindIndex,
  ArrayPrototypePush,
  ArrayPrototypeSplice,
  ObjectFreeze,
  StringPrototypeStartsWith,
  Symbol,
} = primordials;
const { BuiltinModule } = require('internal/bootstrap/realm');

const { validateFunction } = require('internal/validators');
const { isAbsolute } = require('path');
const { pathToFileURL, fileURLToPath } = require('internal/url');
const assert = require('internal/assert');

let debug = require('internal/util/debuglog').debuglog('module_hooks', (fn) => {
  debug = fn;
});

/** @typedef {import('internal/modules/cjs/loader.js').Module} Module */

// Use arrays for better insertion and iteration performance.
const resolveHooks = [];
const loadHooks = [];
const exportsHooks = [];
const hookId = Symbol('kModuleHooksIdKey');
let nextHookId = 0;

class ModuleHooks {
  constructor(resolve, load, exports) {
    this[hookId] = Symbol(`module-hook-${nextHookId++}`);
    // Always initialize all hooks, if it's unspecified it'll be an owned undefined.
    this.resolve = resolve;
    this.load = load;
    this.exports = exports;

    if (resolve) {
      ArrayPrototypePush(resolveHooks, this);
    }
    if (load) {
      ArrayPrototypePush(loadHooks, this);
    }
    if (exports) {
      ArrayPrototypePush(exportsHooks, this);
    }

    ObjectFreeze(this);
  }
  // TODO(joyeecheung): we may want methods that allow disabling/enabling temporarily
  // which just sets the item in the array to undefined temporarily.
  // TODO(joyeecheung): this can be the [Symbol.dispose] implementation to pair with
  // using when the explicit resource management proposal is shipped by V8.
  deregister() {
    const id = this[hookId];
    let index = ArrayPrototypeFindIndex(resolveHooks, (hook) => hook[hookId] === id);
    if (index !== -1) {
      ArrayPrototypeSplice(resolveHooks, index, 1);
    }
    index = ArrayPrototypeFindIndex(loadHooks, (hook) => hook[hookId] === id);
    if (index !== -1) {
      ArrayPrototypeSplice(loadHooks, index, 1);
    }
    index = ArrayPrototypeFindIndex(exportsHooks, (hook) => hook[hookId] === id);
    if (index !== -1) {
      ArrayPrototypeSplice(exportsHooks, index, 1);
    }
  }
};

// TODO(joyeecheung): taken an optional description?
function registerHooks(hooks) {
  const { resolve, load, exports } = hooks;
  if (resolve) {
    validateFunction(resolve, 'hooks.resolve');
  }
  if (load) {
    validateFunction(load, 'hooks.load');
  }
  if (exports) {
    validateFunction(exports, 'hooks.exports');
  }
  return new ModuleHooks(resolve, load, exports);
}

class ModuleResolveContext {
  constructor(parentURL, importAttributes) {
    this.parentURL = parentURL;
    this.importAttributes = importAttributes;
    // TODO(joyeecheung): differentiate between require and import?
  }
};

class ModuleLoadContext {
  constructor(format) {
    this.format = format;
  }
};

class ModuleExportsContext {
  constructor(format, exports) {
    this.format = format;
    this.exports = exports;
  }
};

function convertCJSFilenameToURL(filename) {
  if (!filename) { return filename; }
  const builtinId = BuiltinModule.normalizeRequirableId(filename);
  if (builtinId) {
    return `node:${builtinId}`;
  }
  // Handle the case where filename is neither a path, nor a built-in id,
  // which is possible via monkey-patching.
  if (isAbsolute(filename)) {
    return pathToFileURL(filename).href;
  }
  return filename;
}

function convertURLToCJSFilename(url) {
  if (!url) { return url; }
  const builtinId = BuiltinModule.normalizeRequirableId(url);
  if (builtinId) {
    return builtinId;
  }
  if (StringPrototypeStartsWith(url, 'file://')) {
    return fileURLToPath(url);
  }
  return url;
}

function buildHooks(hooks, key, defaultStep, validate) {
  let lastRunIndex = hooks.length;
  function wrapHook(index, userHook, next) {
    return function wrappedHook(...args) {
      lastRunIndex = index;
      const hookResult = userHook(...args, next);
      if (lastRunIndex > 0 && lastRunIndex === index) {
        assert(hookResult.shortCircuit, 'should return shortCircuit: true');
      }
      validate(hookResult);
      return hookResult;
    };
  }
  const chain = [wrapHook(0, defaultStep)];
  for (let i = 0; i < hooks.length; ++i) {
    const wrappedHook = wrapHook(i + 1, hooks[i][key], chain[i]);
    ArrayPrototypePush(chain, wrappedHook);
  }
  return chain[chain.length - 1];
}

function exportsWithHooks(url, format, originalExports) {
  debug('exportsWithHooks', url, format, originalExports);
  if (exportsHooks.length === 0) {
    return { exports: originalExports };
  }

  const exportsContext = new ModuleExportsContext(format, originalExports);

  function defaultExports(url, context) {
    return { exports: originalExports };
  }

  function validate(result) {
    assert(result.exports === originalExports, 'should not replace exports');
  }
  const runner = buildHooks(exportsHooks, 'exports', defaultExports, validate);

  return runner(url, exportsContext);
}

function validateLoad(result) {
  assert(result.source, 'should return source');
}

function loadWithHooks(url, originalFormat, defaultLoad) {
  // TODO(joyeecheung): conditions?
  debug('loadWithHooks', url, originalFormat);
  const context = new ModuleLoadContext(originalFormat);
  if (loadHooks.length === 0) {
    return defaultLoad(url, context);
  }

  const runner = buildHooks(loadHooks, 'load', defaultLoad, validateLoad);

  return runner(url, context);
}

function validateResolve(result) {
  assert(result.url, 'should return url');
}

function resolveWithHooks(specifier, parentURL, importAttributes, defaultResolve) {
  debug('resolveWithHooks', specifier, parentURL, importAttributes);
  const context = new ModuleResolveContext(parentURL, importAttributes);
  if (resolveHooks.length === 0) {
    return defaultResolve(specifier, context);
  }

  const runner = buildHooks(resolveHooks, 'resolve', defaultResolve, validateResolve);

  return runner(specifier, context);
}

module.exports = {
  convertCJSFilenameToURL,
  convertURLToCJSFilename,
  exportsHooks,
  exportsWithHooks,
  loadHooks,
  loadWithHooks,
  registerHooks,
  resolveHooks,
  resolveWithHooks,
};
