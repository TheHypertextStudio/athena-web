/**
 * `@docket/api` — Postgres SQLSTATE extraction from a (possibly Drizzle-wrapped)
 * thrown driver error (`lib/sql-state.ts`). Pure functions, no DB.
 */
import { describe, expect, it } from 'vitest';

import { hasSqlState, sqlErrorSummary } from '../../src/lib/sql-state';

describe('hasSqlState', () => {
  it('matches a SQLSTATE carried directly on err.code', () => {
    expect(hasSqlState({ code: '23505' }, '23505')).toBe(true);
  });

  it('matches a SQLSTATE nested at err.cause.code (Drizzle-wrapped driver error)', () => {
    expect(hasSqlState({ message: 'insert failed', cause: { code: '23505' } }, '23505')).toBe(true);
  });

  it('returns false for a different SQLSTATE, on both err.code and err.cause.code', () => {
    expect(hasSqlState({ code: '40001' }, '23505')).toBe(false);
    expect(hasSqlState({ cause: { code: '40001' } }, '23505')).toBe(false);
  });

  it('returns false when neither err.code nor err.cause.code is present', () => {
    expect(hasSqlState({ message: 'boom' }, '23505')).toBe(false);
    expect(hasSqlState(new Error('boom'), '23505')).toBe(false);
  });

  it('returns false for non-object, null, and undefined errors without throwing', () => {
    expect(hasSqlState(null, '23505')).toBe(false);
    expect(hasSqlState(undefined, '23505')).toBe(false);
    expect(hasSqlState('a string error', '23505')).toBe(false);
    expect(hasSqlState(42, '23505')).toBe(false);
  });

  it('returns false when err.code or err.cause.code is not a string', () => {
    expect(hasSqlState({ code: 23505 }, '23505')).toBe(false);
    expect(hasSqlState({ cause: { code: 23505 } }, '23505')).toBe(false);
  });
});

describe('sqlErrorSummary', () => {
  it('reports the nested database cause without copying Drizzle query parameters', () => {
    const summary = sqlErrorSummary(
      {
        message: 'Failed query: insert into organization_billing_account params: org-secret',
        cause: {
          message: 'permission denied for table organization_billing_account',
          code: '42501',
          table: 'organization_billing_account',
        },
      },
      'Database operation failed',
    );

    expect(summary).toBe(
      'permission denied for table organization_billing_account (SQLSTATE 42501; table organization_billing_account)',
    );
    expect(summary).not.toContain('org-secret');
    expect(summary).not.toContain('params:');
  });

  it('uses application-owned fallback copy for an unknown thrown value', () => {
    expect(sqlErrorSummary('driver failed', 'Database operation failed')).toBe(
      'Database operation failed',
    );
  });

  it('redacts a cyclic cause chain instead of returning its wrapper parameters', () => {
    const wrapper: { message: string; cause?: unknown } = {
      message: 'Failed query params: cycle-secret',
    };
    const driver = { message: 'driver error', code: 'XX000', cause: wrapper };
    wrapper.cause = driver;

    const summary = sqlErrorSummary(wrapper, 'Database operation failed');

    expect(summary).toBe('Database operation failed');
    expect(summary).not.toContain('cycle-secret');
  });

  it('redacts an over-deep cause chain instead of trusting an arbitrary cutoff object', () => {
    const nested = Array.from({ length: 10 }, (_, index) => index).reduceRight<unknown>(
      (cause, index) => ({ message: `wrapper ${index} params: depth-secret`, cause }),
      { message: 'driver error', code: 'XX000' },
    );

    const summary = sqlErrorSummary(nested, 'Database operation failed');

    expect(summary).toBe('Database operation failed');
    expect(summary).not.toContain('depth-secret');
  });
});
