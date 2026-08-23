'use client';

import { del, get, keys, set } from 'idb-keyval';

import { type OutboxEntry, expireAged } from './outbox-model';

/**
 * Durable storage for the offline write queue.
 *
 * @remarks
 * IndexedDB, per user, alongside persisted entity snapshots and under the same
 * `docket:<thing>:<userId>` convention — deliberately the same store and the same key discipline,
 * so "everywhere local data lives" stays a list of one technology rather than two.
 *
 * Durability is the entire point of this module and the one place the queue must not be
 * failure-tolerant in the usual "swallow it" sense. A write the person believes is saved must
 * survive a reload; if it cannot be written, the caller has to know, because the honest response is
 * then to fail the mutation outright rather than promise a sync that has nowhere to come from.
 * {@link writeOutbox} therefore reports success or failure instead of swallowing.
 * {@link readOutbox} does swallow — a queue that cannot be read is indistinguishable from an empty
 * one, and there is nothing better to do.
 */

/** Prefix for every per-user queue. */
const KEY_PREFIX = 'docket:outbox:';

/** The IndexedDB key holding a given user's queue. */
export function outboxKeyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** Whether this environment can store a queue at all. */
export function canQueueWrites(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/**
 * Read one user's queue, marking anything that aged out while the browser was closed.
 *
 * @param userId - Owner of the queue.
 * @param now - Current epoch milliseconds.
 * @returns The queue, oldest first. Empty when storage is unavailable or holds nothing.
 */
export async function readOutbox(userId: string, now: number): Promise<readonly OutboxEntry[]> {
  if (!canQueueWrites()) return [];
  try {
    const raw = await get<OutboxEntry[]>(outboxKeyFor(userId));
    if (!Array.isArray(raw)) return [];
    return expireAged(raw, now);
  } catch {
    return [];
  }
}

/**
 * Replace one user's queue.
 *
 * @param userId - Owner of the queue.
 * @param entries - The queue to persist, oldest first.
 * @returns Whether the write reached storage.
 */
export async function writeOutbox(
  userId: string,
  entries: readonly OutboxEntry[],
): Promise<boolean> {
  if (!canQueueWrites()) return false;
  try {
    await set(outboxKeyFor(userId), [...entries]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete every user's queue.
 *
 * @remarks
 * Deliberately not scoped to the current user, matching `purgeAllPersistedQueryCaches`: sign-out on
 * a shared device is the moment to be thorough, and a previous occupant's unsent writes are exactly
 * the kind of thing that must not outlive their session. Unsent work *is* discarded by this, which
 * is why the sync indicator says how many changes are still waiting — signing out with pending
 * changes is a choice a person should be able to see themselves making.
 */
export async function purgeAllOutboxes(): Promise<void> {
  if (!canQueueWrites()) return;
  try {
    const all = await keys();
    await Promise.all(
      all
        .filter((key): key is string => typeof key === 'string' && key.startsWith(KEY_PREFIX))
        .map((key) => del(key)),
    );
  } catch {
    /* Storage unavailable. Nothing reachable to purge. */
  }
}
