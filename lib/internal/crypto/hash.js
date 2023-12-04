'use strict';

const {
  ObjectSetPrototypeOf,
  ReflectApply,
  Symbol,
} = primordials;

const {
  Hash: _Hash,
  HashJob,
  Hmac: _Hmac,
  kCryptoJobAsync,
  oneShotDigest,
} = internalBinding('crypto');

const {
  getStringOption,
  jobPromise,
  normalizeHashName,
  validateMaxBufferLength,
  kHandle,
  getCachedHashId,
  getHashCache,
} = require('internal/crypto/util');
const assert = require('internal/assert');
const {
  prepareSecretKey,
} = require('internal/crypto/keys');

const {
  lazyDOMException,
  normalizeEncoding,
  encodingsMap,
} = require('internal/util');

const {
  Buffer,
} = require('buffer');

const {
  codes: {
    ERR_CRYPTO_HASH_FINALIZED,
    ERR_CRYPTO_HASH_UPDATE_FAILED,
    ERR_INVALID_ARG_TYPE,
  },
} = require('internal/errors');

const {
  validateEncoding,
  validateString,
  validateUint32,
  validateBuffer,
} = require('internal/validators');

const {
  isArrayBufferView,
} = require('internal/util/types');

const LazyTransform = require('internal/streams/lazy_transform');

const kUpdate = Symbol('kUpdate');
const kBufferData = Symbol('kBufferData');
const kFinishBuffering = Symbol('kFinishBuffering');
const kState = Symbol('kState');
const kFinalized = Symbol('kFinalized');

function Hash(algorithm, options) {
  if (!new.target)
    return new Hash(algorithm, options);
  const isCopy = algorithm instanceof Hash;
  if (!isCopy)
    validateString(algorithm, 'algorithm');
  const xofLen = typeof options === 'object' && options !== null ?
    options.outputLength : undefined;
  if (xofLen !== undefined)
    validateUint32(xofLen, 'options.outputLength');

  if (isCopy) {
    const original = algorithm;
    this[kState] = { ...original[kState] };
    const handle = original[kHandle];
    if (handle !== null) {
      this[kHandle] = new _Hash(handle, this[kState].xofLen, this[kState].algorithmId, getHashCache());
    }
  } else {
    const algorithmId = getCachedHashId(algorithm);
    const disableBuffering = !!(options?.disableBuffering);
    this[kState] = {
      __proto__: null,
      updateCount: 0,
      // Lookup the cached ID from JS land because it's faster than decoding
      // the string in C++ land.
      algorithmId,
      algorithm,
      xofLen,
      bufferedData: null,
      bufferedDataEncodingId: -1,
      disableBuffering,
      [kFinalized]: false,
    };

    // For unsupported aliases, create the Hash object immediately. If the algorithm is
    // invalid, it fails now.
    if (algorithmId === -1 || disableBuffering) {
      this[kHandle] = new _Hash(algorithm, xofLen, algorithmId, getHashCache());
    } else {
      // Delay the handle creation.
      this[kHandle] = null;
    }
  }

  ReflectApply(LazyTransform, this, [options]);
}

ObjectSetPrototypeOf(Hash.prototype, LazyTransform.prototype);
ObjectSetPrototypeOf(Hash, LazyTransform);

Hash.prototype.copy = function copy(options) {
  const state = this[kState];
  if (state[kFinalized])
    throw new ERR_CRYPTO_HASH_FINALIZED();

  return new Hash(this, options, state);
};

Hash.prototype._transform = function _transform(chunk, encoding, callback) {
  this[kUpdate](chunk, encoding);
  callback();
};

Hash.prototype._flush = function _flush(callback) {
  this.push(this.digest());
  callback();
};

Hash.prototype[kBufferData] = function bufferData(data, encoding) {
  const state = this[kState];
  assert(state.bufferedData === null, 'buffered data must be null when before buffering starts');
  assert(!state[kFinalized], 'hash must not be finalized before buffering starts');
  state.bufferedData = data;
  state.bufferedDataEncodingId = encoding;
};

Hash.prototype[kFinishBuffering] = function finishBuffering() {
  const state = this[kState];
  assert(state.bufferedData !== null, 'buffered data must exist when buffering is finished');
  const { bufferedData, bufferedDataEncodingId } = state;
  state.bufferedData = null;
  state.bufferedDataEncodingId = -1;
  return { bufferedData, bufferedDataEncodingId };
};

Hash.prototype[kUpdate] = function internalUpdate(data, encoding) {
  const state = this[kState];
  if (state[kFinalized])
    throw new ERR_CRYPTO_HASH_FINALIZED();

  state.updateCount += 1;

  let encodingId;
  if (typeof data === 'string' && (typeof encoding === 'string' || encoding == null)) {
    encoding = normalizeEncoding(encoding) || encoding;
    encodingId = encodingsMap[encoding];
  }

  // Handle creation was delayed.
  if (this[kHandle] === null) {
    // This is the first time update() is invoked and we are either getting
    // a string with known encoding or an ArrayBufferView.
    if (state.updateCount === 1 && !state.disableBuffering &&
        (encodingId !== undefined || isArrayBufferView(data))) {
      // Buffer the update and return.
      this[kBufferData](data, encodingId);
      return true;
    }
    // Either update() has been invoked before, or disableBuffering is set,
    // or we are getting a data that cannot be buffered. Create the handle now.
    this[kHandle] = new _Hash(state.algorithm, state.xofLen, state.algorithmId, getHashCache());

  }

  // At this point we have a handle. If there is a buffered update, update it now.
  if (state.bufferedData !== null) {
    const { bufferedData, bufferedDataEncodingId } = this[kFinishBuffering]();
    // Do the buffered update now. The string encoding can be empty
    // here because the numeric encoding ID is known and will be used instead.
    this[kHandle].update(bufferedData, '', bufferedDataEncodingId);
  }

  // Do the update for the data passed to this update() call.
  return this[kHandle].update(data, encoding, encodingId);
};

