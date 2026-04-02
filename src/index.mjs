import { Observable, Observer } from '@esmj/observable';

const RX_TYPE = Symbol('@esmj/signals:type');
const RX_DEBUG_NAME = Symbol('@esmj/signals:name');

let debugHooks = null;

function setDebugHooks(hooks) {
  debugHooks = hooks;
}

let context = null;
let batchDepth = 0;
let batchQueue = new Set();
let flushScheduled = false;
let flushCallbacks = [];

function untrack(callback) {
  const prevContext = context;
  context = null;
  const result = callback();
  context = prevContext;

  return result;
}

function flushPending() {
  flushScheduled = false;
  const pendings = getPending();
  for (const pending of pendings) {
    pending.get();
  }

  // Run all onFlush callbacks once, then clear
  const callbacks = flushCallbacks;
  flushCallbacks = [];
  for (const cb of callbacks) {
    cb();
  }
}

function scheduleFlush() {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushPending);
  }
}

function onFlush(callback) {
  flushCallbacks.push(callback);

  // Ensure a flush is scheduled so the callback actually runs
  scheduleFlush();
}

function afterFlush() {
  return new Promise((resolve) => onFlush(resolve));
}

function batch(callback) {
  batchDepth++;
  try {
    callback();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const queue = batchQueue;
      batchQueue = new Set();
      for (const observable of queue) {
        observable.next();
      }

      scheduleFlush();
    }
  }
}

const INTERNAL_OBSERVABLE = Symbol('@esmj/signals:internal observable');
const ORIGINAL_FUNCTION = Symbol('@esmj/signals:original function');

class Watcher extends Observable {
  #pendings = new Set();
  #notify = null;

  constructor(notify) {
    super();

    this.#notify = notify;

    this.pipe((observable) => {
      const originalSubscribe = observable.subscribe.bind(observable);
      const originalUnsubscribe = observable.unsubscribe.bind(observable);

      observable.subscribe = (observer) => {
        originalSubscribe(observer);
        this.#pendings.add(observer);
      };

      observable.unsubscribe = (observer) => {
        originalUnsubscribe(observer);
        this.#pendings.delete(observer);
      };

      return observable;
    });
  }
  watch(signal) {
    // Watch State
    if (typeof signal.next !== 'function') {
      signal.next = () => {
        return untrack(() => {
          this.#pendings.add(signal);

          this.#notify();
        });
      };
      signal.next[ORIGINAL_FUNCTION] = undefined;
    }

    // WATCH Computed
    if (
      signal instanceof Computed &&
      signal.next[ORIGINAL_FUNCTION] === undefined
    ) {
      const originalNext = signal.next.bind(signal);
      signal.next = () => {
        return untrack(() => {
          this.#pendings.add(signal);

          originalNext();

          this.#notify();
        });
      };
      signal.next[ORIGINAL_FUNCTION] = originalNext;
    }

    return this.subscribe(signal);
  }

  getPending() {
    const pendings = [];
    for (const pending of this.#pendings) {
      if (!pending.get[ORIGINAL_FUNCTION]) {
        const originalGet = pending.get;
        const boundGet = originalGet.bind(pending);

        pending.get = () => {
          return untrack(() => {
            this.#pendings.delete(pending);
            return boundGet();
          });
        };

        pending.get[ORIGINAL_FUNCTION] = originalGet;
      }

      pendings.push(pending);
    }

    return pendings;
  }

  unwatch(signal) {
    signal.next = signal.next[ORIGINAL_FUNCTION]
      ? signal.next[ORIGINAL_FUNCTION]
      : signal.next;
    signal.get = signal.get[ORIGINAL_FUNCTION]
      ? signal.get[ORIGINAL_FUNCTION]
      : signal.get;

    this.#pendings.delete(signal);

    return this.unsubscribe(signal);
  }
}

let w = null;

function createWatcher(notify) {
  w = new Watcher(notify);
}

createWatcher(() => {
  scheduleFlush();
});

function getPending() {
  return w.getPending();
}

function watch(signal) {
  return w.watch(signal);
}

function unwatch(signal) {
  return w.unwatch(signal);
}

const NO_ERROR = Symbol('@esmj/signals:no error');

class Computed extends Observer {
  #dirty = true;
  #running = false;
  #signal = null;
  #context = this.#createNewContext();
  #callback = null;
  #options = null;
  #revision = 0;
  #sourceRevisions = new Map();
  #error = NO_ERROR;

  constructor(callback, options) {
    super();

    this.#callback = callback;
    this.#options = options;

    this.debug = options?.debug;
    this[RX_TYPE] = 'computed';
    this[RX_DEBUG_NAME] = options?.debug ?? null;

    this.get = this.get.bind(this);

    debugHooks?.onComputedCreate?.(this);
  }

