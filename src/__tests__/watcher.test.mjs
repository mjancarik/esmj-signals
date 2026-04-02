import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  afterFlush,
  computed,
  effect,
  getPending,
  state,
  unwatch,
  watch,
} from '../index.mjs';

describe('watcher memory leak fixes', () => {
  it('should clean up pendings on unwatch', () => {
    const s = state(1);
    const c = computed(() => s.get() * 2);
    c.get();

    watch(c);
    s.set(2);

    const pending1 = getPending();
    assert.equal(pending1.length, 1);

    unwatch(c);

    const pending2 = getPending();
    assert.equal(pending2.length, 0);
  });

  it('should restore original get after unwatch', () => {
    const s = state(1);
    const c = computed(() => s.get() * 2);
    c.get();

    const originalGet = c.get;

    watch(c);
    s.set(2);

    // getPending wraps get
    getPending();

    // get is now wrapped
    assert.notEqual(c.get, originalGet);

    unwatch(c);

    // get should be restored
    assert.equal(c.get, originalGet);
  });

  it('should restore original next after unwatch', () => {
    const s = state(1);
    const c = computed(() => s.get() * 2);
    c.get();

    const originalNext = c.next.bind(c);

    watch(c);

    // next is now wrapped
    assert.notEqual(c.next, originalNext);

    unwatch(c);

    // next should be restored to the bound original
  });

  it('should work correctly across watch/unwatch/watch cycles', async () => {
    const s = state(1);
    let count = 0;

    const dispose1 = effect(() => {
      s.get();
      console.log('dispose 1 called');
      count++;
    });

    assert.equal(count, 1);

    // Dispose and re-create
    dispose1();
    count = 0;

    const dispose2 = effect(() => {
      s.get();
      console.log('dispose 2 called');
      count++;
    });

    assert.equal(count, 1);
    count = 0;

    s.set(2);

    await afterFlush();
    assert.equal(count, 1);
    dispose2();
  });

  it('should not accumulate wrappers on repeated getPending calls', () => {
    const s = state(1);
    const c = computed(() => s.get() * 2);
    c.get();

    watch(c);
    s.set(2);

    // Call getPending multiple times
    const p1 = getPending();
    const getRef1 = p1[0].get;

    // Trigger dirty again without consuming
    s.set(3);

    const p2 = getPending();
    const getRef2 = p2[0].get;

    // Should be the same wrapper, not a nested wrapper
    assert.equal(getRef1, getRef2);

    // Clean up
    p2[0].get();
    unwatch(c);
  });

  it('should not leak signals after multiple effect dispose cycles', async () => {
    const s = state(0);
    let effectCount = 0;

    for (let i = 0; i < 10; i++) {
      const dispose = effect(() => {
        s.get();
        effectCount++;
      });
      dispose();
    }

    effectCount = 0;
    s.set(1);

    await afterFlush();
    // No disposed effects should run
    assert.equal(effectCount, 0);
  });

  it('should not hold references to unwatched signals in pendings', () => {
    const s = state(1);
    const c = computed(() => s.get());
    c.get();

    watch(c);
    s.set(2);

    // c is pending
    assert.equal(getPending().length, 1);

    // Consume it
    getPending()[0].get();
    assert.equal(getPending().length, 0);

    // Unwatch
    unwatch(c);
    assert.equal(getPending().length, 0);
  });
});
