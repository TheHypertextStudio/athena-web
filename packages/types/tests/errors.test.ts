import { describe, expect, it } from 'vitest';

import { Problem, ProblemCode } from '../src/errors';

describe('ProblemCode', () => {
  it('accepts every closed code', () => {
    const codes = [
      'validation_error',
      'unauthorized',
      'forbidden',
      'not_found',
      'conflict',
      'task_already_linked',
      'idempotency_key_reuse',
      'dependency_cycle',
      'last_owner_guard',
      'self_escalation',
      'personal_org_no_invites',
      'card_required',
      'billing_frozen',
      'internal',
    ] as const;
    for (const code of codes) {
      expect(ProblemCode.parse(code)).toBe(code);
    }
  });

  it('rejects an unknown code', () => {
    expect(ProblemCode.safeParse('teapot').success).toBe(false);
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
      type: 'https://docket.dev/problems/validation',
      title: 'Validation failed',
      status: 422,
      detail: 'name is required',
      code: 'validation_error',
      fieldErrors: { name: ['Required'] },
    });
    expect(parsed.fieldErrors).toEqual({ name: ['Required'] });
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