  #clearContextDependencies() {
    for (const { unsubscribe } of this.#context.dependencies.values()) {
      unsubscribe();
    }
    this.#context.dependencies.clear();
  }

  #createNewContext() {
    const context = {
      dependencies: new Map(),
      sourceRevisions: new Map(),
      observer: this,
    };

    return context;
  }

  getRevision() {
    return this.#revision;
  }

  getDebugInfo() {
    return {
      name: this[RX_DEBUG_NAME],
      dirty: this.#dirty,
      revision: this.#revision,
      sourceDependencies: [...this.#sourceRevisions.keys()],
    };
  }

  #needsRecompute() {
    for (const [source, savedRevision] of this.#sourceRevisions) {
      if (source instanceof Computed) {
        untrack(() => source.get());
      }

      if (source.getRevision() !== savedRevision) {
        return true;
      }
    }
    return false;
  }

  next() {
    this.#dirty = true;
    //watch(this);
    this.#signal[INTERNAL_OBSERVABLE].next();
  }

  get() {
    if (this.#running) {
      throw new Error('Cycle detected in computed signal');
    }

    if (!this.#signal) {
      this.#signal = createSignal(this.#run(), this.#options);
    }

    if (this.#dirty || this.#error !== NO_ERROR) {
      if (this.#sourceRevisions.size === 0 || this.#needsRecompute()) {
        //unwatch(this);
        this.#run();
      } else {
        this.#dirty = false;
      }
    }

    if (context) {
      context.sourceRevisions.set(this, this.#revision);
    }

    if (this.#error !== NO_ERROR) {
      throw this.#error;
    }

    return this.#signal.get();
  }

  peek() {
    if (!this.#signal) {
      this.#signal = createSignal(this.#run(), this.#options);
    }

    if (this.#dirty || this.#error !== NO_ERROR) {
      if (this.#sourceRevisions.size === 0 || this.#needsRecompute()) {
        //unwatch(this);
        this.#run();
      } else {
        this.#dirty = false;
      }
    }

    if (this.#error !== NO_ERROR) {
      throw this.#error;
    }

    return this.#signal.peek();
  }

  #run() {
    this.#running = true;
    this.#dirty = false;
    this.#error = NO_ERROR;

    debugHooks?.onComputedRun?.(this);

    this.#clearContextDependencies();
    this.#context.sourceRevisions.clear();

    const prevContext = context;
    context = this.#context;

    let result;
    try {
      result = this.#callback();
    } catch (e) {
      this.#error = e;
    }

    context = prevContext;
    this.#sourceRevisions = this.#context.sourceRevisions;
    this.#context.sourceRevisions = new Map();
    this.#running = false;

    if (result instanceof Promise) {
      result = result
        .then((value) => {
          this.#error = NO_ERROR;
          this.#signal.set(value);
        })
        .catch((e) => {
          this.#error = e;
        });
    }

    if (this.#error === NO_ERROR && this.#signal) {
      this.#signal.set(result);
    }

    this.#revision++;

    return result;
  }

  destroy() {
    this.#clearContextDependencies();
    this.#sourceRevisions.clear();
    this.#dirty = true;
    this.#error = NO_ERROR;
  }
}

function computed(callback, options) {
  const instance = new Computed(callback, options);

  return instance;
}

function effect(callback, options) {
  let destructor;
  const { debug, ...restOptions } = options ?? {};

  let c = computed(
    () => {
      destructor?.();
      destructor = callback();
    },
    { equals: () => false, ...restOptions },
  );
  c.get();

  watch(c);

  const dispose = () => {
    destructor?.();
    c.destroy();
    unwatch(c);
  };

  dispose[Symbol.dispose] = dispose;
  dispose[RX_TYPE] = 'effect';
  dispose[RX_DEBUG_NAME] = debug ?? null;
  dispose.__RX_COMPUTED__ = c;

  debugHooks?.onEffectCreate?.(dispose);

  return dispose;
}

function createSignal(value, options = {}) {
  const equals = options?.equals ?? Object.is;
  let revision = 0;

  const observable = new Observable();
  function get() {
    if (context) {
      context.dependencies.set(
        observable,
        observable.subscribe(context.observer),
      );

      context.sourceRevisions.set(signal, revision);
    }

    return value;
  }

  function peek() {
    return value;
  }

  function set(_value) {
    if (!equals(value, _value)) {
      const prev = value;
      value = _value;
      revision++;

      debugHooks?.onSignalSet?.(signal, prev, _value);

      if (batchDepth > 0) {
        batchQueue.add(observable);
      } else {
        observable.next();
      }
    }

    return value;
  }

  function getRevision() {
    return revision;
  }

  const signal = {
    get,
    set,
    peek,
    getRevision,
    [INTERNAL_OBSERVABLE]: observable,
    [RX_TYPE]: 'signal',
    [RX_DEBUG_NAME]: options?.debug ?? null,
  };

  debugHooks?.onSignalCreate?.(signal);

  return signal;
}

// alias
const state = createSignal;

export {
  createSignal,
  createWatcher,
  state,
  computed,
  effect,
  watch,
  unwatch,
  getPending,
  untrack,
  batch,
  onFlush,
  afterFlush,
  setDebugHooks,
  RX_TYPE,
  RX_DEBUG_NAME,
};
