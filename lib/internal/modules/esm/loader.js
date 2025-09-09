'use strict';

const {
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypeReduce,
  FunctionPrototypeCall,
  JSONStringify,
  ObjectSetPrototypeOf,
  PromisePrototypeThen,
  RegExpPrototypeSymbolReplace,
  encodeURIComponent,
  hardenRegExp,
} = primordials;


// This is needed to avoid cycles in esm/resolve <-> cjs/loader
const {
  kIsExecuting,
  kRequiredModuleSymbol,
} = require('internal/modules/cjs/loader');
const { imported_cjs_symbol } = internalBinding('symbols');

const assert = require('internal/assert');
const {
  ERR_REQUIRE_ASYNC_MODULE,
  ERR_REQUIRE_CYCLE_MODULE,
  ERR_REQUIRE_ESM,
  ERR_UNKNOWN_MODULE_FORMAT,
} = require('internal/errors').codes;
const { getOptionValue } = require('internal/options');
const { isURL, pathToFileURL } = require('internal/url');
const { kEmptyObject } = require('internal/util');
const {
  compileSourceTextModule,
  getDefaultConditions,
  shouldSpawnLoaderWorker,
  requestTypes: { kImportInRequiredESM, kRequireInImportedCJS },
} = require('internal/modules/esm/utils');
/**
 * @typedef {import('./utils.js').ModuleRequestType} ModuleRequestType
 */
const { kImplicitTypeAttribute } = require('internal/modules/esm/assert');
const {
  ModuleWrap,
  kEvaluated,
  kEvaluating,
  kEvaluationPhase,
  kInstantiated,
  kErrored,
  kSourcePhase,
  throwIfPromiseRejected,
} = internalBinding('module_wrap');
const {
  urlToFilename,
} = require('internal/modules/helpers');
const {
  resolveHooks,
  resolveWithHooks,
  loadHooks,
  loadWithHooks,
} = require('internal/modules/customization_hooks');
let defaultResolve, defaultLoadSync, importMetaInitializer;

const { tracingChannel } = require('diagnostics_channel');
const onImport = tracingChannel('module.import');

let debug = require('internal/util/debuglog').debuglog('esm', (fn) => {
  debug = fn;
});

const { isPromise } = require('internal/util/types');

/**
 * @typedef {import('./hooks.js').AsyncLoaderWorker} AsyncLoaderWorker
 * @typedef {import('./module_job.js').ModuleJobBase} ModuleJobBase
 * @typedef {import('url').URL} URL
 */

/**
 * Lazy loads the module_map module and returns a new instance of ResolveCache.
 * @returns {import('./module_map.js').ResolveCache}
 */
function newResolveCache() {
  const { ResolveCache } = require('internal/modules/esm/module_map');
  return new ResolveCache();
}

/**
 * Generate a load cache (to store the final result of a load-chain for a particular module).
 * @returns {import('./module_map.js').LoadCache}
 */
function newLoadCache() {
  const { LoadCache } = require('internal/modules/esm/module_map');
  return new LoadCache();
}

let _translators;
function lazyLoadTranslators() {
  _translators ??= require('internal/modules/esm/translators');
  return _translators;
}

/**
 * Lazy-load translators to avoid potentially unnecessary work at startup (ex if ESM is not used).
 * @returns {import('./translators.js').Translators}
 */
function getTranslators() {
  return lazyLoadTranslators().translators;
}

/**
 * Generate message about potential race condition caused by requiring a cached module that has started
 * async linking.
 * @param {string} filename Filename of the module being required.
 * @param {string|undefined} parentFilename Filename of the module calling require().
 * @returns {string} Error message.
 */
function getRaceMessage(filename, parentFilename) {
  let raceMessage = `Cannot require() ES Module ${filename} because it is not yet fully loaded. `;
  raceMessage += 'This may be caused by a race condition if the module is simultaneously dynamically ';
  raceMessage += 'import()-ed via Promise.all(). Try await-ing the import() sequentially in a loop instead.';
  if (parentFilename) {
    raceMessage += ` (from ${parentFilename})`;
  }
  return raceMessage;
}

/**
 * @type {AsyncLoaderWorker}
 * Multiple loader instances exist for various, specific reasons (see code comments at site).
 * In order to maintain consistency, we use a single worker (sandbox), which must sit apart of an
 * individual loader instance.
 */
let asyncLoaderWorker;

/**
 * @typedef {import('../cjs/loader.js').Module} CJSModule
 */

/**
 * @typedef {Record<string, any>} ModuleExports
 */

/**
 * @typedef {'builtin'|'commonjs'|'json'|'module'|'wasm'} ModuleFormat
 */

/**
 * @typedef {ArrayBuffer|TypedArray|string} ModuleSource
 */

/**
 * This class covers the base machinery of module loading. To add custom
 * behavior you can pass a customizations object and this object will be
 * used to do the loading/resolving/registration process.
 */
