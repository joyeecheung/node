// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const {
  ObjectDefineProperty,
} = primordials;

const {
  getLazy,
  defineLazyProperties,
} = require('internal/util');

const internalBuffer = require('internal/buffer');

// These are almost always loaded in even the most basic application so load
// them eagerly.
const Stream = module.exports = require('internal/streams/legacy').Stream;
const utils = require('internal/streams/utils');
Stream.isDisturbed = utils.isDisturbed;
Stream.isErrored = utils.isErrored;
Stream.isReadable = utils.isReadable;
Stream.Readable = require('internal/streams/readable');
Stream.Writable = require('internal/streams/writable');
Stream.Duplex = require('internal/streams/duplex');
Stream.finished = require('internal/streams/end-of-stream');
Stream.destroy = require('internal/streams/destroy');

// Streams that are not necessarily loaded by all kinds of applications are
// lazily loaded:
defineLazyProperties(Stream, 'internal/streams/transform', ['Transform']);
defineLazyProperties(Stream, 'internal/streams/passthrough', ['PassThrough']);
defineLazyProperties(Stream, 'internal/streams/pipeline', ['pipeline']);
defineLazyProperties(Stream, 'internal/streams/compose', ['compose']);
defineLazyProperties(Stream, 'internal/streams/add-abort-signal', ['addAbortSignal']);
const getPromises = getLazy(() => require('stream/promises'));
ObjectDefineProperty(Stream, 'promises', {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() {
    return getPromises();
  }
});

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;

Stream._isUint8Array = require('internal/util/types').isUint8Array;
Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
  return new internalBuffer.FastBuffer(chunk.buffer,
                                       chunk.byteOffset,
                                       chunk.byteLength);
};
