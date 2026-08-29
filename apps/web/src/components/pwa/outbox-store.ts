'use client';

import { del, get, keys, set } from 'idb-keyval';

import { publishOutboxHint } from './outbox-channel';
import {
  type OutboxEntry,
  type OutboxStatus,
  canonicalOutboxWriteTarget,
  expireAged,
  hasCompleteReplayContract,
  migrateReplayHeaders,
} from './outbox-model';

/** Prefix for every per-user queue. */
const KEY_PREFIX = 'docket:outbox:';
/** Durable account and generation that authorize every queue operation. */
const EPOCH_KEY = 'docket:outbox-revocation-epoch:v1';
/** Entries written before durable revocation generations existed belong to this generation. */
export const LEGACY_OUTBOX_EPOCH = 'legacy-v1';
/** Every normal operation shares this lock so an exclusive purge can stop all users. */
const BARRIER_LOCK_NAME = 'docket.outbox.barrier.v1';
/** Prefix for the lock that owns one user's fresh read and optional write. */
const USER_LOCK_PREFIX = 'docket.outbox.user.v1:';
/** Prefix for the browser-wide leader that owns one user's complete drain wave. */
const DRAIN_LOCK_PREFIX = 'docket.outbox.drain.v1:';

const OUTBOX_STATUSES = new Set<OutboxStatus>(['queued', 'sending', 'blocked', 'expired']);

/** Durable identity required for every read, write, and replay transition. */
export interface OutboxStoreOwner {
  /** Account whose queue is being accessed. */
  readonly userId: string;
  /** Revocation generation captured for that account runtime. */
  readonly epoch: string;
}

/** One atomic durable authority record written by every new account binding and revocation. */
interface DurableOutboxAuthority {
  /** Storage schema discriminator. */
  readonly version: 1;
  /** Account allowed to use this generation, or `null` after an unconditional purge. */
  readonly userId: string | null;
  /** Revocation generation shared by the bound account's queue records. */
  readonly epoch: string;
  /** Reversible owner held outside authority while explicit network sign-out is unresolved. */
  readonly suspendedOwner?: OutboxStoreOwner;
}

/** Result of opening one user's durable queue. */
export type OutboxLoadResult =
  | { readonly status: 'loaded'; readonly entries: readonly OutboxEntry[] }
  | { readonly status: 'failed' };

/** Result of asking the browser to coordinate one durable operation. */
export type OutboxLockResult<T> =
  | { readonly status: 'acquired'; readonly value: T }
  | { readonly status: 'revoked' }
  | { readonly status: 'unavailable' };

/** The fresh storage access available only while both required locks are held. */
export interface OutboxTransaction {
  /** Read and validate the current durable queue. */
  readonly read: (now: number) => Promise<OutboxLoadResult>;
  /** Replace the queue before releasing the user lock. */
  readonly write: (entries: readonly OutboxEntry[]) => Promise<boolean>;
}

/** The IndexedDB key holding a given user's queue. */
export function outboxKeyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** Whether IndexedDB exists for this storage partition. */
function canStoreOutbox(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/** Whether this environment can store and coordinate a durable queue. */
export function canQueueWrites(): boolean {
  return canStoreOutbox() && lockManager() !== null;
}

/** Return the browser coordinator that makes a fresh storage read authoritative. */
function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as unknown as { readonly locks?: LockManager }).locks ?? null;
}

