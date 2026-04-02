import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, batch, computed, effect, state } from '../index.mjs';

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

  describe('consecutive state changes through computed chain', () => {
    it('should flush effects on every consecutive state change through a computed chain', async () => {
      const counter = state(0);
      const isEven = computed(() => counter.get() % 2 === 0);
      let effectValue = null;
      let effectRunCount = 0;

      const dispose = effect(() => {
        effectValue = isEven.get();
        effectRunCount++;
      });

      assert.equal(effectValue, true);
      assert.equal(effectRunCount, 1);

      // First change
      counter.set(1);
      await afterFlush();
      assert.equal(
        effectValue,
        false,
        'effect should see isEven=false after counter=1',
      );
      assert.equal(effectRunCount, 2, 'effect should have run twice total');

      // Second change — THIS WAS THE BUG: effect did not fire
      counter.set(2);
      await afterFlush();
      assert.equal(
        effectValue,
        true,
        'effect should see isEven=true after counter=2',
      );
      assert.equal(
        effectRunCount,
        3,
        'effect should have run three times total',
      );

      // Third change — confirm it keeps working
      counter.set(3);
      await afterFlush();
      assert.equal(
        effectValue,
        false,
        'effect should see isEven=false after counter=3',
      );
      assert.equal(
        effectRunCount,
        4,
        'effect should have run four times total',
      );

      dispose();
    });

    it('should flush effects on every change with direct state dependency', async () => {
      const s = state(0);
      let effectRunCount = 0;
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = s.get();
        effectRunCount++;
      });

      assert.equal(effectRunCount, 1);
      assert.equal(effectValue, 0);

      for (let i = 1; i <= 5; i++) {
        s.set(i);
        await afterFlush();
        assert.equal(
          effectRunCount,
          i + 1,
          `effect should have run ${i + 1} times after set(${i})`,
        );
        assert.equal(effectValue, i, `effect should see value ${i}`);
      }

      dispose();
    });

    it('should flush effects on every change with deep computed chain', async () => {
      const s = state(0);
      const a = computed(() => s.get() + 1);
      const b = computed(() => a.get() * 2);
      const c = computed(() => b.get() - 1);
      let effectValue = null;
      let effectRunCount = 0;

      const dispose = effect(() => {
        effectValue = c.get();
        effectRunCount++;
      });

      // s=0 → a=1 → b=2 → c=1
      assert.equal(effectValue, 1);
      assert.equal(effectRunCount, 1);

      // s=1 → a=2 → b=4 → c=3
      s.set(1);
      await afterFlush();
      assert.equal(effectValue, 3);
      assert.equal(effectRunCount, 2);

      // s=2 → a=3 → b=6 → c=5
      s.set(2);
      await afterFlush();
      assert.equal(effectValue, 5);
      assert.equal(effectRunCount, 3);

      // s=3 → a=4 → b=8 → c=7
      s.set(3);
      await afterFlush();
      assert.equal(effectValue, 7);
      assert.equal(effectRunCount, 4);

      dispose();
    });

    it('should flush effects on every change with diamond dependency', async () => {
      const s = state(1);
      const left = computed(() => s.get() * 2);
      const right = computed(() => s.get() * 3);
      const sum = computed(() => left.get() + right.get());
      let effectValue = null;
      let effectRunCount = 0;

      const dispose = effect(() => {
        effectValue = sum.get();
        effectRunCount++;
      });

      assert.equal(effectValue, 5);
      assert.equal(effectRunCount, 1);

      s.set(2);
      await afterFlush();
      assert.equal(effectValue, 10);
      assert.equal(effectRunCount, 2);

      s.set(3);
      await afterFlush();
      assert.equal(effectValue, 15);
      assert.equal(effectRunCount, 3);

      s.set(4);
      await afterFlush();
      assert.equal(effectValue, 20);
      assert.equal(effectRunCount, 4);

      dispose();
    });

    it('should work correctly with batch on every consecutive call', async () => {
      const counter = state(0);
      const doubled = computed(() => counter.get() * 2);
      let effectValue = null;
      let effectRunCount = 0;

      const dispose = effect(() => {
        effectValue = doubled.get();
        effectRunCount++;
      });

      assert.equal(effectValue, 0);
      assert.equal(effectRunCount, 1);

      for (let i = 1; i <= 5; i++) {
        batch(() => {
          counter.set(i);
        });
        await afterFlush();
        assert.equal(
          effectValue,
          i * 2,
          `effect should see doubled=${i * 2} after counter=${i}`,
        );
        assert.equal(
          effectRunCount,
          i + 1,
          `effect should have run ${i + 1} times`,
        );
      }

      dispose();
    });

    it('should schedule flush on every state change without relying on extra microtasks', async () => {
      const counter = state(0);
      const isEven = computed(() => counter.get() % 2 === 0);
      const results = [];

      const dispose = effect(() => {
        results.push(isEven.get());
      });

      assert.deepEqual(results, [true]);

      // Rapidly change state 4 times, then wait once
      counter.set(1);
      counter.set(2);
      counter.set(3);
      counter.set(4);

      await afterFlush();

      // The effect should have settled to the final value
      assert.equal(results[results.length - 1], true);
      // It should have run at least twice (initial + at least one update)
      assert.ok(
        results.length >= 2,
        `effect ran ${results.length} times, expected at least 2`,
      );

      dispose();
    });

    it('should fire effect for each individual awaited change through computed', async () => {
      const counter = state(0);
      const isEven = computed(() => counter.get() % 2 === 0);
      let notifyCount = 0;

      // Track how many times scheduleFlush is actually triggered
      // by counting effect executions after each individual set + flush
      const dispose = effect(() => {
        isEven.get();
        notifyCount++;
      });

      assert.equal(notifyCount, 1);

      for (let i = 1; i <= 6; i++) {
        counter.set(i);
        await afterFlush();
        assert.equal(
          notifyCount,
          i + 1,
          `after set(${i}): effect should have run ${i + 1} times, but ran ${notifyCount} times`,
        );
      }

      dispose();
    });

    it('BUG REPRO: effect should fire on every change without afterFlush scheduling extra flush', async () => {
      const counter = state(0);
      const isEven = computed(() => counter.get() % 2 === 0);
      let effectValue = null;
      let effectRunCount = 0;

      const dispose = effect(() => {
        effectValue = isEven.get();
        effectRunCount++;
      });

      assert.equal(effectValue, true);
      assert.equal(effectRunCount, 1);

      // First change — set and wait with raw microtask (no extra scheduleFlush)
      counter.set(1);
      await Promise.resolve();
      assert.equal(effectValue, false, 'after set(1): effect should see false');
      assert.equal(
        effectRunCount,
        2,
        'after set(1): effect should have run 2 times',
      );

      // Second change — THIS EXPOSES THE BUG
      // The unwrapped .next() calls watch(this) but doesn't call #notify(),
      // so no flush is scheduled. Effect does NOT fire.
      counter.set(2);
      await Promise.resolve();
      assert.equal(effectValue, true, 'after set(2): effect should see true');
      assert.equal(
        effectRunCount,
        3,
        'after set(2): effect should have run 3 times',
      );

      // Third change
      counter.set(3);
      await Promise.resolve();
      assert.equal(effectValue, false, 'after set(3): effect should see false');
      assert.equal(
        effectRunCount,
        4,
        'after set(3): effect should have run 4 times',
      );

      // Fourth change
      counter.set(4);
      await Promise.resolve();
      assert.equal(effectValue, true, 'after set(4): effect should see true');
      assert.equal(
        effectRunCount,
        5,
        'after set(4): effect should have run 5 times',
      );

      dispose();
    });

    it('BUG REPRO: direct state effect should fire on every change without afterFlush', async () => {
      const s = state(0);
      let effectRunCount = 0;
      let effectValue = null;

      const dispose = effect(() => {
        effectValue = s.get();
        effectRunCount++;
      });

      assert.equal(effectRunCount, 1);
      assert.equal(effectValue, 0);

      for (let i = 1; i <= 5; i++) {
        s.set(i);
        await Promise.resolve();
        assert.equal(
          effectRunCount,
          i + 1,
          `after set(${i}): effect should have run ${i + 1} times, but ran ${effectRunCount}`,
        );
        assert.equal(effectValue, i);
      }

      dispose();
    });
  });
});