class ModuleLoader {
  /**
   * The conditions for resolving packages if `--conditions` is not used.
   */
  #defaultConditions = getDefaultConditions();

  /**
   * Registry of resolved specifiers
   */
  #resolveCache = newResolveCache();

  /**
   * Registry of loaded modules, akin to `require.cache`
   */
  loadCache = newLoadCache();

  /**
   * Methods which translate input code or other information into ES modules
   */
  translators = getTranslators();

  /**
   * Truthy to allow the use of `import.meta.resolve`. This is needed
   * currently because the `Hooks` class does not have `resolveSync`
   * implemented and `import.meta.resolve` requires it.
   */
  allowImportMetaResolve;

  isForAsyncLoaderHookWorker = false;

  /**
   * Customizations to pass requests to.
   * @type {import('./hooks.js').AsyncLoaderHookOnLoaderWorker}
   * Note that this value _MUST_ be set with `setCustomizations`
   * because it needs to copy `customizations.allowImportMetaResolve`
   *  to this property and failure to do so will cause undefined
   * behavior when invoking `import.meta.resolve`.
   *
   * When the ModuleLoader is created on a loader thread, this is
   * AsyncLoaderHookOnLoaderWorker, and its methods directly call out
   * to loader methods. Otherwise, this is AsyncLoaderHookWorkerProxy, and
   * its methods post messages to the loader thread and possibly block
   * on it.
   * @see {ModuleLoader.setCustomizations}
   * @type {AsyncLoaderHookWorkerProxy|AsyncLoaderHookOnLoaderWorker}
   */
  #customizations;

  constructor(customizations) {
    this.setCustomizations(customizations);
  }

  /**
   * Change the currently activate customizations for this module
   * loader to be the provided `customizations`.
   *
   * If present, this class customizes its core functionality to the
   * `customizations` object, including registration, loading, and resolving.
   * There are some responsibilities that this class _always_ takes
   * care of, like validating outputs, so that the customizations object
   * does not have to do so.
   *
   * The customizations object has the shape:
   *
   * ```ts
   * interface LoadResult {
   *   format: ModuleFormat;
   *   source: ModuleSource;
   * }
   *
   * interface ResolveResult {
   *   format: string;
   *   url: URL['href'];
   * }
   *
   * interface Customizations {
   *   allowImportMetaResolve: boolean;
   *   load(url: string, context: object): Promise<LoadResult>
   *   resolve(
   *     originalSpecifier:
   *     string, parentURL: string,
   *     importAttributes: Record<string, string>
   *   ): Promise<ResolveResult>
   *   resolveSync(
   *     originalSpecifier:
   *     string, parentURL: string,
   *     importAttributes: Record<string, string>
   *   ) ResolveResult;
   *   register(specifier: string, parentURL: string): any;
   *   forceLoadHooks(): void;
   * }
   * ```
   *
   * Note that this class _also_ implements the `Customizations`
   * interface, as does `AsyncLoaderHookWorkerProxy` and `Hooks`.
   *
   * Calling this function alters how modules are loaded and should be
   * invoked with care.
   * @param {AsyncLoaderHookWorkerProxy} customizations
   */
  setCustomizations(customizations) {
    this.#customizations = customizations;
    if (customizations) {
      this.allowImportMetaResolve = customizations.allowImportMetaResolve;
      this.isForAsyncLoaderHookWorker = customizations.isForAsyncLoaderHookWorker;
    } else {
      this.allowImportMetaResolve = true;
      this.isForAsyncLoaderHookWorker = false;
    }
  }

  /**
   *
   * @param {string} source Source code of the module.
   * @param {string} url URL of the module.
   * @param {{ isMain?: boolean }|undefined} context - context object containing module metadata.
   * @returns {object} The module wrap object.
   */
  createModuleWrap(source, url, context = kEmptyObject) {
    return compileSourceTextModule(url, source, this, context);
  }

  /**
   *
   * @param {string} url URL of the module.
   * @param {object} wrap Module wrap object.
   * @param {boolean} isEntryPoint Whether the module is the entry point.
   * @returns {Promise<object>} The module object.
   */
  async executeModuleJob(url, wrap, isEntryPoint = false) {
    const { ModuleJob } = require('internal/modules/esm/module_job');
    const module = await onImport.tracePromise(async () => {
      const job = new ModuleJob(this, url, undefined, wrap, kEvaluationPhase, false, false);
      this.loadCache.set(url, undefined, job);
      const { module } = await job.run(isEntryPoint);
      return module;
    }, {
      __proto__: null,
      parentURL: '<eval>',
      url,
    });

    return {
      __proto__: null,
      namespace: module.getNamespace(),
      module,
    };
  }