/** Whether a raw value is a usable durable epoch. */
function isValidEpoch(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

/** Read the authority protected by the caller's shared or exclusive barrier lock. */
async function readAuthorityLocked(): Promise<DurableOutboxAuthority | null> {
  try {
    const value = await get<unknown>(EPOCH_KEY);
    if (value === undefined) return { version: 1, userId: null, epoch: LEGACY_OUTBOX_EPOCH };
    if (isValidEpoch(value)) return { version: 1, userId: null, epoch: value };
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Readonly<Record<string, unknown>>;
    const userId = record['userId'];
    if (
      record['version'] !== 1 ||
      !isValidEpoch(record['epoch']) ||
      (userId !== null && (typeof userId !== 'string' || userId.length === 0))
    )
      return null;
    const suspended = record['suspendedOwner'];
    if (suspended === undefined) return { version: 1, userId, epoch: record['epoch'] };
    if (userId !== null || typeof suspended !== 'object' || suspended === null) return null;
    const suspendedRecord = suspended as Readonly<Record<string, unknown>>;
    if (
      typeof suspendedRecord['userId'] !== 'string' ||
      suspendedRecord['userId'].length === 0 ||
      !isValidEpoch(suspendedRecord['epoch'])
    )
      return null;
    return {
      version: 1,
      userId,
      epoch: record['epoch'],
      suspendedOwner: {
        userId: suspendedRecord['userId'],
        epoch: suspendedRecord['epoch'],
      },
    };
  } catch {
    return null;
  }
}

/** Read the current revocation generation without allowing a purge to interleave. */
export async function readOutboxEpoch(): Promise<string | null> {
  const locks = lockManager();
  if (!canQueueWrites() || locks === null) return null;
  try {
    return await locks.request(BARRIER_LOCK_NAME, { mode: 'shared' }, async () => {
      const authority = await readAuthorityLocked();
      return authority?.epoch ?? null;
    });
  } catch {
    return null;
  }
}

/**
 * Bind queue authority to one account under the exclusive purge barrier.
 *
 * @remarks
 * A missing or legacy string authority may be adopted by the first account. The same account then
 * reuses that generation. A different account rotates the generation and makes every prior queue
 * inaccessible before its token is returned.
 *
 * @param userId - The account becoming active in this browser storage partition.
 * @returns Its durable epoch, or `null` when authority could not be stored.
 */
export function bindOutboxOwner(userId: string): Promise<string | null> {
  if (userId.length === 0) return Promise.resolve(null);
  return withExclusiveBarrier(null, async () => {
    const authority = await readAuthorityLocked();
    if (authority === null) return null;
    if (authority.suspendedOwner !== undefined) {
      if (authority.suspendedOwner.userId !== userId) return rotateAuthorityLocked(userId);
      try {
        await set(EPOCH_KEY, {
          version: 1,
          userId,
          epoch: authority.suspendedOwner.epoch,
        } satisfies DurableOutboxAuthority);
        publishOutboxHint('restore');
        return authority.suspendedOwner.epoch;
      } catch {
        return null;
      }
    }
    if (authority.userId === userId) return authority.epoch;
    if (authority.userId === null) {
      try {
        await set(EPOCH_KEY, { ...authority, userId } satisfies DurableOutboxAuthority);
        return authority.epoch;
      } catch {
        return null;
      }
    }
    return rotateAuthorityLocked(userId);
  });
}

/**
 * Join an already-restored account without rotating authority away from another account.
 *
 * @param userId - Locally requested account that received a restore hint.
 * @returns Its current durable epoch, or `null` when another account owns authority.
 */
export function joinOutboxOwner(userId: string): Promise<string | null> {
  if (userId.length === 0 || !canQueueWrites()) return Promise.resolve(null);
  return withExclusiveBarrier(null, async () => {
    const authority = await readAuthorityLocked();
    return authority?.userId === userId && authority.suspendedOwner === undefined
      ? authority.epoch
      : null;
  });
}

type RestoredEntry =
  | { readonly status: 'restored'; readonly entry: OutboxEntry }
  | { readonly status: 'unsupported'; readonly id: string }
  | { readonly status: 'malformed' };

/** Restore one current-generation entry without trusting its shape or stored headers. */
function restoreEntry(value: unknown, owner: OutboxStoreOwner): RestoredEntry {
  if (typeof value !== 'object' || value === null) return { status: 'malformed' };
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record['id'] !== 'string' ||
    record['id'].length === 0 ||
    record['userId'] !== owner.userId ||
    typeof record['method'] !== 'string' ||
    typeof record['path'] !== 'string' ||
    (record['body'] !== null && typeof record['body'] !== 'string') ||
    typeof record['label'] !== 'string' ||
    typeof record['createdAt'] !== 'number' ||
    !Number.isFinite(record['createdAt']) ||
    record['createdAt'] < 0 ||
    (record['notBeforeAt'] !== undefined &&
      record['notBeforeAt'] !== null &&
      (typeof record['notBeforeAt'] !== 'number' ||
        !Number.isFinite(record['notBeforeAt']) ||
        record['notBeforeAt'] < 0)) ||
    typeof record['attempts'] !== 'number' ||
    !Number.isInteger(record['attempts']) ||
    record['attempts'] < 0 ||
    typeof record['status'] !== 'string' ||
    !OUTBOX_STATUSES.has(record['status'] as OutboxStatus)
  )
    return { status: 'malformed' };

  const target = canonicalOutboxWriteTarget(record['method'], record['path']);
  if (target === null) return { status: 'unsupported', id: record['id'] };
  const body = record['body'];
  return {
    status: 'restored',
    entry: {
      id: record['id'],
      userId: owner.userId,
      epoch: owner.epoch,
      method: target.method,
      path: target.path,
      body,
      headers: migrateReplayHeaders({
        method: target.method,
        path: target.path,
        body,
        headers: record['headers'],
        legacyContentType: record['contentType'],
      }),
      label: target.label,
      createdAt: record['createdAt'],
      notBeforeAt: typeof record['notBeforeAt'] === 'number' ? record['notBeforeAt'] : null,
      attempts: record['attempts'],
      status: record['status'] as OutboxStatus,
    },
  };
}

