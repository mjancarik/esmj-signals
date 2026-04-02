import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, batch, computed, effect, state } from '../index.mjs';

describe('batch', () => {
  it('should delay signal notifications until batch ends', () => {
    const a = state(1);
    const b = state(2);
    let computeCount = 0;

    const sum = computed(() => {
      computeCount++;
      return a.get() + b.get();
    });

    // Initial computation
    assert.equal(sum.get(), 3);
    assert.equal(computeCount, 1);

    // Without batch: each set triggers recomputation
    computeCount = 0;
    batch(() => {
      a.set(10);
      b.set(20);
      // During batch, computed should still return stale value
      // (no recomputation yet)
    });

    // After batch, computed should reflect both changes
    assert.equal(sum.get(), 30);
    // Should have recomputed only once (not twice)
    assert.equal(computeCount, 1);
  });

  it('should support nested batches', () => {
    const a = state(1);
    const b = state(2);
    const c = state(3);
    let computeCount = 0;

    const sum = computed(() => {
      computeCount++;
      return a.get() + b.get() + c.get();
    });

    assert.equal(sum.get(), 6);
    computeCount = 0;

    batch(() => {
      a.set(10);
      batch(() => {
        b.set(20);
        c.set(30);
      });
      // Inner batch should NOT flush yet — outer batch still open
    });

    // All three updates should be reflected after outer batch
    assert.equal(sum.get(), 60);
    assert.equal(computeCount, 1);
  });

  it('should work with effects inside batch', async () => {
    const a = state(1);
    const b = state(2);
    let effectCount = 0;

    const dispose = effect(() => {
      a.get();
      b.get();
      effectCount++;
    });

    // effect runs once immediately
    assert.equal(effectCount, 1);

    effectCount = 0;
    batch(() => {
      a.set(10);
      b.set(20);
    });

    await afterFlush();
    assert.ok(effectCount >= 1, 'effect should have run at least once');
    dispose();
  });

  it('should notify immediately when not in a batch', () => {
    const a = state(1);
    let computeCount = 0;

    const doubled = computed(() => {
      computeCount++;
      return a.get() * 2;
    });

    assert.equal(doubled.get(), 2);
    computeCount = 0;

    a.set(5);
    assert.equal(doubled.get(), 10);
    assert.equal(computeCount, 1);
  });

  it('should handle errors in batch without breaking state', () => {
    const a = state(1);

    assert.throws(
      () => {
        batch(() => {
          a.set(10);
          throw new Error('batch error');
        });
      },
      { message: 'batch error' },
    );

    // After error, batch depth should be reset and signal should work normally
    assert.equal(a.get(), 10);

    // Subsequent sets should work without batch
    a.set(20);
    assert.equal(a.get(), 20);
  });
});
