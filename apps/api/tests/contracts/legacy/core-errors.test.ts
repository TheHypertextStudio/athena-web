import { describe, expect, it } from 'vitest';

import {
  PROBLEM_CATALOG,
  Problem,
  ProblemCode,
  PUBLIC_PROBLEM_TITLES,
  problemDefinition,
  publicProblemTitle,
} from '../../../src/contracts/errors';

describe('ProblemCode', () => {
  it('accepts every closed code', () => {
    const codes = ProblemCode.options;
    for (const code of codes) {
      expect(ProblemCode.parse(code)).toBe(code);
      expect(publicProblemTitle(code)).toBe(PUBLIC_PROBLEM_TITLES[code]);
    }
    expect(Object.keys(PUBLIC_PROBLEM_TITLES).sort()).toEqual([...codes].sort());
  });

  it('rejects an unknown code', () => {
    expect(ProblemCode.safeParse('teapot').success).toBe(false);
  });
});

describe('problemDefinition', () => {
  it('resolves a stable code to its public catalog entry', () => {
    expect(problemDefinition('not_found')).toEqual(PROBLEM_CATALOG.not_found);
    expect(problemDefinition('not_found')).toMatchObject({
      code: 'not_found',
      status: 404,
      recovery: 'return',
    });
  });

  it('returns undefined for a route parameter that is not a known code', () => {
    expect(problemDefinition('not-a-real-code')).toBeUndefined();
    expect(problemDefinition('')).toBeUndefined();
  });
});

describe('Problem', () => {
  it('parses a minimal problem (no optional fields)', () => {
    const parsed = Problem.parse({
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      code: 'forbidden',
    });
    expect(parsed.code).toBe('forbidden');
    expect(parsed.detail).toBeUndefined();
    expect(parsed.fieldErrors).toBeUndefined();
  });

  it('parses a full problem with detail + fieldErrors', () => {
    const parsed = Problem.parse({
      type: 'about:blank',
      title: 'Validation failed',
      status: 422,
      detail: 'name is required',
      code: 'validation_error',
      fieldErrors: { name: [{ code: 'invalid_type', expected: 'string' }] },
    });
    expect(parsed.fieldErrors).toEqual({ name: [{ code: 'invalid_type', expected: 'string' }] });
  });

  it('rejects a non-integer status', () => {
    expect(
      Problem.safeParse({ type: 't', title: 't', status: 4.5, code: 'internal' }).success,
    ).toBe(false);
  });

  it('rejects an invalid code', () => {
    expect(Problem.safeParse({ type: 't', title: 't', status: 500, code: 'nope' }).success).toBe(
      false,
    );
  });

  it('rejects malformed fieldErrors', () => {
    expect(
      Problem.safeParse({
        type: 't',
        title: 't',
        status: 422,
        code: 'validation_error',
        fieldErrors: { name: 'not-an-array' },
      }).success,
    ).toBe(false);
  });
});