  /**
   *
   * @param {string} source Source code of the module.
   * @param {string} url URL of the module.
   * @param {boolean} isEntryPoint Whether the module is the entry point.
   * @returns {Promise<object>} The module object.
   */
  eval(source, url, isEntryPoint = false) {
    const context = isEntryPoint ? { isMain: true } : undefined;
    const wrap = this.createModuleWrap(source, url, context);
    return this.executeModuleJob(url, wrap, isEntryPoint);
  }

  /**
   * Get a (possibly not yet fully linked) module job from the cache, or create one and return its Promise.
   * @param {string} [parentURL] The URL of the module where the module request is initiated.
   *   It's undefined if it's from the root module.
   * @param {ModuleRequest} request Module request.
   * @param {ModuleRequestType} requestType Type of the module request.
   * @returns {Promise<ModuleJobBase>|ModuleJobBase}
   */
  getOrCreateModuleJob(parentURL, request, requestType) {
    let maybePromise;
    if (requestType === kRequireInImportedCJS || requestType === kImportInRequiredESM) {
      // In these two cases, resolution must be synchronous.
      maybePromise = this.resolveSync(parentURL, request);
      assert(!isPromise(maybePromise));
    } else {
      maybePromise = this.#resolve(parentURL, request);
    }

    const afterResolve = (resolveResult) => {
      return this.#getOrCreateModuleJobAfterResolve(parentURL, resolveResult, request, requestType);
    };

    if (isPromise(maybePromise)) {
      return PromisePrototypeThen(maybePromise, afterResolve);
    }
    return afterResolve(maybePromise);
  }

  #getOrCreateModuleJobAfterResolve(parentURL, resolveResult, request, requestType) {
    const { url, format } = resolveResult;
    // TODO(joyeecheung): update the module requests to use importAttributes as property names.
    const importAttributes = resolveResult.importAttributes ?? request.attributes;
    let job = this.loadCache.get(url, importAttributes.type);

    if (job !== undefined) {
      if (requestType === kImportInRequiredESM) {
        this.#handleCachedJobForRequireESM(request.specifier, url, parentURL, job);
      }
      job.ensurePhase(request.phase, requestType);
      return job;
    }

    const context = { format, importAttributes, __proto__: null };

    let moduleOrModulePromise;
    if (requestType === kRequireInImportedCJS) {
      moduleOrModulePromise = this.loadAndTranslateForRequireInImportedCJS(url, context, parentURL);
    } else if (requestType === kImportInRequiredESM) {
      moduleOrModulePromise = this.loadAndTranslateForImportInRequiredESM(url, context, parentURL);
    } else {
      moduleOrModulePromise = this.loadAndTranslate(url, context, parentURL);
    }

    if (requestType === kImportInRequiredESM || requestType === kRequireInImportedCJS ||
        !this.isForAsyncLoaderHookWorker) {
      assert(moduleOrModulePromise instanceof ModuleWrap);
    }

    if (process.env.WATCH_REPORT_DEPENDENCIES && process.send) {
      const type = requestType === kRequireInImportedCJS ? 'require' : 'import';
      process.send({ [`watch:${type}`]: [url] });
    }

    const { ModuleJob, ModuleJobSync } = require('internal/modules/esm/module_job');
    // TODO(joyeecheung): use ModuleJobSync for kRequireInImportedCJS too.
    const ModuleJobCtor = (requestType === kImportInRequiredESM ? ModuleJobSync : ModuleJob);
    const isMain = (parentURL === undefined);
    const inspectBrk = (isMain && getOptionValue('--inspect-brk'));
    job = new ModuleJobCtor(
      this,
      url,
      importAttributes,
      moduleOrModulePromise,
      request.phase,
      isMain,
      inspectBrk,
      requestType,
    );

    this.loadCache.set(url, importAttributes.type, job);