Hash.prototype.update = function update(data, encoding) {
  if (typeof data === 'string') {
    validateEncoding(data, encoding);
  } else if (!isArrayBufferView(data)) {
    throw new ERR_INVALID_ARG_TYPE(
      'data', ['string', 'Buffer', 'TypedArray', 'DataView'], data);
  }

  if (!this[kUpdate](data, encoding)) {
    throw new ERR_CRYPTO_HASH_UPDATE_FAILED();
  }
  return this;
};

Hash.prototype.digest = function digest(outputEncoding) {
  const state = this[kState];
  if (state[kFinalized])
    throw new ERR_CRYPTO_HASH_FINALIZED();
  state[kFinalized] = true;

  let outputEncodingId;
  if (typeof outputEncoding === 'string') {
    outputEncoding = normalizeEncoding(outputEncoding) || outputEncoding;
    outputEncodingId = encodingsMap[outputEncoding];
  } else if (outputEncoding) {
    // Explicit conversion of truthy values for backward compatibility.
    outputEncoding = `${outputEncoding}`;
  } else {
    outputEncoding = 'buffer';
  }

  if (this[kHandle] !== null) {
    // No buffered update, just invoke digest().
    return this[kHandle].digest(outputEncoding, outputEncodingId);
  }

  // There's still buffered update, which means update() must only be invoked once.
  assert(state.updateCount === 1);
  const { bufferedData, bufferedDataEncodingId } = this[kFinishBuffering]();

  // Use empty string as encoding string because it will always be ignored since
  // we provide the numeric bufferedDataEncodingId.
  const inputEncoding = '';
  return oneShotDigest(state.algorithm, state.algorithmId, getHashCache(),
                       bufferedData, inputEncoding, bufferedDataEncodingId,
                       outputEncoding, outputEncodingId);
};

function Hmac(hmac, key, options) {
  if (!(this instanceof Hmac))
    return new Hmac(hmac, key, options);
  validateString(hmac, 'hmac');
  const encoding = getStringOption(options, 'encoding');
  key = prepareSecretKey(key, encoding);
  this[kHandle] = new _Hmac();
  this[kHandle].init(hmac, key);
  this[kState] = {
    [kFinalized]: false,
  };
  ReflectApply(LazyTransform, this, [options]);
}

ObjectSetPrototypeOf(Hmac.prototype, LazyTransform.prototype);
ObjectSetPrototypeOf(Hmac, LazyTransform);

Hmac.prototype.update = Hash.prototype.update;

Hmac.prototype.digest = function digest(outputEncoding) {
  const state = this[kState];

  if (state[kFinalized]) {
    const buf = Buffer.from('');
    if (outputEncoding && outputEncoding !== 'buffer')
      return buf.toString(outputEncoding);
    return buf;
  }

  // Explicit conversion of truthy values for backward compatibility.
  const ret = this[kHandle].digest(outputEncoding && `${outputEncoding}`);
  state[kFinalized] = true;
  return ret;
};

Hmac.prototype._flush = Hash.prototype._flush;
Hmac.prototype._transform = Hash.prototype._transform;

// Implementation for WebCrypto subtle.digest()

async function asyncDigest(algorithm, data) {
  validateMaxBufferLength(data, 'data');

  switch (algorithm.name) {
    case 'SHA-1':
      // Fall through
    case 'SHA-256':
      // Fall through
    case 'SHA-384':
      // Fall through
    case 'SHA-512':
      return jobPromise(() => new HashJob(
        kCryptoJobAsync,
        normalizeHashName(algorithm.name),
        data));
  }

  throw lazyDOMException('Unrecognized algorithm name', 'NotSupportedError');
}

function digest(algorithm, input, options) {
  validateString(algorithm, 'algorithm');
  if (typeof input !== 'string') {
    validateBuffer(input, 'input');
  }
  let { inputEncoding, outputEncoding } = options;

  if (inputEncoding === undefined) {
    inputEncoding = 'utf8';
  } else {
    validateString(inputEncoding, 'options.inputEncoding');
    inputEncoding = normalizeEncoding(inputEncoding) || inputEncoding;
  }
  if (outputEncoding === undefined) {
    outputEncoding = 'buffer';
  } else {
    validateString(outputEncoding, 'options.outputEncoding');
    outputEncoding = normalizeEncoding(outputEncoding) || outputEncoding;
  }

  return oneShotDigest(algorithm, getCachedHashId(algorithm), getHashCache(),
                       input, inputEncoding, encodingsMap[inputEncoding],
                       outputEncoding, encodingsMap[outputEncoding]);
}
module.exports = {
  Hash,
  Hmac,
  asyncDigest,
  digest,
};
