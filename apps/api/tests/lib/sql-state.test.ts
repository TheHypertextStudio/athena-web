/**
 * `@docket/api` — Postgres SQLSTATE extraction from a (possibly Drizzle-wrapped)
 * thrown driver error (`lib/sql-state.ts`). Pure functions, no DB.
 */
import { describe, expect, it } from 'vitest';

import { hasSqlState } from '../../src/lib/sql-state';

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
