# @esmj/signals

A tiny, fine-grained reactive signals library for JavaScript. Built as a lightweight wrapper around the [TC39 Signals proposal](https://github.com/tc39/proposal-signals), providing a ready-to-use API today that aligns with the future standard.

## Installation

```bash
npm install @esmj/signals
```

## Quick Start

```javascript
import { state, computed, effect } from '@esmj/signals';

const count = state(0);
const doubled = computed(() => count.get() * 2);

effect(() => {
  console.log(`Count: ${count.get()}, Doubled: ${doubled.get()}`);
});
// logs: "Count: 0, Doubled: 0"

count.set(5);
// logs: "Count: 5, Doubled: 10"
```

## Motivation

The [TC39 Signals proposal](https://github.com/tc39/proposal-signals) aims to bring reactive primitives to the JavaScript language. This library provides a lightweight implementation of the same concepts so you can start using signals today with minimal overhead. When the proposal lands natively, migration should be straightforward.

## API

### `state(value, options?)`

Creates a reactive signal (also exported as `createSignal`).

```javascript
import { state } from '@esmj/signals';

const name = state('Alice');

// Read the value
name.get(); // 'Alice'

// Write a new value
name.set('Bob');
name.get(); // 'Bob'
```

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `equals` | `(a, b) => boolean` | `Object.is` | Custom equality function. Notifications are skipped when `equals` returns `true`. |

```javascript
// Signal that always notifies on set, even with the same value
const counter = state(0, { equals: () => false });

// Signal with deep equality (e.g. using a library)
const data = state({ a: 1 }, { equals: deepEqual });
```

### `computed(callback, options?)`

Creates a lazy, memoized derived signal. The callback is not executed until `.get()` is first called. Recomputation only occurs when a dependency changes.

```javascript
import { state, computed } from '@esmj/signals';

const firstName = state('John');
const lastName = state('Doe');

const fullName = computed(() => `${firstName.get()} ${lastName.get()}`);

fullName.get(); // 'John Doe'

firstName.set('Jane');
fullName.get(); // 'Jane Doe'
```

#### Chained computeds

Computed signals can depend on other computed signals:

```javascript
const a = state(1);
const b = computed(() => a.get() * 2);
const c = computed(() => b.get() + 10);

c.get(); // 12

a.set(5);
c.get(); // 20
```

#### Options

Same as `state` options (`equals`).

### `effect(callback, options?)`

Creates a side effect that automatically re-runs whenever its dependencies change. Returns a dispose function to stop the effect.

```javascript
import { state, effect } from '@esmj/signals';

const count = state(0);

const dispose = effect(() => {
  console.log('Count is:', count.get());
});
// logs: "Count is: 0"

count.set(1);
// logs: "Count is: 1"

// Stop the effect
dispose();
count.set(2);
// (nothing logged)
```

#### Explicit Resource Management (`using`)

The dispose function supports [`Symbol.dispose`](https://github.com/tc39/proposal-explicit-resource-management), enabling automatic cleanup with the `using` keyword:

```javascript
{
  using dispose = effect(() => {
    console.log('Count is:', count.get());
  });

  count.set(1);
  // effect is active
}
// ← effect automatically disposed when block exits
```

#### Cleanup / Destructor

If the effect callback returns a function, it will be called before each re-execution and on disposal:

```javascript
const visible = state(true);

const dispose = effect(() => {
  if (visible.get()) {
    const handler = () => console.log('clicked');
    document.addEventListener('click', handler);

    // Cleanup: runs before next effect execution or on dispose
    return () => {
      document.removeEventListener('click', handler);
    };
  }
});

visible.set(false); // cleanup runs, listener removed
dispose();
```

### `batch(callback)`

Batches multiple signal updates into a single notification. Computed signals and effects are only notified once after the batch completes, preventing intermediate (glitchy) states.

```javascript
import { state, computed, batch } from '@esmj/signals';

const a = state(1);
const b = state(2);
let computeCount = 0;

const sum = computed(() => {
  computeCount++;
  return a.get() + b.get();
});

sum.get(); // 3, computeCount === 1

batch(() => {
  a.set(10);
  b.set(20);
  // No recomputation happens here
});

sum.get(); // 30, computeCount === 2 (only one recomputation!)
```

#### Nested batches

Inner batches do not flush until the outermost batch completes:

```javascript
batch(() => {
  a.set(10);
  batch(() => {
    b.set(20);
    c.set(30);
  });
  // Still batched — nothing flushed yet
});
// Now all three updates are flushed at once
```

### Efficient Updates (Pull-based Validation)

The library uses pull-based validation with revision tracking to avoid redundant recomputations in diamond dependency graphs:

```
      state A
      /     \
computed B  computed C
      \     /
     computed D
```

When `A` changes, both `B` and `C` are marked dirty, which also marks `D` dirty. However, when `D.get()` is called, it first validates its sources by pulling their current values. Each source is validated recursively before `D` decides whether to recompute. This means `D` recomputes **exactly once**, not twice.

```javascript
import { state, computed } from '@esmj/signals';

const a = state(1);
const b = computed(() => a.get() * 2);
const c = computed(() => a.get() * 3);
const d = computed(() => b.get() + c.get());

d.get(); // 5

a.set(2);
d.get(); // 10 — d recomputed only once, not twice
```

#### Revision tracking

Every signal tracks a revision number that increments on each value change. This allows downstream computed signals to detect whether a source actually changed or if the dirty flag was a false alarm.

```javascript
const s = state(1);
s.getRevision(); // 0

s.set(2);
s.getRevision(); // 1

// Same value — revision does not increment
s.set(2);
s.getRevision(); // 1
```

### `untrack(callback)`

Executes a callback without tracking any signal dependencies. Useful inside effects or computed signals when you want to read a signal without subscribing to it.

```javascript
import { state, computed, untrack } from '@esmj/signals';

const a = state(1);
const b = state(2);

const result = computed(() => {
  // `a` is tracked — changes to `a` will recompute
  const aVal = a.get();

  // `b` is NOT tracked — changes to `b` will NOT recompute
  const bVal = untrack(() => b.get());

  return aVal + bVal;
});

result.get(); // 3

b.set(100);
result.get(); // 3 (not recomputed because b is untracked)

a.set(10);
result.get(); // 110 (recomputed, picks up current b value)
```

### `signal.peek()`

Reads the current value of a signal without subscribing to it. Available on both `state` and `computed` signals. A concise alternative to `untrack(() => signal.get())`.

```javascript
import { state, computed } from '@esmj/signals';

const count = state(5);
count.peek(); // 5 — no tracking

const doubled = computed(() => count.get() * 2);
doubled.peek(); // 10 — no tracking

// Useful inside computed/effects to read without creating a dependency
const a = state(1);
const b = state(2);

const result = computed(() => {
  // a is tracked, b is not
  return a.get() + b.peek();
});

result.get(); // 3

b.set(100);
result.get(); // 3 (b is not tracked)

a.set(10);
result.get(); // 110 (recomputed, picks up current b)
```

### `watch(signal)` / `unwatch(signal)` / `getPending()`

Low-level API for building custom scheduling. Used internally to manage effect execution.

```javascript
import { computed, watch, unwatch, getPending } from '@esmj/signals';

const c = computed(() => /* ... */);

// Register a signal with the global watcher
watch(c);

// Get all signals with pending updates
const pending = getPending();
pending.forEach((p) => p.get());

// Unregister a signal
unwatch(c);
```

### `createWatcher(notify)`

Creates a custom watcher with a custom notification strategy. Replaces the default watcher (which uses `queueMicrotask`).

```javascript
import { createWatcher, getPending } from '@esmj/signals';

// Synchronous flush strategy
createWatcher(() => {
  for (const pending of getPending()) {
    pending.get();
  }
});

// Or requestAnimationFrame-based strategy for UI
createWatcher(() => {
  requestAnimationFrame(() => {
    for (const pending of getPending()) {
      pending.get();
    }
  });
});
```

### `onFlush(callback)`

Registers a one-shot callback that runs **once** after the next flush cycle completes (i.e. after all pending effects have run). Useful for DOM measurements, post-update coordination, or any work that depends on effects being settled.

```javascript
import { state, effect, onFlush } from '@esmj/signals';

const count = state(0);

effect(() => {
  document.title = `Count: ${count.get()}`;
});

count.set(42);

onFlush(() => {
  // DOM is now updated — safe to measure
  console.log(document.title); // "Count: 42"
});
```

Multiple callbacks are supported and run in registration order:

```javascript
onFlush(() => console.log('first'));
onFlush(() => console.log('second'));
// After flush: "first", "second"
```

Callbacks are one-shot — they do not persist across flush cycles:

```javascript
onFlush(() => console.log('once'));

count.set(1);
// after flush: logs "once"

count.set(2);
// after flush: (nothing — callback was cleared)
```

### `afterFlush()`

Returns a promise that resolves after the next flush cycle completes. A convenience wrapper around `onFlush`. Especially useful in async code and tests:

```javascript
import { state, effect, afterFlush } from '@esmj/signals';

const count = state(0);

effect(() => {
  console.log(count.get());
});

count.set(42);

await afterFlush();
// All effects have run, all side effects settled
```

Works seamlessly with `batch`:

```javascript
import { state, effect, batch, afterFlush } from '@esmj/signals';

const a = state(1);
const b = state(2);
let sum = null;

effect(() => {
  sum = a.get() + b.get();
});

batch(() => {
  a.set(10);
  b.set(20);
});

await afterFlush();
console.log(sum); // 30
```

## Flush Strategy

Effects are scheduled to run via `queueMicrotask` after signal updates. This means they run **before the next paint** but **after the current synchronous code finishes**:

```javascript
const count = state(0);
let logged = null;

effect(() => {
  logged = count.get();
});
// logged === 0

count.set(1);
// logged === 0 (microtask hasn't run yet)

await afterFlush();
// logged === 1 (microtask ran)
```

Multiple `set()` calls are coalesced — the effect runs only once:

```javascript
count.set(1);
count.set(2);
count.set(3);
await afterFlush();
// effect ran once with count === 3
```

## Error Handling

Errors in `computed` callbacks are captured and re-thrown on `.get()` or `.peek()`. The error state is tracked separately from the value, so **state signals can hold `Error` objects as legitimate values**:

```javascript
import { state, computed } from '@esmj/signals';

// State signals can store Error objects — they are values, not errors
const validationError = state(new Error('field required'));
validationError.get(); // Error { message: 'field required' } — returned, not thrown

// Computed signals throw when their callback throws
const a = state(0);
const safe = computed(() => {
  if (a.get() === 0) {
    throw new Error('Cannot be zero');
  }
  return 100 / a.get();
});

try {
  safe.get();
} catch (e) {
  console.log(e.message); // 'Cannot be zero'
}

// Recovers when dependency changes
a.set(5);
safe.get(); // 20
```

Errors propagate through computed chains:

```javascript
const source = state(0);
const a = computed(() => {
  if (source.get() === 0) throw new Error('bad');
  return source.get() * 2;
});
const b = computed(() => a.get() + 10);

try {
  b.get(); // throws 'bad' — propagated from a
} catch (e) {}

source.set(5);
b.get(); // 20 — recovered
```

### Cycle Detection

Circular dependencies between computed signals are detected and throw a clear error instead of causing a stack overflow:

```javascript
import { computed } from '@esmj/signals';

const a = computed(() => b.get() + 1);
const b = computed(() => a.get() + 1);

try {
  a.get();
} catch (e) {
  console.log(e.message); // 'Cycle detected in computed signal'
}
```

This applies to any cycle length — self-referencing, two-node, three-node, etc. Diamond dependencies (where multiple paths lead to the same signal without a cycle) are handled correctly and do not trigger false positives.

## TC39 Signals Proposal Alignment

This library follows the API shape and semantics of the [TC39 Signals proposal](https://github.com/tc39/proposal-signals):

| TC39 Proposal | @esmj/signals | Status |
|---------------|---------------|--------|
| `Signal.State` | `state` / `createSignal` | ✅ |
| `Signal.Computed` | `computed` | ✅ |
| `Signal.subtle.Watcher` | `createWatcher` / `watch` / `unwatch` | ✅ |
| `Signal.subtle.untrack` | `untrack` | ✅ |
| `Signal.subtle.Watcher.prototype.getPending` | `getPending` | ✅ |
| Effect (userland in proposal) | `effect` | ✅ |
| Batch (userland in proposal) | `batch` | ✅ |

## Exports

| Export | Description |
|--------|-------------|
| `state` | Create a reactive signal (alias: `createSignal`) |
| `createSignal` | Create a reactive signal |
| `computed` | Create a derived/memoized signal |
| `effect` | Create a reactive side effect |
| `batch` | Batch multiple updates |
| `untrack` | Read signals without tracking |
| `signal.peek()` | Read signal value without tracking |
| `watch` | Register a signal with the watcher |
| `unwatch` | Unregister a signal from the watcher |
| `getPending` | Get pending signals |
| `createWatcher` | Create a custom watcher |
| `onFlush` | Register a one-shot post-flush callback |
| `afterFlush` | Returns a promise that resolves after flush |

## License

[MIT](./LICENSE)
