import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { state, computed, effect } from '../index.mjs';

describe('flush bug verification', () => {
  it('effect fires on every consecutive change through computed (Promise.resolve)', async () => {
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

    counter.set(1);
    await Promise.resolve();
    assert.equal(effectValue, false, 'after set(1)');
    assert.equal(effectRunCount, 2, 'after set(1): run count');

    counter.set(2);
    await Promise.resolve();
    assert.equal(effectValue, true, 'after set(2)');
    assert.equal(effectRunCount, 3, 'after set(2): run count');

    counter.set(3);
    await Promise.resolve();
    assert.equal(effectValue, false, 'after set(3)');
    assert.equal(effectRunCount, 4, 'after set(3): run count');

    counter.set(4);
    await Promise.resolve();
    assert.equal(effectValue, true, 'after set(4)');
    assert.equal(effectRunCount, 5, 'after set(4): run count');

    dispose();
  });
});
