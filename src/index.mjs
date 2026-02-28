import { Observable, Observer } from '@esmj/observable';

let context = null;
let batchDepth = 0;
let batchQueue = new Set();

function untrack(callback) {
  const prevContext = context;
  context = null;
  const result = callback();
  context = prevContext;

  return result;
}

function batch(callback) {
  batchDepth++;
  try {
    callback();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const queue = Array.from(batchQueue);
      batchQueue.clear();
      for (const observable of queue) {
        observable.next();
      }
    }
  }
}

const INTERNAL_OBSERVABLE = Symbol('internal observable');
const ORIGINAL_FUNCTION = Symbol('original function');

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
    const pendings = Array.from(this.#pendings).map((pending) => {
      if (!pending.get[ORIGINAL_FUNCTION]) {
        const originalGet = pending.get.bind(pending);

        pending.get = () => {
          return untrack(() => {
            this.#pendings.delete(pending);
            return originalGet();
          });
        };

        pending.get[ORIGINAL_FUNCTION] = originalGet;
      }

      return pending;
    });

    return pendings;
  }

  unwatch(signal) {
    signal.next = signal.next[ORIGINAL_FUNCTION]
      ? signal.next[ORIGINAL_FUNCTION]
      : signal.next;
    signal.get = signal.get[ORIGINAL_FUNCTION]
      ? signal.get[ORIGINAL_FUNCTION]
      : signal.get;

    return this.unsubscribe(signal);
  }
}

let w = null;

function createWatcher(notify) {
  w = new Watcher(notify);
}
let timer = null;
createWatcher(() => {
  // TODO performance improvement
  clearTimeout(timer);
  timer = setTimeout(() => {
    getPending().forEach((pending) => {
      pending.get();
    });
  }, 0);
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

class Computed extends Observer {
  #dirty = true;
  #running = false;
  #prevContext = null;
  #signal = null;
  #context = this.#createNewContext();
  #callback = null;
  #options = null;
  #revision = 0;
  #sourceRevisions = new Map();

  constructor(callback, options) {
    super();

    this.#callback = callback;
    this.#options = options;

    this.debug = options?.debug;

    this.get = this.get.bind(this);
  }

  #clearContextDependencies() {
    Array.from(this.#context.dependencies.values()).forEach(
      ({ unsubscribe }) => {
        unsubscribe();
      },
    );
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

  #savePrevContext() {
    this.#prevContext = context;
    context = this.#context;
  }

  #restorePrevContext() {
    context = this.#prevContext;
  }

  getRevision() {
    return this.#revision;
  }

  #needsRecompute() {
    for (const [source, savedRevision] of this.#sourceRevisions) {
      // If source is a Computed, recursively validate it first (pull-based).
      // Use untrack to avoid context-tracking side effects during validation.
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
    watch(this);
    this.#signal[INTERNAL_OBSERVABLE].next();
  }

  get() {
    if (this.#running) {
      throw new Error('Cycle detected in computed signal');
    }

    if (!this.#signal) {
      this.#signal = createSignal(this.#run(), this.#options);
    }

    if (this.#dirty) {
      if (this.#sourceRevisions.size === 0 || this.#needsRecompute()) {
        unwatch(this);
        this.#run();
      } else {
        // False alarm from diamond — sources didn't actually change
        this.#dirty = false;
      }
    }

    // Track this Computed as a source in the parent context
    if (typeof context === 'object' && context !== null) {
      context.sourceRevisions.set(this, this.#revision);
    }

    return this.#signal.get();
  }

  #run() {
    this.#running = true;
    this.#dirty = false;

    this.#clearContextDependencies();
    this.#context.sourceRevisions.clear();
    this.#savePrevContext();

    let result;
    try {
      result = this.#callback();
    } catch (e) {
      result = e;
    }

    this.#restorePrevContext();
    this.#sourceRevisions = new Map(this.#context.sourceRevisions);
    this.#running = false;

    // todo test it
    if (result instanceof Promise) {
      result = result
        .then((value) => {
          this.#signal.set(value);
        })
        .catch((e) => {
          this.#signal.set(e);
        });
    }

    if (this.#signal) {
      this.#signal.set(result);
    }

    // Increment revision so downstream computeds can detect the change
    this.#revision++;

    if (result instanceof Error) {
      throw result;
    }

    return result;
  }
}

function computed(callback, options) {
  const instance = new Computed(callback, options);

  return instance;
}

function effect(callback, options) {
  let destructor;

  let c = computed(
    () => {
      destructor?.();
      destructor = callback();
    },
    { equals: () => false, debug: 'effect', ...options },
  );
  c.get();

  watch(c);
  return () => {
    destructor?.();
    unwatch(c);
  };
}

function createSignal(value, options = {}) {
  const equals = options?.equals ?? Object.is;
  let revision = 0;

  const observable = new Observable();
  function get() {
    if (typeof context === 'object' && context !== null) {
      context.dependencies.set(
        observable,
        observable.subscribe(context.observer),
      );

      // Track this signal as a source in the current context
      context.sourceRevisions.set(signal, revision);
    }

    if (value instanceof Error) {
      throw value;
    }

    return value;
  }

  function set(_value) {
    if (!equals(value, _value)) {
      value = _value;
      revision++;

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

  const signal = { get, set, getRevision, [INTERNAL_OBSERVABLE]: observable };

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
};
