'use client';

import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';
import { del, get, keys, set } from 'idb-keyval';

/**
 * Persistence for the TanStack Query cache, so previously-viewed data still renders offline.
 *
 * @remarks
 * IndexedDB rather than `localStorage`, for two reasons. The synchronous persister serializes the
 * entire cache on the main thread on every write, and a loaded portfolio plus tasks plus calendar
 * is easily hundreds of kilobytes. And `localStorage`'s ~5 MB origin quota is already shared with
 * `docket:last-org:*`, `docket:density:*`, the shell rail state, and the session snapshot —
 * exhausting it would silently break those instead of just costing offline data.
 *
 * **Multi-user safety is the sharp edge here, not offline support.** Persisting one person's org
 * and task data to disk means the next person to open the browser on a shared device must not see
 * it. Three independent layers prevent that:
 *
 * 1. The store key is per-user (`docket:query-cache:<userId>`), so two accounts never share a
 *    bucket.
 * 2. The buster combines the build id with the user id, so a restore is rejected outright if
 *    either differs from what wrote it.
 * 3. {@link purgeAllPersistedQueryCaches} deletes *every* user's bucket on sign-out and on session
 *    expiry — not just the current one.
 *
 * The service worker contributes a fourth: it never caches an authenticated response at all, so
 * IndexedDB is the single place user data can persist, and clearing it is sufficient.
 *
 * What this does not defend against is someone with the device already unlocked — the same threat
 * model as leaving a tab open. Browser-side encryption would be theatre, since any key would have
 * to live in the same origin.
 */

/** Prefix for every per-user cache bucket. Matches the `docket:<thing>:<userId>` convention. */
const KEY_PREFIX = 'docket:query-cache:';

/**
 * How long a persisted cache stays restorable.
 *
 * @remarks
 * Long enough that opening Docket the next morning on a train shows yesterday's board; short enough
 * that stale work cannot masquerade as current for days. Everything restored is immediately stale
 * (the default `staleTime` is 30s) and refetches the moment the connection returns, so the window
 * in which anyone sees old data is the offline session itself.
 */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The IndexedDB key holding a given user's cache. */
export function persistKeyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * Whether this environment can persist at all.
 *
 * @remarks
 * IndexedDB is absent in server rendering and in jsdom, and is blocked outright by some browsers'
 * private-browsing modes. Offline caching is an enhancement, so the correct response is to skip it
 * silently rather than let `idb-keyval` throw into a render — the app stays fully functional, it
 * just has nothing cached to show when the network goes away.
 */
export function canPersistQueries(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/**
 * Build a persister writing to that user's bucket.
 *
 * @param userId - Owner of the cache. Never omit it — an unkeyed bucket is a cross-account leak.
 * @returns A persister for {@link persistQueryClient}.
 */
export function createQueryPersister(userId: string): Persister {
  return createAsyncStoragePersister({
    // Every operation is failure-tolerant. A full quota, a browser that revokes storage mid-session,
    // or a private-mode restriction must cost offline data and nothing else — never a thrown error
    // in the middle of a render or an unhandled rejection.
    storage: {
      getItem: async (key: string) => {
        try {
          return (await get<string>(key)) ?? null;
        } catch {
          return null;
        }
      },
      setItem: async (key: string, value: string) => {
        try {
          await set(key, value);
        } catch {
          /* ignore */
        }
      },
      removeItem: async (key: string) => {
        try {
          await del(key);
        } catch {
          /* ignore */
        }
      },
    },
    key: persistKeyFor(userId),
    // Coalesces the burst of writes that follows a page's queries all settling at once.
    throttleTime: 1_000,
  });
}

/**
 * Delete every persisted cache bucket, for any user.
 *
 * @remarks
 * Deliberately not scoped to the current user. On a shared device the previous account's bucket may
 * still be sitting there, and sign-out is the natural moment to be thorough. Failures are swallowed
 * — this runs on the way to a redirect and must never block someone from signing out.
 */
export async function purgeAllPersistedQueryCaches(): Promise<void> {
  try {
    const all = await keys();
    await Promise.all(
      all
        .filter((key): key is string => typeof key === 'string' && key.startsWith(KEY_PREFIX))
        .map((key) => del(key)),
    );
  } catch {
    /* Storage unavailable (private mode, quota, disabled). Nothing to purge that we can reach. */
  }
}