/** How one raw record relates to the current durable generation. */
function recordEpochMembership(
  value: unknown,
  epoch: string,
): 'current' | 'different' | 'malformed' {
  if (typeof value !== 'object' || value === null)
    return epoch === LEGACY_OUTBOX_EPOCH ? 'current' : 'different';
  const stored = (value as Readonly<Record<string, unknown>>)['epoch'];
  if (stored === undefined) return epoch === LEGACY_OUTBOX_EPOCH ? 'current' : 'different';
  if (typeof stored !== 'string' || stored.length === 0 || stored.length > 256) return 'malformed';
  return stored === epoch ? 'current' : 'different';
}

/** Read and normalize one queue while its user lock is held. */
async function readLocked(owner: OutboxStoreOwner, now: number): Promise<OutboxLoadResult> {
  try {
    const raw = await get<unknown>(outboxKeyFor(owner.userId));
    if (raw === undefined) return { status: 'loaded', entries: [] };
    if (!Array.isArray(raw)) return { status: 'failed' };
    const restored: OutboxEntry[] = [];
    const ids = new Set<string>();
    for (const value of raw) {
      const membership = recordEpochMembership(value, owner.epoch);
      if (membership === 'different') continue;
      if (membership === 'malformed') return { status: 'failed' };
      const result = restoreEntry(value, owner);
      if (result.status === 'malformed') return { status: 'failed' };
      if (result.status === 'unsupported') return { status: 'failed' };
      const id = result.entry.id;
      if (ids.has(id)) return { status: 'failed' };
      ids.add(id);
      restored.push(result.entry);
    }
    return {
      status: 'loaded',
      entries: expireAged(restored, now).map((entry) =>
        entry.status === 'queued' && !hasCompleteReplayContract(entry)
          ? { ...entry, status: 'blocked' as const }
          : entry,
      ),
    };
  } catch {
    return { status: 'failed' };
  }
}