    return job;
  }

  /**
   * This constructs (creates, instantiates and evaluates) a module graph that
   * is require()'d.
   * @param {CJSModule} mod CJS module wrapper of the ESM.
   * @param {string} filename Resolved filename of the module being require()'d
   * @param {string} source Source code. TODO(joyeecheung): pass the raw buffer.
   * @param {string} isMain Whether this module is a main module.
   * @param {CJSModule|undefined} parent Parent module, if any.
   * @returns {{wrap: ModuleWrap, namespace: import('internal/modules/esm/utils').ModuleNamespaceObject}}
   */
  importSyncForRequire(mod, filename, source, isMain, parent) {
    const url = pathToFileURL(filename).href;
    if (!getOptionValue('--experimental-require-module')) {
      throw new ERR_REQUIRE_ESM(url, true);
    }

    let job = this.loadCache.get(url, kImplicitTypeAttribute);
    // This module job is already created:
    // 1. If it was loaded by `require()` before, at this point the instantiation
    //    is already completed and we can check the whether it is in a cycle
    //    (in that case the module status is kEvaluaing), and whether the
    //    required graph is synchronous.
    // 2. If it was loaded by `import` before, only allow it if it's already evaluated
    //    to forbid cycles.
    //    TODO(joyeecheung): ensure that imported synchronous graphs are evaluated
    //    synchronously so that any previously imported synchronous graph is already
    //    evaluated at this point.
    // TODO(joyeecheung): add something similar to CJS loader's requireStack to help
    // debugging the the problematic links in the graph for import.
    debug('importSyncForRequire', parent?.filename, '->', filename, job);
    if (job !== undefined) {
      mod[kRequiredModuleSymbol] = job.module;
      const parentFilename = urlToFilename(parent?.filename);
      // TODO(node:55782): this race may stop to happen when the ESM resolution and loading become synchronous.
      if (!job.module) {
        assert.fail(getRaceMessage(filename, parentFilename));
      }
      const status = job.module.getStatus();
      debug('Module status', job, status);
      // hasAsyncGraph is available after module been instantiated.
      if (status >= kInstantiated && job.module.hasAsyncGraph) {
        throw new ERR_REQUIRE_ASYNC_MODULE(filename, parentFilename);
      }
      if (status === kEvaluated) {
        return { wrap: job.module, namespace: job.module.getNamespace() };
      } else if (status === kInstantiated) {
        // When it's an async job cached by another import request,
        // which has finished linking but has not started its
        // evaluation because the async run() task would be later
        // in line. Then start the evaluation now with runSync(), which
        // is guaranteed to finish by the time the other run() get to it,
        // and the other task would just get the cached evaluation results,
        // similar to what would happen when both are async.
        mod[kRequiredModuleSymbol] = job.module;
        const { namespace } = job.runSync(parent);
        return { wrap: job.module, namespace: namespace || job.module.getNamespace() };
      } else if (status === kErrored) {
        // If the module was previously imported and errored, throw the error.
        throw job.module.getError();
      }
      // When the cached async job have already encountered a linking
      // error that gets wrapped into a rejection, but is still later
      // in line to throw on it, just unwrap and throw the linking error
      // from require().
      if (job.instantiated) {
        throwIfPromiseRejected(job.instantiated);
      }
      if (status !== kEvaluating) {
        assert.fail(`Unexpected module status ${status}. ` +
                    getRaceMessage(filename, parentFilename));
      }
      let message = `Cannot require() ES Module ${filename} in a cycle.`;
      if (parentFilename) {
        message += ` (from ${parentFilename})`;
      }
      message += ' A cycle involving require(esm) is not allowed to maintain ';
      message += 'invariants mandated by the ECMAScript specification. ';
      message += 'Try making at least part of the dependency in the graph lazily loaded.';
      throw new ERR_REQUIRE_CYCLE_MODULE(message);

    }
    // TODO(joyeecheung): refactor this so that we pre-parse in C++ and hit the
    // cache here, or use a carrier object to carry the compiled module script
    // into the constructor to ensure cache hit.
    const wrap = compileSourceTextModule(url, source, this);
    const inspectBrk = (isMain && getOptionValue('--inspect-brk'));

    const { ModuleJobSync } = require('internal/modules/esm/module_job');
    job = new ModuleJobSync(this, url, kEmptyObject, wrap, kEvaluationPhase, isMain, inspectBrk);
    this.loadCache.set(url, kImplicitTypeAttribute, job);
    mod[kRequiredModuleSymbol] = job.module;
    return { wrap: job.module, namespace: job.runSync(parent).namespace };
  }

  #handleCachedJobForRequireESM(specifier, url, parentURL, job) {
    // TODO(node:55782): this race may stop happening when the ESM resolution and loading become synchronous.
    if (!job.module) {
      assert.fail(getRaceMessage(url, parentURL));
    }
    // This module is being evaluated, which means it's imported in a previous link
    // in a cycle.
    if (job.module.getStatus() === kEvaluating) {
      const parentFilename = urlToFilename(parentURL);
      let message = `Cannot import Module ${specifier} in a cycle.`;
      if (parentFilename) {
        message += ` (from ${parentFilename})`;
      }
      throw new ERR_REQUIRE_CYCLE_MODULE(message);
    }

    // Otherwise the module could be imported before but the evaluation may be already
    // completed (e.g. the require call is lazy) so it's okay. We will return the
    // job and check asynchronicity of the entire graph later, after the
    // graph is instantiated.
  }

  /**
   * Translate a loaded module source into a ModuleWrap. This is run synchronously,
   * but the translator may return the ModuleWrap in a Promise.
   * @param {string} url URL of the module to be translated.
   * @param {object} translateContext
   * @param {string|undefined} parentURL URL of the parent module. Undefined if it's the entry point.
   * @returns {ModuleWrap}
   */
  #translate(url, translateContext, parentURL) {
    const { format } = translateContext;
    this.validateLoadResult(url, format);
    const translator = getTranslators().get(format);

    if (!translator) {
      throw new ERR_UNKNOWN_MODULE_FORMAT(format, url);
    }

    const result = FunctionPrototypeCall(translator, this, url, translateContext, parentURL);
    assert(result instanceof ModuleWrap, `The ${format} module returned is not a ModuleWrap`);
    if (format === 'commonjs' || format === 'commonjs-sync' || format === 'require-commonjs') {
      result.isCommonJS = true;
    }
    return result;
  }

  /**
   * Load a module and translate it into a ModuleWrap for require() in imported CJS.
   * This is run synchronously, and the translator always return a ModuleWrap synchronously.
   * @param {string} url URL of the module to be translated.
   * @param {object} loadContext See {@link load}
   * @param {string|undefined} parentURL URL of the parent module. Undefined if it's the entry point.
   * @returns {ModuleWrap}
   */
  loadAndTranslateForRequireInImportedCJS(url, loadContext, parentURL) {
    const loadResult = this.#loadSync(url, loadContext);
    const formatFromLoad = loadResult.format;

    if (formatFromLoad === 'wasm') {  // require(wasm) is not supported.
      throw new ERR_UNKNOWN_MODULE_FORMAT(formatFromLoad, url);
    }

    if (formatFromLoad === 'module' || formatFromLoad === 'module-typescript') {
      if (!getOptionValue('--experimental-require-module')) {
        throw new ERR_REQUIRE_ESM(url, true);
      }
    }

    let finalFormat = formatFromLoad;
    if (formatFromLoad === 'commonjs') {
      finalFormat = 'require-commonjs';
    }
    if (formatFromLoad === 'commonjs-typescript') {
      finalFormat = 'require-commonjs-typescript';
    }

    const translateContext = { ...loadResult, format: finalFormat, __proto__: null };
    const wrap = this.#translate(url, translateContext, parentURL);
    assert(wrap instanceof ModuleWrap, `Translator used for require(${url}) should not be async`);
    return wrap;
  }

  loadAndTranslateForImportInRequiredESM(url, loadContext, parentURL) {
    const maybePromise = this.#loadSync(url, loadContext);
    const afterLoad = (loadResult) => {
      // Use the synchronous commonjs translator which can deal with cycles.
      const finalFormat = loadContext.format === 'commonjs' ? 'commonjs-sync' : loadContext.format;
      const translateContext = { ...loadResult, format: finalFormat, __proto__: null };
      const wrap = this.#translate(url, translateContext, parentURL);

      const cjsModule = wrap[imported_cjs_symbol];
      if (cjsModule) {
        assert(finalFormat === 'commonjs-sync');
        // Check if the ESM initiating import CJS is being required by the same CJS module.
        if (cjsModule?.[kIsExecuting]) {
          const parentFilename = urlToFilename(parentURL);
          let message = `Cannot import CommonJS Module ${cjsModule.filename} in a cycle.`;
          if (parentFilename) {
            message += ` (from ${parentFilename})`;
          }
          throw new ERR_REQUIRE_CYCLE_MODULE(message);
        }
      }

      return wrap;
    };
    if (isPromise(maybePromise)) {
      return PromisePrototypeThen(maybePromise, afterLoad);
    }
    return afterLoad(maybePromise);
  }

  /**
   * Load a module and translate it into a ModuleWrap for ordinary imported ESM.
   * This may be run asynchronously if there are asynchronous module loader hooks registered.
   * @param {string} url URL of the module to be translated.
   * @param {object} loadContext See {@link load}
   * @param {string|undefined} parentURL URL of the parent module. Undefined if it's the entry point.
   * @returns {Promise<ModuleWrap>|ModuleWrap}
   */
  loadAndTranslate(url, loadContext, parentURL) {
    const maybePromise = this.load(url, loadContext);
    const afterLoad = (loadResult) => {
      const translateContext = { ...loadResult, __proto__: null };
      return this.#translate(url, translateContext, parentURL);
    };
    if (isPromise(maybePromise)) {
      return PromisePrototypeThen(maybePromise, afterLoad);
    }
    return afterLoad(maybePromise);
  }

  /**
   * This method is usually called indirectly as part of the loading processes.
   * Use directly with caution.
   * @param {string} specifier The first parameter of an `import()` expression.
   * @param {string} parentURL Path of the parent importing the module.
   * @param {Record<string, string>} importAttributes Validations for the
   *   module import.
   * @param {number} [phase] The phase of the import.
   * @param {boolean} [isEntryPoint] Whether this is the realm-level entry point.
   * @returns {Promise<ModuleExports>}
   */
  async import(specifier, parentURL, importAttributes, phase = kEvaluationPhase, isEntryPoint = false) {
    return onImport.tracePromise(async () => {
      const request = { specifier, phase, attributes: importAttributes, __proto__: null };
      const moduleJob = await this.getOrCreateModuleJob(parentURL, request);
      if (phase === kSourcePhase) {
        const module = await moduleJob.modulePromise;
        return module.getModuleSourceObject();
      }
      const { module } = await moduleJob.run(isEntryPoint);
      return module.getNamespace();
    }, {
      __proto__: null,
      parentURL,
      url: specifier,
    });
  }

  /**
   * @see {@link AsyncLoaderHookWorkerProxy.register}
   * @returns {any}
   */
  register(specifier, parentURL, data, transferList, isInternal) {
    if (!this.#customizations) {
      // `AsyncLoaderHookWorkerProxy` is defined at the bottom of this file and
      // available well before this line is ever invoked. This is here in
      // order to preserve the git diff instead of moving the class.
      // eslint-disable-next-line no-use-before-define
      this.setCustomizations(new AsyncLoaderHookWorkerProxy());
    }
    return this.#customizations.register(`${specifier}`, `${parentURL}`, data, transferList, isInternal);
  }

  /**
   * Resolve a module request to a URL identifying the location of the module. Handles customization hooks,
   * if any.
   * @param {string} [parentURL] The URL of the module where the module request is initiated.
   *   It's undefined if it's from the root module.
   * @param {ModuleRequest} request Module request.
   * @returns {Promise<{format: string, url: string}>|{format: string, url: string}}
   */
  #resolve(parentURL, request) {
    if (this.isForAsyncLoaderHookWorker) {
      const specifier = `${request.specifier}`;
      const importAttributes = request.attributes ?? kEmptyObject;
      // TODO(joyeecheung): invoke the synchronous hooks in the default step on loader thread.
      return this.#customizations.resolve(specifier, parentURL, importAttributes);
    }

    return this.resolveSync(parentURL, request);
  }

  /**
   * Either return a cached resolution, or perform the default resolution which is synchronous, and
   * cache the result.
   * @param {string} specifier See {@link resolve}.
   * @param {{ parentURL?: string, importAttributes: ImportAttributes, conditions?: string[]}} context
   * @returns {{ format: string, url: string }}
   */
  #cachedDefaultResolve(specifier, context) {
    const { parentURL, importAttributes } = context;
    const requestKey = this.#resolveCache.serializeKey(specifier, importAttributes);
    const cachedResult = this.#resolveCache.get(requestKey, parentURL);
    if (cachedResult != null) {
      return cachedResult;
    }
    defaultResolve ??= require('internal/modules/esm/resolve').defaultResolve;
    const result = defaultResolve(specifier, context);
    this.#resolveCache.set(requestKey, parentURL, result);
    return result;
  }

  /**
   * This is the default resolve step for module.registerHooks(), which incorporates asynchronous hooks
   * from module.register() which are run in a blocking fashion for it to be synchronous.
   * @param {string|URL} specifier See {@link resolveSync}.
   * @param {{ parentURL?: string, importAttributes: ImportAttributes, conditions?: string[]}} context
   *   See {@link resolveSync}.
   * @returns {{ format: string, url: string }}
   */
  #resolveAndMaybeBlockOnLoaderThread(specifier, context) {
    if (this.#customizations?.resolveSync) {
      return this.#customizations.resolveSync(specifier, context.parentURL, context.importAttributes);
    }
    return this.#cachedDefaultResolve(specifier, context);
  }

  /**
   * Similar to {@link resolve}, but the results are always synchronously returned. If there are any
   * asynchronous resolve hooks from module.register(), it will block until the results are returned
   * from the loader thread for this to be synchronous.
   * This is here to support `import.meta.resolve()`, `require()` in imported CJS, and
   * `module.registerHooks()` hooks.
   * @param {string} [parentURL] See {@link resolve}.
   * @param {ModuleRequest} request See {@link resolve}.
   * @returns {{ format: string, url: string }}
   */
  resolveSync(parentURL, request) {
    const specifier = `${request.specifier}`;
    const importAttributes = request.attributes ?? kEmptyObject;

    if (resolveHooks.length) {
      // Has module.registerHooks() hooks, chain the asynchronous hooks in the default step.
      return resolveWithHooks(specifier, parentURL, importAttributes, this.#defaultConditions,
                              this.#resolveAndMaybeBlockOnLoaderThread.bind(this));
    }
    const context = {
      ...request,
      conditions: this.#defaultConditions,
      parentURL,
      importAttributes,
      __proto__: null,
    };
    return this.#resolveAndMaybeBlockOnLoaderThread(specifier, context);
  }

  /**
   * Provide source that is understood by one of Node's translators. Handles customization hooks,
   * if any.
   * @typedef { {format: ModuleFormat, source: ModuleSource }} LoadResult
   * @param {string} url The URL of the module to be loaded.
   * @param {object} context Metadata about the module
   * @returns {Promise<LoadResult> | LoadResult}}
   */
  load(url, context) {
    if (this.isForAsyncLoaderHookWorker) {
      // TODO(joyeecheung): invoke the synchronous hooks in the default step on loader thread.
      return this.#customizations.load(url, context);
    }
    return this.#loadSync(url, context);
  }

  /**
   * This is the default load step for module.registerHooks(), which incorporates asynchronous hooks
   * from module.register() which are run in a blocking fashion for it to be synchronous.
   * @param {string} url See {@link load}
   * @param {object} context See {@link load}
   * @returns {{ format: ModuleFormat, source: ModuleSource }}
   */
  #loadAndMaybeBlockOnLoaderThread(url, context) {
    if (this.#customizations?.loadSync) {
      return this.#customizations.loadSync(url, context);
    }
    defaultLoadSync ??= require('internal/modules/esm/load').defaultLoadSync;
    return defaultLoadSync(url, context);
  }

  /**
   * Similar to {@link load} but this is always run synchronously. If there are asynchronous hooks
   * from module.register(), this blocks on the loader thread for it to return synchronously.
   *
   * This is here to support `require()` in imported CJS and `module.registerHooks()` hooks.
   * @param {string} url See {@link load}
   * @param {object} [context] See {@link load}
   * @returns {{ format: ModuleFormat, source: ModuleSource }}
   */
  #loadSync(url, context) {
    if (loadHooks.length) {
      // Has module.registerHooks() hooks, chain the asynchronous hooks in the default step.
      // TODO(joyeecheung): construct the ModuleLoadContext in the loaders directly instead
      // of converting them from plain objects in the hooks.
      return loadWithHooks(url, context.format, context.importAttributes, this.#defaultConditions,
                           this.#loadAndMaybeBlockOnLoaderThread.bind(this));
    }
    return this.#loadAndMaybeBlockOnLoaderThread(url, context);
  }

  validateLoadResult(url, format) {
    if (format == null) {
      require('internal/modules/esm/load').throwUnknownModuleFormat(url, format);
    }
  }

  importMetaInitialize(meta, context) {
    if (this.#customizations) {
      return this.#customizations.importMetaInitialize(meta, context, this);
    }
    importMetaInitializer ??= require('internal/modules/esm/initialize_import_meta').initializeImportMeta;
    meta = importMetaInitializer(meta, context, this);
    return meta;
  }

  /**
   * No-op when no hooks have been supplied.
   */
  forceLoadHooks() {
    this.#customizations?.forceLoadHooks();
  }
}
ObjectSetPrototypeOf(ModuleLoader.prototype, null);

