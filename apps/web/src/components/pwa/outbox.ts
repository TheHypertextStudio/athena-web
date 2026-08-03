'use client';

import {
  OUTBOX_MAX_ATTEMPTS,
  type OutboxEntry,
  afterReplay,
  classifyReplay,
  describeWrite,
  isReplayable,
} from './outbox-model';
import { readOutbox, writeOutbox } from './outbox-store';

/**
 * The offline write queue's runtime — one store, one drain loop, for the whole tab.
 *
 * @remarks
 * Module state rather than React state, and deliberately. A write is queued from inside a `fetch`
 * wrapper that has no component above it, and the drain has to keep running while the person is
 * looking at any screen at all. Subscribers read it through {@link subscribeOutbox}, which is
 * `useSyncExternalStore`-shaped, so React sees a normal external store.
 *
 * The drain is strictly **serial and in order**. Two changes to the same task made offline must
 * land in the order they were made, and firing the queue in parallel would make that a race. It is
 * also the reason a refused entry does not stop the queue: it is marked and stepped over, so one
 * change the server will never accept cannot strand every change behind it.
 *
 * Replays go through `globalThis.fetch` directly, never the app's API client — the client's fetch is
 * the thing that enqueues on failure, and routing a replay back through it would let a failed replay
 * enqueue a second copy of the same write.
 */

/** The account whose queue is loaded, or `null` before a session resolves. */
let activeUserId: string | null = null;
/** The loaded queue, oldest first. */
let entries: readonly OutboxEntry[] = [];
/** Subscribers, notified on every change. */
const listeners = new Set<() => void>();
/** Guards against two drains overlapping. */
let draining = false;
/** Called after any entry is accepted, so the app can reconcile with the server. */
let onSynced: (() => void) | null = null;

/** Publish the current queue to every subscriber. */
function emit(): void {
  for (const listener of listeners) listener();
}

/** Persist and publish. */
async function commit(next: readonly OutboxEntry[]): Promise<boolean> {
  entries = next;
  emit();
  if (activeUserId === null) return false;
  return writeOutbox(activeUserId, next);
}

/** Subscribe to queue changes. Returns the unsubscribe function. */
export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current queue.
 *
 * @remarks
 * Returns the same array identity until something actually changes, which is what
 * `useSyncExternalStore` requires of a snapshot — returning a fresh array each call would loop.
 */
export function outboxSnapshot(): readonly OutboxEntry[] {
  return entries;
}

/** The account the queue currently belongs to. */
export function outboxUserId(): string | null {
  return activeUserId;
}

/**
 * Point the queue at an account, loading whatever it left behind.
 *
 * @remarks
 * Called whenever the session resolves. Switching to a different account replaces the in-memory
 * queue outright rather than merging: one person's unsent changes are never sent under another
 * person's session.
 *
 * @param userId - The signed-in user, or `null` when there is none.
 * @param now - Current epoch milliseconds.
 */
export async function setOutboxUser(userId: string | null, now = Date.now()): Promise<void> {
  if (userId === activeUserId) return;
  activeUserId = userId;
  entries = userId === null ? [] : await readOutbox(userId, now);
  emit();
}

/** Everything needed to replay one write later. */
export interface QueuedWriteInput {
  /** HTTP method. */
  readonly method: string;
  /** Same-origin path, including any query string. */
  readonly path: string;
  /** Serialized body, or `null`. */
  readonly body: string | null;
  /** The body's content type, or `null`. */
  readonly contentType: string | null;
}

