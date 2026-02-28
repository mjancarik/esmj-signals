import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { state, computed, effect, afterFlush } from '../index.mjs';

describe('peek', () => {
  describe('state', () => {
    it('should read the current value without tracking', () => {
      const s = state(42);

      assert.equal(s.peek(), 42);
    });

    it('should not subscribe when read inside a computed', () => {
      const a = state(1);
      const b = state(2);
      let count = 0;

      const c = computed(() => {
        count++;
        return a.get() + b.peek();
      });

      assert.equal(c.get(), 3);
      assert.equal(count, 1);

      count = 0;

      // b is peeked — changing b should NOT trigger recomputation
      b.set(99);
      assert.equal(c.get(), 3);
      assert.equal(count, 0);

      count = 0;

      // a is tracked — changing a should trigger recomputation and pick up new b
      a.set(10);
      assert.equal(c.get(), 109);
      assert.equal(count, 1);
    });

    it('should not subscribe when read inside an effect', async () => {
      const a = state(1);
      const b = state(2);
      let effectCount = 0;

      const dispose = effect(() => {
        a.get();
        b.peek();
        effectCount++;
      });

      assert.equal(effectCount, 1);
      effectCount = 0;

      // b is peeked — changing b should NOT re-run effect
      b.set(99);

      await afterFlush();
      assert.equal(effectCount, 0);
      dispose();
    });

    it('should reflect the latest value', () => {
      const s = state(1);

      assert.equal(s.peek(), 1);

      s.set(2);
      assert.equal(s.peek(), 2);

      s.set(3);
      assert.equal(s.peek(), 3);
    });

    it('should not throw if value is an Error', () => {
      const s = state(new Error('broken'));

      assert.equal(s.peek().message, 'broken');
    });
  });

  describe('computed', () => {
    it('should read the current value without tracking', () => {
      const s = state(5);
      const c = computed(() => s.get() * 2);

      assert.equal(c.peek(), 10);
    });

    it('should not subscribe when peeked inside another computed', () => {
      const s = state(1);
      const inner = computed(() => s.get() * 10);
      let count = 0;

      const outer = computed(() => {
        count++;
        return inner.peek() + 1;
      });

      assert.equal(outer.get(), 11);
      assert.equal(count, 1);

      count = 0;

      // inner depends on s, but outer peeks inner — changing s should NOT recompute outer
      s.set(2);
      assert.equal(outer.get(), 11);
      assert.equal(count, 0);
    });

    it('should still compute lazy value on first peek', () => {
      const s = state(3);
      const c = computed(() => s.get() * 3);

      // First access via peek — should trigger lazy computation
      assert.equal(c.peek(), 9);
    });

    it('should return up-to-date value when dirty', () => {
      const s = state(1);
      const c = computed(() => s.get() + 100);

      assert.equal(c.peek(), 101);

      s.set(5);
      assert.equal(c.peek(), 105);
    });

    it('should be equivalent to untrack(() => signal.get())', () => {
      const s = state(7);
      const c = computed(() => s.get() * 2);

      const peekResult = c.peek();
      const untrackResult = computed(() => c.peek()).get();

      assert.equal(peekResult, 14);
      assert.equal(untrackResult, 14);
    });
  });
});
