import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { state, computed } from '../index.mjs';

describe('cycle detection', () => {
  it('should detect a direct self-referencing computed', () => {
    let c;
    c = computed(() => c.get() + 1);

    assert.throws(() => c.get(), {
      message: 'Cycle detected in computed signal',
    });
  });

  it('should detect a two-node cycle (A -> B -> A)', () => {
    const a = computed(() => b.get() + 1);
    const b = computed(() => a.get() + 1);

    assert.throws(() => a.get(), {
      message: 'Cycle detected in computed signal',
    });
  });

  it('should detect a three-node cycle (A -> B -> C -> A)', () => {
    const a = computed(() => c.get() + 1);
    const b = computed(() => a.get() + 1);
    const c = computed(() => b.get() + 1);

    assert.throws(() => a.get(), {
      message: 'Cycle detected in computed signal',
    });
  });

  it('should not false-positive on diamond dependencies', () => {
    //       state s
    //       /     \
    //  computed a  computed b
    //       \     /
    //      computed c
    const s = state(1);
    const a = computed(() => s.get() * 2);
    const b = computed(() => s.get() * 3);
    const c = computed(() => a.get() + b.get());

    assert.equal(c.get(), 5);

    s.set(2);
    assert.equal(c.get(), 10);
  });

  it('should not false-positive on sequential reads of the same computed', () => {
    const s = state(5);
    const c = computed(() => s.get() * 2);

    assert.equal(c.get(), 10);
    assert.equal(c.get(), 10);

    s.set(3);
    assert.equal(c.get(), 6);
    assert.equal(c.get(), 6);
  });

  it('should not false-positive when computed is read from multiple other computeds', () => {
    const s = state(1);
    const shared = computed(() => s.get() * 10);
    const a = computed(() => shared.get() + 1);
    const b = computed(() => shared.get() + 2);

    assert.equal(a.get(), 11);
    assert.equal(b.get(), 12);

    s.set(2);
    assert.equal(a.get(), 21);
    assert.equal(b.get(), 22);
  });

  it('should reset running flag after cycle error so subsequent reads work', () => {
    const s = state(1);
    let shouldCycle = true;

    let c;
    c = computed(() => {
      if (shouldCycle) {
        return c.get();
      }
      return s.get() * 2;
    });

    assert.throws(() => c.get(), {
      message: 'Cycle detected in computed signal',
    });

    // After fixing the cycle, the computed should work again
    shouldCycle = false;
    s.set(5);
    assert.equal(c.get(), 10);
  });
});