class AsyncLoaderHookWorkerProxy {

  allowImportMetaResolve = true;
  isForAsyncLoaderHookWorker = false;

  /**
   * Instantiate a module loader that uses user-provided custom loader hooks.
   */
  constructor() {
    getAsyncLoaderWorker();
  }

  /**
   * Register some loader specifier.
   * @param {string} originalSpecifier The specified URL path of the loader to
   *   be registered.
   * @param {string} parentURL The parent URL from where the loader will be
   *   registered if using it package name as specifier
   * @param {any} [data] Arbitrary data to be passed from the custom loader
   *   (user-land) to the worker.
   * @param {any[]} [transferList] Objects in `data` that are changing ownership
   * @param {boolean} [isInternal] For internal loaders that should not be publicly exposed.
   * @returns {{ format: string, url: URL['href'] }}
   */
  register(originalSpecifier, parentURL, data, transferList, isInternal) {
    return asyncLoaderWorker.makeSyncRequest('register', transferList, originalSpecifier, parentURL, data, isInternal);
  }

  /**
   * Resolve the location of the module.
   * @param {string} originalSpecifier The specified URL path of the module to
   *   be resolved.
   * @param {string} [parentURL] The URL path of the module's parent.
   * @param {ImportAttributes} importAttributes Attributes from the import
   *   statement or expression.
   * @returns {{ format: string, url: URL['href'] }}
   */
  resolve(originalSpecifier, parentURL, importAttributes) {
    return asyncLoaderWorker.makeAsyncRequest('resolve', undefined, originalSpecifier, parentURL, importAttributes);
  }

