import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal in-memory stand-in for idb-keyval, so the purge behaviour can be asserted without an
// IndexedDB implementation (jsdom has none).
const store = new Map<string, string>();

vi.mock('idb-keyval', () => ({
  get: vi.fn((key: string) => Promise.resolve(store.get(key))),
  set: vi.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  del: vi.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  }),
  keys: vi.fn(() => Promise.resolve([...store.keys()])),
}));

const { purgeAllPersistedQueryCaches } = await import('@/lib/query-persist');

describe('purgeAllPersistedQueryCaches', () => {
  beforeEach(() => {
    store.clear();
  });

  it('removes every user bucket, not just the current one', async () => {
    // The shared-device case. Signing out has to take the previous account's cache with it, or B
    // signing in on A's laptop can restore A's orgs and tasks.
    store.set('docket:query-cache:usr_a', 'A');
    store.set('docket:query-cache:usr_b', 'B');

    await purgeAllPersistedQueryCaches();

    expect([...store.keys()]).toEqual([]);
  });

  it('leaves unrelated storage alone', async () => {
    // The same IndexedDB store is shared with anything else the origin keeps there; purging must
    // be surgical rather than wiping the database.
    store.set('docket:query-cache:usr_a', 'A');
    store.set('some-other-library-key', 'keep');

    await purgeAllPersistedQueryCaches();

    expect([...store.keys()]).toEqual(['some-other-library-key']);
  });

  it('resolves rather than throwing when storage is unavailable', async () => {
    // Runs on the way to a redirect during sign-out: a storage failure must never block someone
    // from signing out.
    const { keys } = await import('idb-keyval');
    vi.mocked(keys).mockRejectedValueOnce(new Error('storage disabled'));

    await expect(purgeAllPersistedQueryCaches()).resolves.toBeUndefined();
  });
});
