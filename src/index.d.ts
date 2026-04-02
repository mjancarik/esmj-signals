/**
 * A reactive state signal that holds a value and notifies subscribers on change.
 */
export interface Signal<T> {
  /** Returns the current value and registers a dependency if called inside a reactive context. */
  get(): T;
  /** Sets a new value. If the value differs (per the `equals` option), subscribers are notified. */
  set(value: T): T;
  /** Returns the current value without registering a dependency. */
  peek(): T;
  /** Returns the current revision number. Increments on every value change. */
  getRevision(): number;
}

/**
 * A reactive computed signal that derives its value from other signals.
 */
export interface ComputedSignal<T> {
  /** Returns the computed value, recomputing if dirty. Registers a dependency if called inside a reactive context. */
  get(): T;
  /** Returns the computed value without registering a dependency. */
  peek(): T;
  /** Returns the current revision number. Increments on every recomputation. */
  getRevision(): number;
  /** Marks the computed as dirty and notifies the watcher. */
  next(): void;
  /** Destroys the computed signal, clearing all dependencies. */
  destroy(): void;
  /** Returns internal debug metadata. Used by debug tooling. */
  getDebugInfo(): {
    name: string | null;
    dirty: boolean;
    revision: number;
    sourceDependencies: unknown[];
  };
}

/**
 * A dispose function returned by `effect()`. Cleans up the effect and runs the destructor.
 * Supports the `Symbol.dispose` protocol for use with the `using` keyword.
 */
export interface Dispose {
  (): void;
  [Symbol.dispose]: Dispose;
}

/**
 * Options for creating a signal or computed signal.
 */
export interface SignalOptions<T> {
  /**
   * Custom equality function to determine if the value has changed.
   * Defaults to `Object.is`.
   * Return `true` if values are equal (no update), `false` if different (trigger update).
   */
  equals?: (previous: T, next: T) => boolean;
  /** Debug label for the signal. */
  debug?: string;
}

/**
 * Creates a reactive state signal with the given initial value.
 *
 * @example
 * ```js
 * const count = createSignal(0);
 * count.get(); // 0
 * count.set(1);
 * count.get(); // 1
 * ```
 */
export function createSignal<T>(
  value: T,
  options?: SignalOptions<T>,
): Signal<T>;

/**
 * Alias for `createSignal`.
 *
 * @example
 * ```js
 * const count = state(0);
 * count.set(count.get() + 1);
 * ```
 */
export function state<T>(value: T, options?: SignalOptions<T>): Signal<T>;

/**
 * Creates a reactive computed signal that derives its value from other signals.
 * The computation is lazy — it only runs when the value is read.
 *
 * @example
 * ```js
 * const count = state(1);
 * const doubled = computed(() => count.get() * 2);
 * doubled.get(); // 2
 * count.set(3);
 * doubled.get(); // 6
 * ```
 */
export function computed<T>(
  callback: () => T,
  options?: SignalOptions<T>,
): ComputedSignal<T>;

/**
 * Creates a reactive effect that runs immediately and re-runs whenever
 * its dependencies change. Returns a dispose function to stop the effect.
 *
 * The callback may return a destructor function that is called before
 * each re-run and on disposal.
 *
 * @example
 * ```js
 * const count = state(0);
 * const dispose = effect(() => {
 *   console.log(count.get());
 *   return () => console.log('cleanup');
 * });
 *
 * count.set(1);
 * await afterFlush(); // logs: "cleanup", "1"
 *
 * dispose(); // logs: "cleanup"
 * ```
 */
export function effect(
  callback: () => undefined | (() => void),
  options?: SignalOptions<unknown>,
): Dispose;

/**
 * Creates a new watcher with the given notification callback.
 * Replaces the current global watcher.
 *
 * @example
 * ```js
 * createWatcher(() => {
 *   console.log('something changed');
 * });
 * ```
 */
