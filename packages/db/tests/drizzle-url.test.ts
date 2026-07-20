/**
 * `@docket/db` — connection-string resolution for `drizzle-kit` (`drizzle-url.ts`).
 * Pure function, no DB, no process.env dependency (env is passed explicitly).
 */
import { describe, expect, it } from 'vitest';

import { resolveDatabaseUrl } from '../drizzle-url';

describe('resolveDatabaseUrl', () => {
  it('prefers a non-empty DATABASE_URL_UNPOOLED over DATABASE_URL', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL_UNPOOLED: 'postgres://unpooled',
        DATABASE_URL: 'pglite://pooled',
      }),
    ).toBe('postgres://unpooled');
  });

  it('falls back to DATABASE_URL when DATABASE_URL_UNPOOLED is an empty string', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL_UNPOOLED: '', DATABASE_URL: 'pglite://pooled' })).toBe(
      'pglite://pooled',
    );
  });

  it('falls back to DATABASE_URL when DATABASE_URL_UNPOOLED is entirely unset', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'pglite://pooled' })).toBe('pglite://pooled');
  });

  it('returns undefined when neither is set', () => {
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it('returns undefined when both are present but empty strings', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL_UNPOOLED: '', DATABASE_URL: '' })).toBeUndefined();
  });
});
