/** Bounded memory and IndexedDB contracts for local-first entity navigation snapshots. */
import {
  EntityNavigationSnapshot,
  type EntityNavigationSnapshot as EntityNavigationSnapshotValue,
} from '@docket/types';

/** Default number of snapshots retained in the live JavaScript heap. */
export const NAVIGATION_SNAPSHOT_MEMORY_CAPACITY = 3;
/** Maximum age of one offline navigation snapshot. */
export const NAVIGATION_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Maximum serialized snapshot storage retained for one account. */
export const NAVIGATION_SNAPSHOT_MAX_BYTES = 25 * 1024 * 1024;

function snapshotIdentity(target: string, id: string): string {
  return `${target}:${id}`;
}

/** A bounded least-recently-seeded navigation snapshot working set. */
export interface NavigationSnapshotStore {
  /** Insert or refresh a snapshot and evict the oldest inactive identity when over capacity. */
  seed(snapshot: EntityNavigationSnapshotValue): void;
  /** Read one snapshot without changing the working-set order. */
  get(
    target: EntityNavigationSnapshotValue['target'],
    id: string,
  ): EntityNavigationSnapshotValue | null;
  /** Return the retained snapshots from oldest to newest. */
  values(): readonly EntityNavigationSnapshotValue[];
  /** Remove all live snapshots. */
  clear(): void;
}

/**
 * Create a bounded in-memory snapshot working set.
 *
 * @param capacity - Maximum number of identities retained at once.
 * @returns A small explicit store independent from TanStack Query.
 */
export function createNavigationSnapshotStore(
  capacity = NAVIGATION_SNAPSHOT_MEMORY_CAPACITY,
): NavigationSnapshotStore {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError('Navigation snapshot capacity must be a positive integer.');
  }
  const snapshots = new Map<string, EntityNavigationSnapshotValue>();
  return {
    seed(snapshot) {
      const validated = EntityNavigationSnapshot.parse(snapshot);
      const key = snapshotIdentity(validated.target, validated.id);
      snapshots.delete(key);
      snapshots.set(key, validated);
      while (snapshots.size > capacity) {
        const oldest = snapshots.keys().next().value;
        if (oldest === undefined) break;
        snapshots.delete(oldest);
      }
    },
    get(target, id) {
      return snapshots.get(snapshotIdentity(target, id)) ?? null;
    },
    values() {
      return [...snapshots.values()];
    },
    clear() {
      snapshots.clear();
    },
  };
}

/** Minimal asynchronous key-value boundary used by the IndexedDB-backed repository. */
export interface SnapshotKeyValueStorage {
  /** Read one value. */
  get(key: string): Promise<unknown>;
  /** Write one value. */
  set(key: string, value: unknown): Promise<void>;
  /** Delete one value. */
  del(key: string): Promise<void>;
  /** List storage keys. */
  keys(): Promise<readonly string[]>;
}

/** Durable navigation snapshot operations. */
export interface NavigationSnapshotRepository {
  /** Persist one validated snapshot in its account bucket. */
  write(userId: string, snapshot: EntityNavigationSnapshotValue): Promise<void>;
  /** Read one unexpired, valid snapshot from its account bucket. */
  read(
    userId: string,
    target: EntityNavigationSnapshotValue['target'],
    id: string,
  ): Promise<EntityNavigationSnapshotValue | null>;
  /** Delete every Docket navigation snapshot bucket. */
  purgeAll(): Promise<void>;
}

interface PersistedSnapshotRecord {
  readonly version: 1;
  readonly userId: string;
  readonly storedAt: number;
  readonly lastAccessedAt: number;
  readonly size: number;
  readonly snapshot: EntityNavigationSnapshotValue;
}

interface SnapshotIndexEntry {
  readonly key: string;
  readonly size: number;
  readonly lastAccessedAt: number;
}

const STORAGE_PREFIX = 'docket:navigation-snapshot:v1:';