export function createWatcher(notify: () => void): void;

/**
 * Registers a computed signal with the global watcher.
 * The watcher will be notified when the signal changes.
 *
 * @returns An unsubscribe handle.
 */
export function watch(signal: ComputedSignal<unknown>): {
  unsubscribe: () => void;
};

/**
 * Unregisters a computed signal from the global watcher.
 * Removes it from pending and restores any wrapped methods.
 */
export function unwatch(signal: ComputedSignal<unknown>): void;

/**
 * Returns an array of pending computed signals that have been
 * marked dirty but not yet recomputed.
 *
 * @example
 * ```js
 * const s = state(0);
 * const c = computed(() => s.get());
 * c.get();
 * watch(c);
 * s.set(1);
 * getPending(); // [c]
 * ```
 */
export function getPending(): ComputedSignal<unknown>[];

/**
 * Executes a callback without tracking any signal dependencies.
 * Useful for reading signals inside effects or computed without
 * creating a dependency.
 *
 * @example
 * ```js
 * const a = state(1);
 * const b = state(2);
 * const c = computed(() => {
 *   return a.get() + untrack(() => b.get());
 * });
 * // c depends on `a` but NOT on `b`
 * ```
 */
export function untrack<T>(callback: () => T): T;

/**
 * Groups multiple signal updates into a single flush cycle.
 * Effects are deferred until the outermost batch completes.
 * Supports nesting — only the outermost batch triggers a flush.
 *
 * @example
 * ```js
 * const a = state(1);
 * const b = state(2);
 *
 * batch(() => {
 *   a.set(10);
 *   b.set(20);
 * });
 *
 * await afterFlush();
 * // Effects run once with both values updated
 * ```
 */
export function batch(callback: () => void): void;

/**
 * Registers a one-shot callback that runs after the next flush cycle completes
 * (i.e. after all pending effects have been executed). The callback is removed
 * after it runs and does not persist across flush cycles.
 *
 * If no flush is currently scheduled, calling `onFlush` schedules one.
 *
 * @example
 * ```js
 * const count = state(0);
 * effect(() => {
 *   document.title = `Count: ${count.get()}`;
 * });
 *
 * count.set(42);
 * onFlush(() => {
 *   // DOM is now updated
 *   console.log(document.title); // "Count: 42"
 * });
 * ```
 */
export function onFlush(callback: () => void): void;

/**
 * Returns a promise that resolves after the next flush cycle completes.
 * Convenience wrapper around `onFlush` for async/await usage.
 *
 * @example
 * ```js
 * const count = state(0);
 * effect(() => console.log(count.get()));
 *
 * count.set(42);
 * await afterFlush();
 * // Effect has run, all side effects settled
 * ```
 */
export function afterFlush(): Promise<void>;

/**
 * Symbol attached to signal, computed, and effect primitives to identify their type.
 * Values: `'signal'` | `'computed'` | `'effect'`
 */
export declare const RX_TYPE: unique symbol;

/**
 * Symbol attached to signal, computed, and effect primitives that carry the `debug` label.
 */
export declare const RX_DEBUG_NAME: unique symbol;

/**
 * Lifecycle hooks used by debug tooling.
 * All callbacks are optional.
 */
export interface DebugHooks {
  onSignalCreate?: (signal: Signal<unknown>) => void;
  onSignalSet?: (signal: Signal<unknown>, prev: unknown, next: unknown) => void;
  onComputedCreate?: (computed: ComputedSignal<unknown>) => void;
  onComputedRun?: (computed: ComputedSignal<unknown>) => void;
  onEffectCreate?: (dispose: Dispose) => void;
}

/**
 * Registers debug lifecycle hooks. Called internally by `installDebug()` from `debug.mjs`.
 * Hooks are null-guarded: passing `null` or omitting a hook disables it at zero cost.
 */
export function setDebugHooks(hooks: DebugHooks | null): void;
