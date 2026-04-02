import type { Signal, ComputedSignal, Dispose } from './index.d.ts';

export interface DependencyNode {
  name: string;
  type: 'signal' | 'computed';
  revision: number;
  /** Only present on `computed` nodes. */
  dirty?: boolean;
  /** Only present on `signal` nodes. */
  value?: unknown;
  /** Only present on `computed` nodes. */
  dependencies?: DependencyNode[];
}

export interface DebugRegistry {
  /** Named signals registered via `debug` option. */
  signals: Map<string, Signal<unknown>>;
  /** Named computed signals registered via `debug` option. */
  computeds: Map<string, ComputedSignal<unknown>>;
  /** Named effects registered via `debug` option. */
  effects: Map<string, Dispose>;
}

export interface DebugOptions {
  /**
   * Set to `false` to suppress all `console.debug` auto-logging.
   * @default true
   */
  log?: boolean;
}

/**
 * Installs browser debug tooling for esmj-rx primitives. Call once at app startup.
 *
 * Features enabled:
 * - Auto-logging on signal set / computed recompute / effect create (requires `debug` name)
 * - `window.__RX__` global registry for console inspection
 * - Chrome DevTools custom formatters (requires "Enable custom formatters" in DevTools)
 */
export function installDebug(options?: DebugOptions): void;

/**
 * Returns a recursive dependency tree for the given computed signal.
 * Useful for inspecting the reactive graph at runtime.
 *
 * @example
 * ```js
 * const count = state(1, { debug: 'count' });
 * const doubled = computed(() => count.get() * 2, { debug: 'doubled' });
 * doubled.get();
 * console.log(getDependencies(doubled));
 * // { name: 'doubled', type: 'computed', dependencies: [{ name: 'count', type: 'signal', value: 1 }] }
 * ```
 */
export function getDependencies(
  computed: ComputedSignal<unknown>,
): DependencyNode | null;

/**
 * Returns the current debug registry.
 */
export function getRegistry(): DebugRegistry;
