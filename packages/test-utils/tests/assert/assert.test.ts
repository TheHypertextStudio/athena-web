import { describe, expect, it } from 'vitest';

import { assertDefined } from '../../src/assert';

describe('assertDefined', () => {
  it('returns the value when it is neither null nor undefined', () => {
    expect(assertDefined(0)).toBe(0);
    expect(assertDefined('')).toBe('');
    expect(assertDefined({ id: 'a' })).toEqual({ id: 'a' });
  });

  it('throws the default message when the value is undefined', () => {
    expect(() => {
      assertDefined(undefined);
    }).toThrow('Expected value to be defined, got null/undefined');
  });

  it('throws the default message when the value is null', () => {
    expect(() => {
      assertDefined(null);
    }).toThrow('Expected value to be defined, got null/undefined');
  });

  it('throws a custom message when provided', () => {
    expect(() => {
      assertDefined(undefined, 'expected a seeded project');
    }).toThrow('expected a seeded project');
  });
});