  resolveSync(originalSpecifier, parentURL, importAttributes) {
    // This happens only as a result of `import.meta.resolve` calls, which must be sync per spec.
    return asyncLoaderWorker.makeSyncRequest('resolve', undefined, originalSpecifier, parentURL, importAttributes);
  }

  /**
   * Provide source that is understood by one of Node's translators.
   * @param {URL['href']} url The URL/path of the module to be loaded
   * @param {object} [context] Metadata about the module
   * @returns {Promise<{ format: ModuleFormat, source: ModuleSource }>}
   */
  load(url, context) {
    return asyncLoaderWorker.makeAsyncRequest('load', undefined, url, context);
  }
  loadSync(url, context) {
    return asyncLoaderWorker.makeSyncRequest('load', undefined, url, context);
  }

  importMetaInitialize(meta, context, loader) {
    asyncLoaderWorker.importMetaInitialize(meta, context, loader);
  }

  forceLoadHooks() {
    asyncLoaderWorker.waitForWorker();
  }
}

let emittedLoaderFlagWarning = false;
/**
 * A loader instance is used as the main entry point for loading ES modules. Currently, this is a singleton; there is
 * only one used for loading the main module and everything in its dependency graph, though separate instances of this
 * class might be instantiated as part of bootstrap for other purposes.
 * @returns {ModuleLoader}
 */
