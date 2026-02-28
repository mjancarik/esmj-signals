import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { state, effect, afterFlush } from '../index.mjs';

describe('Symbol.dispose', () => {
  it('should have Symbol.dispose on the dispose function', () => {
    const s = state(1);
    const dispose = effect(() => {
      s.get();
    });

    assert.equal(typeof dispose[Symbol.dispose], 'function');

    dispose();
  });

  it('should stop the effect when Symbol.dispose is called', async () => {
    const s = state(1);
    let count = 0;

    const dispose = effect(() => {
      s.get();
      count++;
    });

    assert.equal(count, 1);

    // Call via Symbol.dispose
    dispose[Symbol.dispose]();

    count = 0;
    s.set(2);

    await afterFlush();
    assert.equal(count, 0);
  });

  it('should work with using keyword', async () => {
    const s = state(1);
    let count = 0;

    {
      using dispose = effect(() => {
        s.get();
        count++;
      });

      assert.equal(count, 1);
      assert.ok(dispose);
    }
    // dispose[Symbol.dispose]() called automatically here

    count = 0;
    s.set(2);

    await afterFlush();
    assert.equal(count, 0);
  });

  it('should call destructor when disposed via Symbol.dispose', () => {
    let cleaned = false;

    const dispose = effect(() => {
      return () => {
        cleaned = true;
      };
    });

    assert.equal(cleaned, false);

    dispose[Symbol.dispose]();
    assert.equal(cleaned, true);
  });

  it('should be safe to call dispose multiple times', () => {
    const s = state(1);
    let cleanupCount = 0;

    const dispose = effect(() => {
      s.get();
      return () => {
        cleanupCount++;
      };
    });

    dispose();
    assert.equal(cleanupCount, 1);

    // Second call should not throw
    dispose[Symbol.dispose]();
  });

  it('should be the same function reference', () => {
    const s = state(1);
    const dispose = effect(() => {
      s.get();
    });

    assert.strictEqual(dispose, dispose[Symbol.dispose]);

    dispose();
  });
});
