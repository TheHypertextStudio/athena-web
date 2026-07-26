import { describe, expect, it } from 'vitest';

import { PERSIST_MAX_AGE_MS, canPersistQueries, persistKeyFor } from '@/lib/query-persist';

describe('persisted query cache keys', () => {
  it('scopes the store to one user', () => {
    // The whole multi-user story rests on this: two accounts must never share a bucket, or the
    // next person to open the browser on a shared device restores the previous person's data.
    expect(persistKeyFor('usr_a')).not.toBe(persistKeyFor('usr_b'));
  });

  it('follows the repository storage-key convention', () => {
    expect(persistKeyFor('usr_a')).toBe('docket:query-cache:usr_a');
  });

  it('bounds how long cached work data stays restorable', () => {
    // Long enough to be useful offline the next morning, short enough that stale work cannot
    // masquerade as current for days.
    expect(PERSIST_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('reports persistence unavailable when IndexedDB is missing', () => {
    // jsdom has no IndexedDB, and neither do private-browsing modes that block it. Persistence is
    // an enhancement, so it must be skipped rather than thrown from a render.
    expect(canPersistQueries()).toBe(false);
  });
});
