// Stage 1 (stock review of 2026-11-20, finding "errors are caught and discarded without any diagnostic"): the code a
// service logs in place of an error. Source of the expectations: .claude/rules/platform.md "Logging and health"
// (never an error text in a log line; `reason` is a code of letters, digits and `_`) and docs/CODING_STANDARDS.md
// "Honest errors".
import { describe, expect, it } from 'vitest';

import { errorCode, isProgrammingError } from './error-code.ts';

class StoreDown extends Error {
  override name = 'StoreDown';
}

describe('errorCode names the class of an error and nothing else', () => {
  it.each([
    {
      what: 'a plain Error',
      error: new Error('connect ECONNREFUSED secret-host:6379'),
      code: 'Error',
    },
    { what: 'a TypeError', error: new TypeError('x is not a function'), code: 'TypeError' },
    { what: 'an error class of a dependency', error: new StoreDown('down'), code: 'StoreDown' },
  ])('answers $code for $what', ({ error, code }) => {
    expect(errorCode(error)).toBe(code);
  });

  it('never carries the message or the code property of the error', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED secret-host:6379'), {
      code: 'ECONNREFUSED',
    });
    expect(errorCode(error)).toBe('Error');
  });

  it.each([
    { what: 'a thrown string', thrown: 'transcript text' },
    { what: 'undefined', thrown: undefined },
    { what: 'an object that is no Error', thrown: { name: 'TypeError' } },
  ])('answers unknown for $what', ({ thrown }) => {
    expect(errorCode(thrown)).toBe('unknown');
  });

  it('answers unknown for a name that is no code (a name with a space or a secret in it)', () => {
    const error = new Error('x');
    error.name = 'Error at secret-host:6379';
    expect(errorCode(error)).toBe('unknown');
  });
});

describe('isProgrammingError separates a mistake in the code from a failed dependency', () => {
  it.each([new TypeError('t'), new RangeError('r'), new ReferenceError('f'), new SyntaxError('s')])(
    'is true for %o',
    (error) => {
      expect(isProgrammingError(error)).toBe(true);
    },
  );

  it.each([new Error('store away'), new StoreDown('down'), 'text', undefined])(
    'is false for %o',
    (thrown) => {
      expect(isProgrammingError(thrown)).toBe(false);
    },
  );
});
