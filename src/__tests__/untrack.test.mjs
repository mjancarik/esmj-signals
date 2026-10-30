import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { afterFlush, computed, effect, state, untrack } from '../index.mjs';

describe('untrack exception safety', () => {
  it('restores tracking context when the callback throws', async () => {
    const a = state(1);
    const b = state(10);
    let runs = 0;
    const sum = computed(() => {
      runs++;
      try {
        untrack(() => {
          throw new Error('boom');
        });
      } catch {}
      return a.get() + b.get();
    });
    const dispose = effect(() => {
      sum.get();
    });

    await afterFlush();
    const before = runs;
    b.set(11);
    await afterFlush();

    assert.ok(runs > before);
    assert.equal(sum.get(), 12);
    dispose();
  });
});