/** A stable id for a queue entry. */
function newEntryId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `outbox-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Take responsibility for a write that could not be delivered.
 *
 * @remarks
 * Returns `null` — and takes responsibility for nothing — when there is no signed-in account to
 * key the queue on, or when storage refused the write. Both cases must fail the mutation instead,
 * because a queue that cannot outlive the tab is not a queue; promising a sync from one would be
 * the fake success this whole feature exists to avoid.
 *
 * @param input - The request that failed.
 * @param now - Current epoch milliseconds.
 * @returns The stored entry, or `null` when the write could not be taken on.
 */
export async function enqueueWrite(
  input: QueuedWriteInput,
  now = Date.now(),
): Promise<OutboxEntry | null> {
  if (activeUserId === null) return null;
  const pathOnly = input.path.split('?')[0] ?? input.path;
  const entry: OutboxEntry = {
    id: newEntryId(),
    userId: activeUserId,
    method: input.method.toUpperCase(),
    path: input.path,
    body: input.body,
    contentType: input.contentType,
    label: describeWrite(input.method, pathOnly),
    createdAt: now,
    attempts: 0,
    status: 'queued',
  };
  const stored = await commit([...entries, entry]);
  if (!stored) {
    // Roll the in-memory addition back: a queue entry nobody can restore is worse than none.
    await commit(entries.filter((existing) => existing.id !== entry.id));
    return null;
  }
  return entry;
}

/** Forget one entry — the person's answer to a change the server refused. */
export async function discardEntry(id: string): Promise<void> {
  await commit(entries.filter((entry) => entry.id !== id));
}

/** Give a blocked or expired entry one more chance, at the person's request. */
export async function retryEntry(id: string): Promise<void> {
  await commit(
    entries.map((entry) =>
      entry.id === id ? { ...entry, status: 'queued' as const, attempts: 0 } : entry,
    ),
  );
  await drainOutbox();
}

/** Send one entry, reporting the HTTP status or `null` when nothing answered. */
async function attempt(entry: OutboxEntry): Promise<number | null> {
  try {
    const response = await globalThis.fetch(entry.path, {
      method: entry.method,
      credentials: 'include',
      ...(entry.body === null
        ? {}
        : {
            body: entry.body,
            headers: entry.contentType ? { 'Content-Type': entry.contentType } : {},
          }),
    });
    return response.status;
  } catch {
    // No status: nothing was established, so the write is still owed.
    return null;
  }
}

/**
 * Send everything the queue still owes, oldest first.
 *
 * @remarks
 * Safe to call at any time and from anywhere — concurrent calls collapse into the one in flight.
 * The loop stops at the first entry that could not be delivered for want of a connection, because
 * continuing would burn every remaining entry's attempt budget on the same dead network and turn a
 * short outage into a queue full of blocked changes.
 *
 * @param now - Current epoch milliseconds.
 */
export async function drainOutbox(now = Date.now()): Promise<void> {
  if (draining || activeUserId === null) return;
  draining = true;
  let synced = false;
  try {
    for (const entry of [...entries]) {
      if (!isReplayable(entry, now)) continue;
      await commit(
        entries.map((existing) =>
          existing.id === entry.id ? { ...existing, status: 'sending' as const } : existing,
        ),
      );
      const status = await attempt(entry);
      const outcome = classifyReplay(status);
      const next = afterReplay({ ...entry, status: 'sending' }, outcome, Date.now());
      await commit(
        next === null
          ? entries.filter((existing) => existing.id !== entry.id)
          : entries.map((existing) => (existing.id === entry.id ? next : existing)),
      );
      if (outcome === 'accepted') synced = true;
      if (status === null) break;
    }
  } finally {
    draining = false;
    if (synced) onSynced?.();
  }
}

/**
 * Start draining whenever the browser thinks it can reach the network.
 *
 * @remarks
 * Three triggers, because no single one is reliable. `online` is the fast path but is not fired by
 * every platform on every transition; a tab regaining focus catches the laptop that was asleep when
 * the connection came back; and the interval catches the case where the radio came back while the
 * tab stayed in the foreground and nothing fired at all. All three funnel into the same
 * single-flight {@link drainOutbox}.
 *
 * @param onEntriesSynced - Invoked after any entry is accepted, so the app can refetch.
 * @returns A teardown function.
 */
export function startOutboxDrain(onEntriesSynced: () => void): () => void {
  onSynced = onEntriesSynced;
  const kick = (): void => {
    void drainOutbox();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') kick();
  };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(kick, DRAIN_INTERVAL_MS);
  kick();
  return () => {
    window.removeEventListener('online', kick);
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
    onSynced = null;
  };
}

/** How often the drain retries on its own, independent of any connectivity event. */
const DRAIN_INTERVAL_MS = 30_000;

/** Re-exported so the indicator can explain the attempt budget without restating the number. */
export { OUTBOX_MAX_ATTEMPTS };
