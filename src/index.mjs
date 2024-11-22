import { Observable, Observer } from '@esmj/observable';

let context = null;

function untrack(callback) {
  const prevContext = context;
  context = null;
  const result = callback();
  context = prevContext;

  return result;
}

const INTERNAL_OBSERVABLE = Symbol('internal observable');
const ORIGINAL_NEXT = Symbol('original next');

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
      signal.next[ORIGINAL_NEXT] = undefined;
    }

    // WATCH Computed
    if (
      signal instanceof Computed &&
      signal.next[ORIGINAL_NEXT] === undefined
    ) {
      const originalNext = signal.next.bind(signal);
      signal.next = () => {
        return untrack(() => {
          this.#pendings.add(signal);

          originalNext();

          this.#notify();
        });
      };
      signal.next[ORIGINAL_NEXT] = originalNext;
    }

    return this.subscribe(signal);
  }

  getPending() {
    const pendings = Array.from(this.#pendings).map((pending) => {
      const originalGet = pending.get.bind(pending);

      pending.get = () => {
        return untrack(() => {
          this.#pendings.delete(pending);
          return originalGet();
        });
      };

      return pending;
    });

    return pendings;
  }

  unwatch(signal) {
    signal.next = signal.next[ORIGINAL_NEXT];

    return this.unsubscribe(signal);
  }
}

let w = null;

function createWatcher(notify) {
  w = new Watcher(notify);
}

createWatcher(() => {
  // TODO performance improvement
  setTimeout(() => {
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
  #prevContext = null;
  #signal = null;
  #context = this.#createNewContext();
  #callback = null;
  #options = null;

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

  next() {
    this.#dirty = true;
    this.#signal[INTERNAL_OBSERVABLE].next();
  }

  get() {
    if (!this.#signal) {
      this.#signal = createSignal(this.#run(), this.#options);
    }

    if (this.#dirty) {
      this.#run();
    }

    return this.#signal.get();
  }

  #run() {
    this.#dirty = false;

    this.#clearContextDependencies();
    this.#savePrevContext();

    let result;
    try {
      result = this.#callback();
    } catch (e) {
      result = e;
    }

    this.#restorePrevContext();

    // todo test it
    if (result instanceof Promise) {
      result = result
        .then((value) => {
          return value;
        })
        .catch((e) => {
          throw e;
        });
    }

    if (this.#signal) {
      this.#signal.set(result);
    }

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

  const observable = new Observable();
  function get() {
    if (typeof context === 'object' && context !== null) {
      context.dependencies.set(
        observable,
        observable.subscribe(context.observer),
      );
    }

    if (value instanceof Error) {
      throw value;
    }

    return value;
  }

  // TODO implement batch updates
  function set(_value) {
    if (!equals(value, _value)) {
      value = _value;

      observable.next();
    }

    return value;
  }

  return { get, set, [INTERNAL_OBSERVABLE]: observable };
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
};
