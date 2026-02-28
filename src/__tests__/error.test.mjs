import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { state, computed, effect, afterFlush } from '../index.mjs';

describe('error handling', () => {
  describe('state signals can hold Error values', () => {
    it('should store and return an Error object as a value', () => {
      const err = new Error('validation failed');
      const s = state(err);

      assert.equal(s.get(), err);
      assert.equal(s.get().message, 'validation failed');
    });

    it('should store an Error via set()', () => {
      const s = state('ok');

      assert.equal(s.get(), 'ok');

      const err = new Error('something broke');
      s.set(err);

      assert.equal(s.get(), err);
      assert.equal(s.get().message, 'something broke');
    });

    it('should peek an Error value without throwing', () => {
      const err = new Error('peeked');
      const s = state(err);

      assert.equal(s.peek(), err);
    });

    it('should store an array of Errors', () => {
      const errors = state([new Error('a'), new Error('b')]);

      assert.equal(errors.get().length, 2);
      assert.equal(errors.get()[0].message, 'a');
    });

    it('should store custom error subclasses', () => {
      class ValidationError extends Error {
        constructor(field, message) {
          super(message);
          this.field = field;
        }
      }

      const err = new ValidationError('email', 'invalid');
      const s = state(err);

      assert.equal(s.get(), err);
      assert.equal(s.get().field, 'email');
    });
  });

  describe('computed signals throw on callback errors', () => {
    it('should throw when the callback throws', () => {
      const c = computed(() => {
        throw new Error('compute failed');
      });

      assert.throws(() => c.get(), { message: 'compute failed' });
    });

    it('should throw on peek when the callback throws', () => {
      const c = computed(() => {
        throw new Error('compute failed');
      });

      assert.throws(() => c.peek(), { message: 'compute failed' });
    });

    it('should recover when dependency changes and callback succeeds', () => {
      const s = state(0);
      const c = computed(() => {
        const v = s.get();
        if (v === 0) {
          throw new Error('cannot be zero');
        }
        return 100 / v;
      });

      assert.throws(() => c.get(), { message: 'cannot be zero' });

      s.set(5);
      assert.equal(c.get(), 20);
    });

    it('should re-throw on subsequent get() calls while still errored', () => {
      const c = computed(() => {
        throw new Error('always fails');
      });

      assert.throws(() => c.get(), { message: 'always fails' });
      assert.throws(() => c.get(), { message: 'always fails' });
    });

    it('should propagate errors through computed chains', () => {
      const s = state(0);
      const a = computed(() => {
        if (s.get() === 0) {
          throw new Error('source error');
        }
        return s.get() * 2;
      });

      const b = computed(() => a.get() + 10);

      assert.throws(() => b.get(), { message: 'source error' });

      s.set(5);
      assert.equal(b.get(), 20);
    });

    it('should not confuse Error values in state with computed errors', () => {
      const err = new Error('stored value');
      const s = state(err);

      const c = computed(() => {
        const val = s.get();
        return val.message.toUpperCase();
      });

      // Error is a value in state, computed reads it and processes it
      assert.equal(c.get(), 'STORED VALUE');
    });
  });

  describe('effects and errors', () => {
    it('should not break effect when computed dependency throws', async () => {
      const s = state(0);
      let effectError = null;
      let effectCount = 0;

      const c = computed(() => {
        if (s.get() === 0) {
          throw new Error('bad');
        }
        return s.get();
      });

      const dispose = effect(() => {
        effectCount++;
        try {
          c.get();
        } catch (e) {
          effectError = e;
        }
      });

      assert.equal(effectCount, 1);
      assert.equal(effectError?.message, 'bad');

      effectError = null;
      s.set(5);

      await afterFlush();
      assert.equal(effectError, null);
      dispose();
    });
  });

  describe('error types', () => {
    it('should handle non-Error thrown values', () => {
      const c = computed(() => {
        throw 'string error';
      });

      assert.throws(
        () => c.get(),
        (err) => err === 'string error',
      );
    });

    it('should handle thrown numbers', () => {
      const c = computed(() => {
        throw 42;
      });

      assert.throws(
        () => c.get(),
        (err) => err === 42,
      );
    });

    it('should handle thrown null', () => {
      const c = computed(() => {
        throw null;
      });

      // #error is null by default, so we need to distinguish
      // between "no error" and "thrown null"
      assert.throws(() => c.get());
    });
  });
});
