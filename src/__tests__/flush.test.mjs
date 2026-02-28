import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { state, computed, effect, batch, afterFlush } from '../index.mjs';

describe('flush strategies', () => {
  describe('microtask flush', () => {
    it('should flush effects via microtask after set()', async () => {
      const s = state(0);
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = s.get();
      });

      assert.equal(effectValue, 0);

      s.set(42);

      // Effect hasn't run yet synchronously
      assert.equal(effectValue, 0);

      // Wait for microtask
      await afterFlush();

      assert.equal(effectValue, 42);

      dispose();
    });

    it('should coalesce multiple set() calls into one flush', async () => {
      const s = state(0);
      let count = 0;

      const dispose = effect(() => {
        s.get();
        count++;
      });

      assert.equal(count, 1);
      count = 0;

      s.set(1);
      s.set(2);
      s.set(3);

      await afterFlush();

      // Effect should have run only once for the last value
      assert.equal(count, 1);
      assert.equal(s.get(), 3);

      dispose();
    });

    it('should flush before setTimeout', async () => {
      const s = state(0);
      const order = [];

      const dispose = effect(() => {
        if (s.get() > 0) {
          order.push('effect');
        }
      });

      setTimeout(() => order.push('timeout'), 0);

      s.set(1);

      await afterFlush();

      assert.equal(order[0], 'effect');

      dispose();

      // Wait for setTimeout to complete
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should run effect before next await in async function', async () => {
      const s = state(0);
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = s.get();
      });

      s.set(99);
      await afterFlush();

      // By this point the microtask has run
      assert.equal(effectValue, 99);

      dispose();
    });
  });

  describe('microtask flush after batch', () => {
    it('should flush effects via microtask after batch', async () => {
      const s = state(0);
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = s.get();
      });

      assert.equal(effectValue, 0);

      batch(() => {
        s.set(42);
        // Effect hasn't run yet — still inside batch
        assert.equal(effectValue, 0);
      });

      // Effect hasn't run yet — microtask hasn't fired
      assert.equal(effectValue, 0);

      await afterFlush();

      // Effect has run after microtask flush
      assert.equal(effectValue, 42);

      dispose();
    });

    it('should run effects only once after batch with multiple updates', async () => {
      const a = state(1);
      const b = state(2);
      let count = 0;

      const dispose = effect(() => {
        a.get();
        b.get();
        count++;
      });

      assert.equal(count, 1);
      count = 0;

      batch(() => {
        a.set(10);
        b.set(20);
      });

      await afterFlush();

      assert.equal(count, 1);

      dispose();
    });

    it('should handle nested batches with one flush', async () => {
      const s = state(0);
      let count = 0;

      const dispose = effect(() => {
        s.get();
        count++;
      });

      assert.equal(count, 1);
      count = 0;

      batch(() => {
        s.set(1);
        batch(() => {
          s.set(2);
          batch(() => {
            s.set(3);
          });
          // Inner batches don't flush
          assert.equal(count, 0);
        });
        assert.equal(count, 0);
      });

      // Still not flushed — waiting for microtask
      assert.equal(count, 0);

      await afterFlush();

      // Only one flush after outermost batch
      assert.equal(count, 1);

      dispose();
    });

    it('should flush computed + effect chain after batch', async () => {
      const a = state(1);
      const b = state(2);
      const sum = computed(() => a.get() + b.get());
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = sum.get();
      });

      assert.equal(effectValue, 3);

      batch(() => {
        a.set(10);
        b.set(20);
      });

      await afterFlush();

      assert.equal(effectValue, 30);

      dispose();
    });

    it('should not double-flush when batch is followed by microtask', async () => {
      const s = state(0);
      let count = 0;

      const dispose = effect(() => {
        s.get();
        count++;
      });

      assert.equal(count, 1);
      count = 0;

      batch(() => {
        s.set(1);
      });

      await afterFlush();

      // Flushed once
      assert.equal(count, 1);

      // Second await should NOT re-flush
      await afterFlush();
      assert.equal(count, 1);

      dispose();
    });
  });

  describe('diamond with flush', () => {
    it('should flush diamond graph correctly after batch', async () => {
      const s = state(1);
      const a = computed(() => s.get() * 2);
      const b = computed(() => s.get() * 3);
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = a.get() + b.get();
      });

      assert.equal(effectValue, 5);

      batch(() => {
        s.set(2);
      });

      await afterFlush();

      assert.equal(effectValue, 10);

      dispose();
    });

    it('should flush diamond graph correctly via microtask', async () => {
      const s = state(1);
      const a = computed(() => s.get() * 2);
      const b = computed(() => s.get() * 3);
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = a.get() + b.get();
      });

      assert.equal(effectValue, 5);

      s.set(2);
      await afterFlush();

      assert.equal(effectValue, 10);

      dispose();
    });
  });
});
