'use client';

import type { EntityNavigationSnapshot } from '@docket/types';
import { del, get, keys, set } from 'idb-keyval';

import {
  createNavigationSnapshotRepository,
  createNavigationSnapshotStore,
  type NavigationSnapshotRepository,
  type NavigationSnapshotStore,
} from '@/lib/navigation-snapshots';

/** Browser dependencies used by one navigation snapshot runtime. */
export interface NavigationSnapshotRuntimeOptions {
  /** Bounded live snapshot store. */
  readonly store: NavigationSnapshotStore;
  /** Durable per-account repository. */
  readonly repository: NavigationSnapshotRepository;
}

/** Account-bound browser operations for local-first navigation snapshots. */
export interface NavigationSnapshotRuntime {
  /** Bind future writes and reads to the resolved account. */
  setUser(userId: string | null): void;
  /** Seed a snapshot synchronously and persist it without blocking navigation. */
  seed(snapshot: EntityNavigationSnapshot): void;
  /** Read the live memory tier synchronously for the first render. */
  peek(target: EntityNavigationSnapshot['target'], id: string): EntityNavigationSnapshot | null;
  /** Read memory first, then the active account's durable bucket. */
  read(
    target: EntityNavigationSnapshot['target'],
    id: string,
  ): Promise<EntityNavigationSnapshot | null>;
  /** Remove one entity after deletion or access revocation. */
  remove(target: EntityNavigationSnapshot['target'], id: string): Promise<void>;
  /** Remove every live and durable snapshot. */
  purgeAll(): Promise<void>;
}

/**
 * Create the account-bound runtime that joins the memory and durable snapshot tiers.
 *
 * @param options - Explicit memory and durable stores.
 * @returns Snapshot operations that never put IndexedDB on the navigation critical path.
 */
export function createNavigationSnapshotRuntime(
  options: NavigationSnapshotRuntimeOptions,
): NavigationSnapshotRuntime {
  let userId: string | null = null;
  return {
    setUser(nextUserId) {
      if (nextUserId !== userId) options.store.clear();
      userId = nextUserId;
    },
    seed(snapshot) {
      options.store.seed(snapshot);
      if (userId !== null) void options.repository.write(userId, snapshot).catch(() => undefined);
    },
    peek(target, id) {
      return options.store.get(target, id);
    },
    async read(target, id) {
      const live = options.store.get(target, id);
      if (live !== null) return live;
      if (userId === null) return null;
      const readUserId = userId;
      const persisted = await options.repository.read(readUserId, target, id).catch(() => null);
      if (userId !== readUserId) return null;
      if (persisted !== null) options.store.seed(persisted);
      return persisted;
    },
    async remove(target, id) {
      options.store.remove(target, id);
      if (userId !== null)
        await options.repository.remove(userId, target, id).catch(() => undefined);
    },
    async purgeAll() {
      options.store.clear();
      await options.repository.purgeAll().catch(() => undefined);
    },
  };
}

const browserStorage = {
  get,
  set,
  del,
  async keys(): Promise<readonly string[]> {
    return (await keys()).filter((key): key is string => typeof key === 'string');
  },
};

const runtime = createNavigationSnapshotRuntime({
  store: createNavigationSnapshotStore(),
  repository: createNavigationSnapshotRepository({ storage: browserStorage }),
});

const snapshotSubscribers = new Set<() => void>();

function notifyNavigationSnapshotSubscribers(): void {
  for (const subscriber of snapshotSubscribers) subscriber();
}

/** Subscribe to synchronous changes in the browser snapshot tier. */
export function subscribeNavigationSnapshots(subscriber: () => void): () => void {
  snapshotSubscribers.add(subscriber);
  return () => {
    snapshotSubscribers.delete(subscriber);
  };
}

/** Bind browser snapshot persistence to the authenticated account. */
export function setNavigationSnapshotUser(userId: string | null): void {
  runtime.setUser(userId);
  notifyNavigationSnapshotSubscribers();
}

/** Seed the current entity before browser history changes. */
export function seedNavigationSnapshot(snapshot: EntityNavigationSnapshot): void {
  runtime.seed(snapshot);
  notifyNavigationSnapshotSubscribers();
}

/** Read the memory tier synchronously during destination mount. */
export function peekNavigationSnapshot(
  target: EntityNavigationSnapshot['target'],
  id: string,
): EntityNavigationSnapshot | null {
  return runtime.peek(target, id);
}

/** Read one navigation snapshot from memory or the current account's durable bucket. */
export function readNavigationSnapshot(
  target: EntityNavigationSnapshot['target'],
  id: string,
): Promise<EntityNavigationSnapshot | null> {
  return runtime.read(target, id);
}

/** Remove one snapshot after the API confirms deletion or access revocation. */
export function removeNavigationSnapshot(
  target: EntityNavigationSnapshot['target'],
  id: string,
): Promise<void> {
  const removal = runtime.remove(target, id);
  notifyNavigationSnapshotSubscribers();
  return removal;
}

/** Delete every navigation snapshot for every account on this browser. */
export function purgeAllNavigationSnapshots(): Promise<void> {
  const purge = runtime.purgeAll();
  notifyNavigationSnapshotSubscribers();
  return purge;
}
