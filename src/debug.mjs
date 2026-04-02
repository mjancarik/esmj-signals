import { RX_DEBUG_NAME, RX_TYPE, setDebugHooks } from './index.mjs';

// ─── Registry ────────────────────────────────────────────────────────────────

const registry = {
  signals: new Map(),
  computeds: new Map(),
  effects: new Map(),
};

function getRegistry() {
  return registry;
}

// ─── Dependency graph ────────────────────────────────────────────────────────

/**
 * Returns a recursive dependency tree for the given computed signal.
 * @param {object} computedSignal
 * @param {number} [_depth] - internal recursion guard
 */
function getDependencies(computedSignal, _depth = 0) {
  if (!computedSignal?.getDebugInfo) return null;

  const info = computedSignal.getDebugInfo();
  const node = {
    name: info.name ?? '(anonymous)',
    type: 'computed',
    revision: info.revision,
    dirty: info.dirty,
    dependencies: [],
  };

  if (_depth < 20) {
    for (const dep of info.sourceDependencies) {
      if (dep?.getDebugInfo) {
        node.dependencies.push(getDependencies(dep, _depth + 1));
      } else if (dep?.[RX_TYPE] === 'signal') {
        node.dependencies.push({
          name: dep[RX_DEBUG_NAME] ?? '(anonymous)',
          type: 'signal',
          value: dep.peek(),
          revision: dep.getRevision(),
        });
      }
    }
  }

  return node;
}

// ─── Chrome DevTools custom formatter ────────────────────────────────────────
// Spec: https://docs.google.com/document/d/1FTascZXT9cxfetuPRT2eXPQKXui4nWFivUnS_335T3U

function row(label, value) {
  return [
    'div',
    { style: 'padding-left:14px; font-family:monospace; font-size:12px' },
    ['span', { style: 'color:#9ca3af' }, `${label}: `],
    ['object', { object: value }],
  ];
}

const devtoolsFormatter = {
  header(obj) {
    if (!obj || !obj[RX_TYPE]) return null;

    const type = obj[RX_TYPE];
    const name = obj[RX_DEBUG_NAME];

    if (type === 'signal') {
      const label = name ? `Signal[${name}]` : 'Signal';
      return [
        'div',
        { style: 'color:#8b5cf6; font-weight:bold; font-family:monospace' },
        label,
        ': ',
        ['object', { object: obj.peek() }],
      ];
    }

    if (type === 'computed') {
      const label = name ? `Computed[${name}]` : 'Computed';
      let value;
      try {
        value = obj.peek();
      } catch {
        value = '(error)';
      }
      return [
        'div',
        { style: 'color:#06b6d4; font-weight:bold; font-family:monospace' },
        label,
        ': ',
        ['object', { object: value }],
      ];
    }

    if (type === 'effect') {
      const label = name ? `Effect[${name}]` : 'Effect';
      return [
        'div',
        { style: 'color:#f59e0b; font-weight:bold; font-family:monospace' },
        label,
      ];
    }

    return null;
  },

  hasBody(obj) {
    return Boolean(obj?.[RX_TYPE]);
  },

  body(obj) {
    const type = obj[RX_TYPE];
    const rows = [];

    if (type === 'signal') {
      rows.push(
        row('type', 'signal'),
        row('name', obj[RX_DEBUG_NAME] ?? '(anonymous)'),
        row('value', obj.peek()),
        row('revision', obj.getRevision()),
      );
    }

    if (type === 'computed') {
      const info = obj.getDebugInfo?.() ?? {};
      let value;
      try {
        value = obj.peek();
      } catch (e) {
        value = e;
      }
      rows.push(
        row('type', 'computed'),
        row('name', info.name ?? '(anonymous)'),
        row('value', value),
        row('revision', info.revision),
        row('dirty', info.dirty),
      );
      if (info.sourceDependencies?.length) {
        rows.push(row('dependencies', getDependencies(obj)));
      }
    }

    if (type === 'effect') {
      rows.push(
        row('type', 'effect'),
        row('name', obj[RX_DEBUG_NAME] ?? '(anonymous)'),
      );
      if (obj.__RX_COMPUTED__) {
        rows.push(row('graph', getDependencies(obj.__RX_COMPUTED__)));
      }
    }

    return ['div', {}, ...rows];
  },
};

// ─── installDebug ─────────────────────────────────────────────────────────────

let installed = false;

/**
 * Installs browser debug tooling for esmj-rx primitives.
 *
 * Must be called once at app startup (before creating signals you want tracked).
 *
 * Enables:
 * - Auto-logging on signal set / computed recompute / effect create (when `debug` name is set)
 * - Global registry (`window.__RX__`) for console inspection
 * - Chrome DevTools custom formatters for signals, computeds, and effects
 *
 * @param {{ log?: boolean }} [options]
 *   - `log`: set to `false` to silence all `console.debug` output (default: `true`)
 */
function installDebug(options = {}) {
  if (installed) return;
  installed = true;

  const log = options.log !== false;

  setDebugHooks({
    onSignalCreate(signal) {
      const name = signal[RX_DEBUG_NAME];
      if (!name) return;
      registry.signals.set(name, signal);
      // eslint-disable-next-line no-console
      if (log) console.debug(`[signal:${name}] created`);
    },

    onSignalSet(signal, prev, next) {
      const name = signal[RX_DEBUG_NAME];
      // eslint-disable-next-line no-console
      if (name && log) console.debug(`[signal:${name}]`, prev, '→', next);
    },

    onComputedCreate(computed) {
      const name = computed[RX_DEBUG_NAME];
      if (!name) return;
      registry.computeds.set(name, computed);
      // eslint-disable-next-line no-console
      if (log) console.debug(`[computed:${name}] created`);
    },

    onComputedRun(computed) {
      const name = computed[RX_DEBUG_NAME];
      // eslint-disable-next-line no-console
      if (name && log) console.debug(`[computed:${name}] recomputing`);
    },

    onEffectCreate(dispose) {
      const name = dispose[RX_DEBUG_NAME];
      if (!name) return;
      registry.effects.set(name, dispose);
      // eslint-disable-next-line no-console
      if (log) console.debug(`[effect:${name}] created`);
    },
  });

  if (typeof window !== 'undefined') {
    window.devtoolsFormatters = window.devtoolsFormatters ?? [];
    window.devtoolsFormatters.push(devtoolsFormatter);

    window.__RX__ = {
      signals: registry.signals,
      computeds: registry.computeds,
      effects: registry.effects,
      getDependencies,
      getRegistry,
      /**
       * Inspect a named signal or computed in the console.
       * @param {string} name
       */
      inspect(name) {
        const target =
          registry.signals.get(name) ?? registry.computeds.get(name);
        if (!target) {
          // eslint-disable-next-line no-console
          console.warn(`[__RX__] no signal/computed named "${name}"`);
          return;
        }
        // eslint-disable-next-line no-console
        console.debug(target);
      },
    };
  }
}

export { installDebug, getDependencies, getRegistry, devtoolsFormatter };