/** Replace one queue while its user lock is held. */
async function writeLocked(
  owner: OutboxStoreOwner,
  entries: readonly OutboxEntry[],
): Promise<boolean> {
  const ids = new Set<string>();
  if (
    entries.some((entry) => {
      const duplicate = ids.has(entry.id);
      ids.add(entry.id);
      return (
        duplicate ||
        entry.userId !== owner.userId ||
        entry.epoch !== owner.epoch ||
        entry.status === 'sending' ||
        canonicalOutboxWriteTarget(entry.method, entry.path) === null
      );
    })
  )
    return false;
  try {
    await set(outboxKeyFor(owner.userId), [...entries]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hold the shared purge barrier and one user's lock around a fresh storage transaction.
 *
 * @param owner - Account and durable revocation generation.
 * @param mode - Shared for reads and exclusive for every state transition.
 * @param operation - Work that must see and optionally replace authoritative storage.
 * @returns The operation result, or a distinct unavailable/revoked result.
 */
export async function withOutboxUserLock<T>(
  owner: OutboxStoreOwner,
  mode: 'shared' | 'exclusive',
  operation: (transaction: OutboxTransaction) => Promise<T>,
): Promise<OutboxLockResult<T>> {
  const locks = lockManager();
  if (!canQueueWrites() || locks === null) return { status: 'unavailable' };
  try {
    return await locks.request(BARRIER_LOCK_NAME, { mode: 'shared' }, async () => {
      const authority = await readAuthorityLocked();
      if (authority === null) return { status: 'unavailable' as const };
      if (authority.epoch !== owner.epoch || authority.userId !== owner.userId)
        return { status: 'revoked' as const };
      const value = await locks.request(`${USER_LOCK_PREFIX}${owner.userId}`, { mode }, () =>
        operation({
          read: (now) => readLocked(owner, now),
          write: (entries) => writeLocked(owner, entries),
        }),
      );
      return { status: 'acquired' as const, value };
    });
  } catch {
    return { status: 'unavailable' };
  }
}

/** Run one drain wave only when no peer runtime already leads that user's drain. */
export async function withOutboxDrainLeadership<T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<OutboxLockResult<T>> {
  const locks = lockManager();
  if (!canQueueWrites() || locks === null) return { status: 'unavailable' };
  try {
    return await locks.request(
      `${DRAIN_LOCK_PREFIX}${userId}`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) =>
        lock === null
          ? { status: 'unavailable' as const }
          : { status: 'acquired' as const, value: await operation() },
    );
  } catch {
    return { status: 'unavailable' };
  }
}

/** Read one owner's queue under shared cross-tab locks. */
export async function loadOutbox(
  owner: OutboxStoreOwner,
  now: number,
): Promise<OutboxLoadResult | { readonly status: 'revoked' }> {
  const result = await withOutboxUserLock(owner, 'shared', (transaction) => transaction.read(now));
  if (result.status === 'acquired') return result.value;
  return result.status === 'revoked' ? { status: 'revoked' } : { status: 'failed' };
}

/** Read one user's current-generation queue for diagnostics and tests. */
export async function readOutbox(userId: string, now: number): Promise<readonly OutboxEntry[]> {
  const epoch = await readOutboxEpoch();
  if (epoch === null) return [];
  const result = await loadOutbox({ userId, epoch }, now);
  return result.status === 'loaded' ? result.entries : [];
}

/** Create a new opaque revocation generation without encoding account data. */
function newEpoch(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `revoked-${String(Date.now())}-${Math.random().toString(36).slice(2, 14)}`;
}

/** Rotate durable authority and delete old queue bytes while the exclusive barrier is held. */
async function rotateAuthorityLocked(userId: string | null): Promise<string | null> {
  const epoch = newEpoch();
  try {
    await set(EPOCH_KEY, { version: 1, userId, epoch } satisfies DurableOutboxAuthority);
  } catch {
    return null;
  }
  await deleteQueueKeysLocked();
  publishOutboxHint('purge');
  return epoch;
}

/** Delete every per-account queue after durable authority no longer references their epochs. */
async function deleteQueueKeysLocked(): Promise<void> {
  let storedKeys: readonly IDBValidKey[];
  try {
    storedKeys = await keys();
  } catch {
    return;
  }
  await Promise.all(
    storedKeys.flatMap((key) =>
      typeof key === 'string' && key.startsWith(KEY_PREFIX)
        ? [
            del(key).catch(() => {
              // Old-generation bytes are already inaccessible through the durable epoch.
            }),
          ]
        : [],
    ),
  );
}

/** Run one revocation decision while no shared queue operation can interleave. */
async function withExclusiveBarrier<T>(unavailable: T, operation: () => Promise<T>): Promise<T> {
  const locks = lockManager();
  if (!canQueueWrites() || locks === null) return unavailable;
  try {
    return await locks.request(BARRIER_LOCK_NAME, { mode: 'exclusive' }, operation);
  } catch {
    return unavailable;
  }
}

/**
 * Revoke every prior owner and then delete old queue bytes on a best-effort basis.
 *
 * @remarks
 * The generation write is the authority. It happens under the exclusive barrier before key
 * enumeration, so old records stay inaccessible even when enumeration or deletion fails. Every
 * normal operation takes the same barrier first and compares its captured generation before it can
 * acquire a user lock.
 *
 * @returns Whether the durable revocation generation was stored.
 */
export async function purgeAllOutboxes(): Promise<boolean> {
  if (!canStoreOutbox()) return true;
  if (!canQueueWrites()) {
    try {
      const storedKeys = await keys();
      return !storedKeys.some(
        (key) => key === EPOCH_KEY || (typeof key === 'string' && key.startsWith(KEY_PREFIX)),
      );
    } catch {
      return false;
    }
  }
  return withExclusiveBarrier(false, async () => (await rotateAuthorityLocked(null)) !== null);
}

/**
 * Revoke every queue only when the captured owner's durable generation is still current.
 *
 * @remarks
 * The comparison and generation bump share one exclusive barrier. A stale tab that missed a peer's
 * purge hint therefore cannot replace the peer's newer epoch or delete queues written under it.
 *
 * @param owner - The account token that authorized session cleanup or explicit sign-out.
 * @returns Whether this owner was current and the durable revocation generation was stored.
 */
export function purgeOutboxesForOwner(owner: OutboxStoreOwner): Promise<boolean> {
  if (!canQueueWrites()) return Promise.resolve(false);
  return withExclusiveBarrier(false, async () => {
    const authority = await readAuthorityLocked();
    if (authority?.epoch !== owner.epoch || authority.userId !== owner.userId) return false;
    return (await rotateAuthorityLocked(null)) !== null;
  });
}

/** Durable receipt for one reversible explicit-sign-out revocation. */
export interface OutboxSuspension {
  /** Owner whose exact queue epoch can be restored after a failed request. */
  readonly owner: OutboxStoreOwner;
  /** Neutral epoch that blocks every queue while the network result is unknown. */
  readonly suspendedEpoch: string;
}

/** Check that durable authority still represents one unresolved suspension. */
function matchesSuspension(
  authority: DurableOutboxAuthority | null,
  suspension: OutboxSuspension,
): boolean {
  return (
    authority?.userId === null &&
    authority.epoch === suspension.suspendedEpoch &&
    authority.suspendedOwner?.userId === suspension.owner.userId &&
    authority.suspendedOwner.epoch === suspension.owner.epoch
  );
}

/**
 * Revoke one owner without deleting its queue until explicit network sign-out settles.
 *
 * @param owner - Exact account epoch that initiated sign-out.
 * @returns A rollback receipt, or `null` when the owner was stale or storage was unavailable.
 */
export function suspendOutboxesForOwner(owner: OutboxStoreOwner): Promise<OutboxSuspension | null> {
  if (!canQueueWrites()) return Promise.resolve(null);
  return withExclusiveBarrier(null, async () => {
    const authority = await readAuthorityLocked();
    if (authority?.epoch !== owner.epoch || authority.userId !== owner.userId) return null;
    const suspendedEpoch = newEpoch();
    try {
      await set(EPOCH_KEY, {
        version: 1,
        userId: null,
        epoch: suspendedEpoch,
        suspendedOwner: owner,
      } satisfies DurableOutboxAuthority);
    } catch {
      return null;
    }
    publishOutboxHint('purge');
    return { owner, suspendedEpoch };
  });
}

/**
 * Delete queue bytes after the server confirms explicit sign-out.
 *
 * @param suspension - Receipt returned by {@link suspendOutboxesForOwner}.
 * @returns Whether that suspension still owned durable authority and was committed.
 */
export function commitOutboxSuspension(suspension: OutboxSuspension): Promise<boolean> {
  if (!canQueueWrites()) return Promise.resolve(false);
  return withExclusiveBarrier(false, async () => {
    const authority = await readAuthorityLocked();
    if (!matchesSuspension(authority, suspension)) return false;
    try {
      await set(EPOCH_KEY, {
        version: 1,
        userId: null,
        epoch: suspension.suspendedEpoch,
      } satisfies DurableOutboxAuthority);
    } catch {
      return false;
    }
    await deleteQueueKeysLocked();
    publishOutboxHint('purge');
    return true;
  });
}

/**
 * Restore the exact durable owner and queue after explicit network sign-out fails.
 *
 * @param suspension - Receipt returned by {@link suspendOutboxesForOwner}.
 * @returns Whether no replacement account superseded the suspended authority.
 */
export function rollbackOutboxSuspension(suspension: OutboxSuspension): Promise<boolean> {
  if (!canQueueWrites()) return Promise.resolve(false);
  return withExclusiveBarrier(false, async () => {
    const authority = await readAuthorityLocked();
    if (!matchesSuspension(authority, suspension)) return false;
    try {
      await set(EPOCH_KEY, {
        version: 1,
        userId: suspension.owner.userId,
        epoch: suspension.owner.epoch,
      } satisfies DurableOutboxAuthority);
    } catch {
      return false;
    }
    publishOutboxHint('restore');
    return true;
  });
}