function createModuleLoader() {
  let customizations = null;
  // Don't spawn a new worker if custom loaders are disabled. For instance, if
  // we're already in a worker thread created by instantiating
  // AsyncLoaderHookWorkerProxy; doing so would cause an infinite loop.
  if (shouldSpawnLoaderWorker()) {
    const userLoaderPaths = getOptionValue('--experimental-loader');
    if (userLoaderPaths.length > 0) {
      if (!emittedLoaderFlagWarning) {
        const readableURIEncode = (string) => ArrayPrototypeReduce(
          [
            [/'/g, '%27'], // We need to URL-encode the single quote as it's the delimiter for the --import flag.
            [/%22/g, '"'], // We can decode the double quotes to improve readability.
            [/%2F/ig, '/'], // We can decode the slashes to improve readability.
          ],
          (str, { 0: regex, 1: replacement }) => RegExpPrototypeSymbolReplace(hardenRegExp(regex), str, replacement),
          encodeURIComponent(string));
        process.emitWarning(
          '`--experimental-loader` may be removed in the future; instead use `register()`:\n' +
          `--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; ${ArrayPrototypeJoin(
            ArrayPrototypeMap(userLoaderPaths, (loader) => `register(${readableURIEncode(JSONStringify(loader))}, pathToFileURL("./"))`),
            '; ',
          )};'`,
          'ExperimentalWarning',
        );
        emittedLoaderFlagWarning = true;
      }
      customizations = new AsyncLoaderHookWorkerProxy();
    }
  }

  return new ModuleLoader(customizations);
}


/**
 * Get the AsyncLoaderWorker instance. If it is not defined, then create a new one.
 * @returns {AsyncLoaderWorker}
 */
function getAsyncLoaderWorker() {
  if (!asyncLoaderWorker) {
    const { AsyncLoaderWorker } = require('internal/modules/esm/hooks');
    asyncLoaderWorker = new AsyncLoaderWorker();
  }

  return asyncLoaderWorker;
}

let cascadedLoader;

/**
 * This is a singleton ESM loader that integrates the loader hooks, if any.
 * It it used by other internal built-ins when they need to load ESM code
 * while also respecting hooks.
 * When built-ins need access to this loader, they should do
 * require('internal/module/esm/loader').getOrInitializeCascadedLoader()
 * lazily only right before the loader is actually needed, and don't do it
 * in the top-level, to avoid circular dependencies.
 * @returns {ModuleLoader}
 */
function getOrInitializeCascadedLoader() {
  cascadedLoader ??= createModuleLoader();
  return cascadedLoader;
}

/**
 * Register a single loader programmatically.
 * @param {string|URL} specifier
 * @param {string|URL} [parentURL] Base to use when resolving `specifier`; optional if
 *   `specifier` is absolute. Same as `options.parentUrl`, just inline
 * @param {object} [options] Additional options to apply, described below.
 * @param {string|URL} [options.parentURL] Base to use when resolving `specifier`
 * @param {any} [options.data] Arbitrary data passed to the loader's `initialize` hook
 * @param {any[]} [options.transferList] Objects in `data` that are changing ownership
 * @returns {void} We want to reserve the return value for potential future extension of the API.
 * @example
 * ```js
 * register('./myLoader.js');
 * register('ts-node/esm', { parentURL: import.meta.url });
 * register('./myLoader.js', { parentURL: import.meta.url });
 * register('ts-node/esm', import.meta.url);
 * register('./myLoader.js', import.meta.url);
 * register(new URL('./myLoader.js', import.meta.url));
 * register('./myLoader.js', {
 *   parentURL: import.meta.url,
 *   data: { banana: 'tasty' },
 * });
 * register('./myLoader.js', {
 *   parentURL: import.meta.url,
 *   data: someArrayBuffer,
 *   transferList: [someArrayBuffer],
 * });
 * ```
 */
function register(specifier, parentURL = undefined, options) {
  if (parentURL != null && typeof parentURL === 'object' && !isURL(parentURL)) {
    options = parentURL;
    parentURL = options.parentURL;
  }
  getOrInitializeCascadedLoader().register(
    specifier,
    parentURL ?? 'data:',
    options?.data,
    options?.transferList,
  );
}

module.exports = {
  createModuleLoader,
  getAsyncLoaderWorker,
  getOrInitializeCascadedLoader,
  register,
};
