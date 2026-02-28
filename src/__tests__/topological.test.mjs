import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { state, computed, batch } from '../index.mjs';

describe('topological sorting (pull-based validation)', () => {
  it('should not recompute diamond tail more than once', () => {
    //       state s
    //       /     \
    //  computed a  computed b
    //       \     /
    //      computed c
    const s = state(1);
    let aCount = 0;
    let bCount = 0;
    let cCount = 0;

    const a = computed(() => {
      aCount++;
      return s.get() * 2;
    });

    const b = computed(() => {
      bCount++;
      return s.get() * 3;
    });

    const c = computed(() => {
      cCount++;
      return a.get() + b.get();
    });

    assert.equal(c.get(), 5);
    assert.equal(aCount, 1);
    assert.equal(bCount, 1);
    assert.equal(cCount, 1);

    aCount = 0;
    bCount = 0;
    cCount = 0;

    s.set(2);
    assert.equal(c.get(), 10);
    assert.equal(aCount, 1);
    assert.equal(bCount, 1);
    assert.equal(cCount, 1);
  });

  it('should handle deep diamond dependencies', () => {
    //         state s
    //         /     \
    //    computed a  computed b
    //         \     /
    //        computed c
    //            |
    //        computed d
    const s = state(1);
    let dCount = 0;

    const a = computed(() => s.get() + 1);
    const b = computed(() => s.get() + 2);
    const c = computed(() => a.get() + b.get());
    const d = computed(() => {
      dCount++;
      return c.get() * 10;
    });

    assert.equal(d.get(), 50);
    dCount = 0;

    s.set(2);
    assert.equal(d.get(), 70);
    assert.equal(dCount, 1);
  });

  it('should handle multiple diamonds sharing the same source', () => {
    //            state s
    //          / |       \
    //    comp a  comp b  comp c
    //       \   /  \    /
    //      comp d   comp e
    //          \   /
    //         comp f
    const s = state(1);
    let fCount = 0;

    const a = computed(() => s.get() * 1);
    const b = computed(() => s.get() * 2);
    const c = computed(() => s.get() * 3);
    const d = computed(() => a.get() + b.get());
    const e = computed(() => b.get() + c.get());
    const f = computed(() => {
      fCount++;
      return d.get() + e.get();
    });

    assert.equal(f.get(), 8);
    fCount = 0;

    s.set(2);
    assert.equal(f.get(), 16);
    assert.equal(fCount, 1);
  });

  it('should handle diamond with batch', () => {
    const a = state(1);
    const b = state(2);
    let resultCount = 0;

    const left = computed(() => a.get() + b.get());
    const right = computed(() => a.get() * b.get());
    const result = computed(() => {
      resultCount++;
      return left.get() + right.get();
    });

    assert.equal(result.get(), 5);
    resultCount = 0;

    batch(() => {
      a.set(3);
      b.set(4);
    });

    assert.equal(result.get(), 19);
    assert.equal(resultCount, 1);
  });

  it('should recompute only necessary nodes in a chain', () => {
    const s = state(1);
    let aCount = 0;
    let bCount = 0;
    let cCount = 0;

    const a = computed(() => {
      aCount++;
      return s.get() * 2;
    });
    const b = computed(() => {
      bCount++;
      return a.get() + 10;
    });
    const c = computed(() => {
      cCount++;
      return b.get() + 100;
    });

    assert.equal(c.get(), 112);
    aCount = 0;
    bCount = 0;
    cCount = 0;

    s.set(5);
    assert.equal(c.get(), 120);
    assert.equal(aCount, 1);
    assert.equal(bCount, 1);
    assert.equal(cCount, 1);
  });

  it('should not recompute when an unrelated signal changes', () => {
    const a = state(1);
    const b = state(2);
    let count = 0;

    const c = computed(() => {
      count++;
      return a.get() * 10;
    });

    assert.equal(c.get(), 10);
    count = 0;

    b.set(99);
    assert.equal(c.get(), 10);
    assert.equal(count, 0);
  });

  it('should handle conditional dependencies changing', () => {
    const cond = state(true);
    const a = state(1);
    const b = state(2);
    let count = 0;

    const c = computed(() => {
      count++;
      return cond.get() ? a.get() : b.get();
    });

    assert.equal(c.get(), 1);
    count = 0;

    cond.set(false);
    assert.equal(c.get(), 2);
    assert.equal(count, 1);

    count = 0;

    // c no longer depends on a — dependencies re-tracked on each run
    a.set(99);
    assert.equal(c.get(), 2);
  });

  it('should expose revision via getRevision() on state signals', () => {
    const s = state(1);

    assert.equal(s.getRevision(), 0);

    s.set(2);
    assert.equal(s.getRevision(), 1);

    s.set(3);
    assert.equal(s.getRevision(), 2);

    // Same value — revision should not increment
    s.set(3);
    assert.equal(s.getRevision(), 2);
  });

  it('should expose revision via getRevision() on computed signals', () => {
    const s = state(1);
    const c = computed(() => s.get() * 2);

    c.get();
    const initialRevision = c.getRevision();

    s.set(2);
    c.get();
    assert.equal(c.getRevision(), initialRevision + 1);

    s.set(3);
    c.get();
    assert.equal(c.getRevision(), initialRevision + 2);
  });
});
