import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  state,
  computed,
  effect,
  getPending,
  untrack,
  watch,
} from '../index.mjs';

describe('Reactive package', () => {
  describe('state', () => {
    it('signal have get/set methods', () => {
      const signal = state(0);

      assert.equal(signal.get(), 0);
      signal.set(1);
      assert.equal(signal.get(), 1);
    });
  });

  describe('computed', () => {
    it('should be lazy computed and memoized reactive signals', (t) => {
      const signal1 = state(0);
      const signal2 = state(1);
      const signal3 = state(2);

      const someComputed1 = () => signal1.get() + signal2.get();
      const stubSomeComputed1 = t.mock.fn(someComputed1);
      const computed1 = computed(stubSomeComputed1);

      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        0,
        'should be lazy computed',
      );
      assert.equal(computed1.get(), 1);

      assert.equal(stubSomeComputed1.mock?.calls.length, 1);
      signal1.set(1);
      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        1,
        'should be lazy recomputed',
      );

      assert.equal(computed1.get(), 2);
      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        2,
        'should be recomputed',
      );

      signal3.set(3);

      assert.equal(computed1.get(), 2);
      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        2,
        'should be memoized',
      );
    });

    it('should computed value from computed value', (t) => {
      const signal1 = state(0);
      const signal2 = state(1);
      const signal3 = state(2);

      const someComputed1 = () => signal1.get() + signal2.get();
      const stubSomeComputed1 = t.mock.fn(someComputed1);
      const computed1 = computed(stubSomeComputed1, { debug: 'computed1' });

      const someComputed2 = () => computed1.get() + signal3.get();
      const stubSomeComputed2 = t.mock.fn(someComputed2);
      const computed2 = computed(stubSomeComputed2, { debug: 'computed2' });
      watch(computed2);

      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        0,
        'computed1 should be lazy computed',
      );
      assert.equal(
        stubSomeComputed2.mock?.calls.length,
        0,
        'computed2 should be lazy computed',
      );
      assert.equal(computed2.get(), 3);
      assert.equal(computed1.get(), 1);
      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        1,
        'computed1 should be recomputed',
      );
      assert.equal(stubSomeComputed2.mock?.calls.length, 1, '2');

      signal1.set(1);
      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        1,
        'should set dirty to computed1 and keep lazy recomputed',
      );
      assert.equal(
        stubSomeComputed2.mock?.calls.length,
        1,
        'should set dirty to computed2 and keep lazy recomputed',
      );
      assert.equal(computed1.get(), 2);

      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        2,
        'computed1 should be recomputed after get',
      );
      assert.equal(
        stubSomeComputed2.mock?.calls.length,
        1,
        'computed2 should keep dirty',
      );

      assert.equal(computed2.get(), 4);

      assert.equal(
        stubSomeComputed1.mock?.calls.length,
        2,
        'computed1 is memoized',
      );
      assert.equal(
        stubSomeComputed2.mock?.calls.length,
        2,
        'computed2 is recomputed after get',
      );
    });

    it('should re-throw error if computed signal catch error', () => {
      const signal1 = state(0);
      const signal2 = state(1);

      const computedSignal = computed(() => {
        if (signal1.get() === 1) {
          throw new Error('computedSignal');
        }

        return signal1.get() + signal2.get();
      });

      assert.equal(computedSignal.get(), 1, 'computedSignal should be 1');

      signal1.set(1);

      assert.throws(
        () => {
          computedSignal.get();
        },
        {
          name: /^Error$/,
          message: /computedSignal/,
        },
        'should throw error',
      );

      assert.throws(
        () => {
          computedSignal.get();
        },
        {
          name: /^Error$/,
          message: /computedSignal/,
        },
        'should re-throw error',
      );
    });
  });

  describe('effect', () => {
    it('should be reactive for signals and computed signals', (t) => {
      const signal1 = state(0);
      const signal2 = state(1);
      const destructor = t.mock.fn(() => {});

      const computedSignal = computed(() => signal1.get() + signal2.get(), {
        debug: 'computedSignal',
      });
      const someEffect = () => {
        computedSignal.get();
        signal2.get();
        return destructor;
      };

      const stubSomeEffect = t.mock.fn(someEffect);

      effect(stubSomeEffect);

      assert.equal(stubSomeEffect.mock?.calls.length, 1);

      signal2.set(2);
      assert.equal(stubSomeEffect.mock?.calls.length, 1);

      signal1.set(1);
      assert.equal(stubSomeEffect.mock?.calls.length, 1);

      getPending().forEach((pending) => {
        untrack(() => {
          pending.get();
        });
      });

      assert.equal(
        destructor.mock?.calls.length,
        1,
        'effect destructor should be called only once',
      );
      assert.equal(
        stubSomeEffect.mock?.calls.length,
        2,
        'effect should be called 2 times (one init, one recomputed)',
      );
    });
  });
});
