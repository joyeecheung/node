'use strict';

const { safeToString } = internalBinding('util');
const {
  tickInfo,
  promiseRejectEvents: {
    kPromiseRejectWithNoHandler,
    kPromiseHandlerAddedAfterReject,
    kPromiseResolveAfterResolved,
    kPromiseRejectAfterResolved
  },
  setPromiseRejectCallback
} = internalBinding('task_queue');

// *Must* match Environment::TickInfo::Fields in src/env.h.
const kHasPromiseRejections = 1;
const kUnhandledRejectionName = 'UnhandledPromiseRejectionWarning';

class RejectionProcessor {
  constructor(warningConstructor, nextTick) {
    this.maybeUnwarnedPromises = new WeakMap();
    this.rejectionsWithoutHandler = [];
    this.rejectionsHandledTooLate = [];
    this.lastUnwarnedRejectionId = 0;
    this.hasWarnedDeprecation = false;
    this.warningConstructor = warningConstructor;
    this.nextTick = nextTick;
  }

  setHasRejectionToWarn(value) {
    tickInfo[kHasPromiseRejections] = value ? 1 : 0;
  }

  hasRejectionToWarn() {
    return tickInfo[kHasPromiseRejections] === 1;
  }

  // Sets the per-isolate promise rejection callback
  startListening() {
    setPromiseRejectCallback(this.rejectionHandler.bind(this));
  }

  // Called by PromiseRejectCallback in node_task_queue.cc
  rejectionHandler(type, promise, reason) {
    switch (type) {
      case kPromiseRejectWithNoHandler:
        this.maybeUnwarnedPromises.set(promise, {
          reason,
          uid: ++this.lastUnwarnedRejectionId,
          warned: false
        });
        this.rejectionsWithoutHandler.push(promise);
        this.setHasRejectionToWarn(true);
        return;

      case kPromiseHandlerAddedAfterReject:
        const promiseInfo = this.maybeUnwarnedPromises.get(promise);
        if (promiseInfo === undefined) {
          this.setHasRejectionToWarn(false);
          return;
        }
        this.maybeUnwarnedPromises.delete(promise);
        if (!promiseInfo.warned) {
          this.setHasRejectionToWarn(false);
          return;
        }
        const { uid } = promiseInfo;
        // Generate the warning object early to get a good stack trace.
        // eslint-disable-next-line no-restricted-syntax
        const warning = new Error('Promise rejection was handled ' +
                                  `asynchronously (rejection id: ${uid})`);
        warning.name = 'PromiseRejectionHandledWarning';
        warning.id = uid;
        this.rejectionsHandledTooLate.push({ promise, warning });
        this.setHasRejectionToWarn(true);
        return;

      // We have to wrap this in a next tick.
      // Otherwise the error could be caught by the executed promise.
      case kPromiseResolveAfterResolved:
        this.nextTick(() => {
          process.emit('multipleResolves', 'resolve', promise, reason);
        });
        this.setHasRejectionToWarn(false);
        return;

      case kPromiseRejectAfterResolved:
        this.nextTick(() => {
          process.emit('multipleResolves', 'reject', promise, reason);
        });
        this.setHasRejectionToWarn(false);
    }
  }

  emitUnhandledRejectionWarnings(uid, reason) {
    let originalReasonStack;
    // 1. Emit warning for the reason itself.
    try {
      if (reason instanceof Error) {
        // Save the warning stack to overwrite later
        originalReasonStack = reason.stack;
        process.emitWarning(reason.stack, kUnhandledRejectionName,
                            this.warningConstructor);
      } else {
        process.emitWarning(safeToString(reason), kUnhandledRejectionName,
                            this.warningConstructor);
      }
    } catch {}

    // 2. Emit warning for unhandled promise rejection.
    // eslint-disable-next-line no-restricted-syntax
    const warning = new Error(
      'Unhandled promise rejection. This error originated either by ' +
      'throwing inside of an async function without a catch block, ' +
      'or by rejecting a promise which was not handled with .catch(). ' +
      `(rejection id: ${uid})`
    );
    warning.name = kUnhandledRejectionName;
    if (originalReasonStack) {
      warning.stack = originalReasonStack;
    }
    process.emitWarning(warning, this.warningConstructor);

    // 3. Emit warning for unhandled rejection deprecation, if it has not
    //    been emitted before.
    if (!this.hasWarnedDeprecation) {
      this.hasWarnedDeprecation = true;
      process.emitWarning(
        'Unhandled promise rejections are deprecated. In the future, ' +
        'promise rejections that are not handled will terminate the ' +
        'Node.js process with a non-zero exit code.',
        'DeprecationWarning',
        'DEP0018',
        this.warningConstructor);
    }
  }

  // If this method returns true, then at least one more tick need to be
  // scheduled to process any potential pending rejections
  processAndScheduleTicks() {
    while (this.rejectionsHandledTooLate.length > 0) {
      const { promise, warning } = this.rejectionsHandledTooLate.shift();
      if (!process.emit('rejectionHandled', promise)) {
        process.emitWarning(warning, this.warningConstructor);
      }
    }

    let maybeScheduledTicks = false;
    let len = this.rejectionsWithoutHandler.length;
    while (len--) {
      const promise = this.rejectionsWithoutHandler.shift();
      const promiseInfo = this.maybeUnwarnedPromises.get(promise);
      if (promiseInfo !== undefined) {
        promiseInfo.warned = true;
        const { reason, uid } = promiseInfo;
        if (!process.emit('unhandledRejection', reason, promise)) {
          this.emitUnhandledRejectionWarnings(uid, reason);
        }
        maybeScheduledTicks = true;
      }
    }
    return maybeScheduledTicks || this.rejectionsWithoutHandler.length !== 0;
  }
}

module.exports = {
  RejectionProcessor
};