function userPrefix(userId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}:`;
}

function recordKey(
  userId: string,
  target: EntityNavigationSnapshotValue['target'],
  id: string,
): string {
  return `${userPrefix(userId)}record:${target}:${id}`;
}

function indexKey(userId: string): string {
  return `${userPrefix(userId)}index`;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function parseIndex(value: unknown): SnapshotIndexEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SnapshotIndexEntry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const candidate = entry as Readonly<Record<string, unknown>>;
    return (
      typeof candidate['key'] === 'string' &&
      typeof candidate['size'] === 'number' &&
      Number.isFinite(candidate['size']) &&
      typeof candidate['lastAccessedAt'] === 'number' &&
      Number.isFinite(candidate['lastAccessedAt'])
    );
  });
}

function parseRecord(value: unknown): PersistedSnapshotRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Readonly<Record<string, unknown>>;
  const snapshot = EntityNavigationSnapshot.safeParse(candidate['snapshot']);
  if (
    candidate['version'] !== 1 ||
    typeof candidate['userId'] !== 'string' ||
    typeof candidate['storedAt'] !== 'number' ||
    typeof candidate['lastAccessedAt'] !== 'number' ||
    typeof candidate['size'] !== 'number' ||
    !snapshot.success
  ) {
    return null;
  }
  return {
    version: 1,
    userId: candidate['userId'],
    storedAt: candidate['storedAt'],
    lastAccessedAt: candidate['lastAccessedAt'],
    size: candidate['size'],
    snapshot: snapshot.data,
  };
}

/** Options for one durable snapshot repository. */
export interface NavigationSnapshotRepositoryOptions {
  /** IndexedDB-compatible key-value adapter. */
  readonly storage: SnapshotKeyValueStorage;
  /** Clock used for expiry and LRU order. */
  readonly now?: () => number;
  /** Maximum age before a snapshot is discarded. */
  readonly maxAgeMs?: number;
  /** Maximum serialized bytes per account. */
  readonly maxBytes?: number;
}

/**
 * Create a per-user, versioned, byte-bounded navigation snapshot repository.
 *
 * @param options - Storage adapter, clock, and retention limits.
 * @returns Serialized repository operations safe against corrupt records.
 */
export function createNavigationSnapshotRepository(
  options: NavigationSnapshotRepositoryOptions,
): NavigationSnapshotRepository {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? NAVIGATION_SNAPSHOT_MAX_AGE_MS;
  const maxBytes = options.maxBytes ?? NAVIGATION_SNAPSHOT_MAX_BYTES;
  let pending: Promise<unknown> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation, operation);
    pending = next.catch(() => undefined);
    return next;
  }

  async function removeRecord(userId: string, key: string): Promise<void> {
    await options.storage.del(key);
    const keyForIndex = indexKey(userId);
    const index = parseIndex(await options.storage.get(keyForIndex)).filter(
      (entry) => entry.key !== key,
    );
    if (index.length === 0) await options.storage.del(keyForIndex);
    else await options.storage.set(keyForIndex, index);
  }

  return {
    write(userId, snapshot) {
      return serialize(async () => {
        const validated = EntityNavigationSnapshot.parse(snapshot);
        const timestamp = now();
        const key = recordKey(userId, validated.target, validated.id);
        const base = {
          version: 1 as const,
          userId,
          storedAt: timestamp,
          lastAccessedAt: timestamp,
          snapshot: validated,
        };
        const record: PersistedSnapshotRecord = {
          ...base,
          size: serializedBytes(base),
        };
        await options.storage.set(key, record);

        const keyForIndex = indexKey(userId);
        const index = parseIndex(await options.storage.get(keyForIndex)).filter(
          (entry) => entry.key !== key,
        );
        index.push({ key, size: record.size, lastAccessedAt: timestamp });
        index.sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
        let total = index.reduce((sum, entry) => sum + entry.size, 0);
        while (total > maxBytes && index.length > 0) {
          const evicted = index.shift();
          if (evicted === undefined) break;
          total -= evicted.size;
          await options.storage.del(evicted.key);
        }
        if (index.length === 0) await options.storage.del(keyForIndex);
        else await options.storage.set(keyForIndex, index);
      });
    },
    read(userId, target, id) {
      return serialize(async () => {
        const key = recordKey(userId, target, id);
        const record = parseRecord(await options.storage.get(key));
        if (record === null) {
          await removeRecord(userId, key);
          return null;
        }
        if (
          record.userId !== userId ||
          record.snapshot.target !== target ||
          record.snapshot.id !== id ||
          now() - record.storedAt > maxAgeMs
        ) {
          await removeRecord(userId, key);
          return null;
        }
        return record.snapshot;
      });
    },
    purgeAll() {
      return serialize(async () => {
        const keys = await options.storage.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith(STORAGE_PREFIX))
            .map((key) => options.storage.del(key)),
        );
      });
    },
  };
}
