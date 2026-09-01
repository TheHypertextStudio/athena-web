import { describe, expect, it } from 'vitest';

import type { EntityNavigationSnapshot } from '../../src/lib/contracts/entity-navigation';

import {
  createNavigationSnapshotRepository,
  createNavigationSnapshotStore,
  type SnapshotKeyValueStorage,
} from '@/lib/navigation-snapshots';
import { createNavigationSnapshotRuntime } from '@/lib/navigation-snapshot-runtime';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const IDS = [
  '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
] as const;
const NOW = Date.parse('2026-08-23T12:00:00.000Z');

function task(id: (typeof IDS)[number], title: string = id): EntityNavigationSnapshot {
  return {
    target: 'task',
    organizationId: ORG_ID,
    id,
    title,
    status: 'started',
    priority: 'high',
    updatedAt: '2026-08-23T11:00:00.000Z',
  } as EntityNavigationSnapshot;
}

function memoryStorage(): SnapshotKeyValueStorage & { readonly records: Map<string, unknown> } {
  const records = new Map<string, unknown>();
  return {
    records,
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
  };
}

describe('navigation snapshot memory', () => {
  it('retains the current entity and only two recent entities', () => {
    const store = createNavigationSnapshotStore(3);
    for (const id of IDS) store.seed(task(id));

    expect(store.get('task', IDS[0])).toBeNull();
    expect(store.get('task', IDS[1])?.id).toBe(IDS[1]);
    expect(store.get('task', IDS[3])?.id).toBe(IDS[3]);
    expect(store.values()).toHaveLength(3);
  });

  it('refreshes recency when an existing snapshot is seeded again', () => {
    const store = createNavigationSnapshotStore(3);
    store.seed(task(IDS[0]));
    store.seed(task(IDS[1]));
    store.seed(task(IDS[2]));
    store.seed(task(IDS[0], 'refreshed'));
    store.seed(task(IDS[3]));

    const refreshed = store.get('task', IDS[0]);
    expect(refreshed?.target === 'task' ? refreshed.title : null).toBe('refreshed');
    expect(store.get('task', IDS[1])).toBeNull();
  });

  it('removes one tombstoned entity without evicting recent unrelated snapshots', () => {
    const store = createNavigationSnapshotStore(3);
    store.seed(task(IDS[0]));
    store.seed(task(IDS[1]));

    store.remove('task', IDS[0]);

    expect(store.get('task', IDS[0])).toBeNull();
    expect(store.get('task', IDS[1])?.id).toBe(IDS[1]);
  });
});

describe('navigation snapshot persistence', () => {
  it('keeps accounts in separate buckets and rejects corrupt records', async () => {
    const storage = memoryStorage();
    const repository = createNavigationSnapshotRepository({ storage, now: () => NOW });
    await repository.write('user-a', task(IDS[0]));

    expect((await repository.read('user-a', 'task', IDS[0]))?.id).toBe(IDS[0]);
    expect(await repository.read('user-b', 'task', IDS[0])).toBeNull();

    const recordKey = [...storage.records.keys()].find((key) => key.includes(IDS[0]));
    if (recordKey === undefined) throw new Error('Expected a persisted snapshot record.');
    storage.records.set(recordKey, { version: 1, snapshot: { target: 'task' } });

    expect(await repository.read('user-a', 'task', IDS[0])).toBeNull();
    expect(storage.records.has(recordKey)).toBe(false);
  });

  it('expires records after 24 hours', async () => {
    const storage = memoryStorage();
    let clock = NOW;
    const repository = createNavigationSnapshotRepository({ storage, now: () => clock });
    await repository.write('user-a', task(IDS[0]));
    clock += 24 * 60 * 60 * 1000 + 1;

    expect(await repository.read('user-a', 'task', IDS[0])).toBeNull();
  });

  it('evicts the least recently used records when the byte budget is exceeded', async () => {
    const storage = memoryStorage();
    let clock = NOW;
    const repository = createNavigationSnapshotRepository({
      storage,
      now: () => clock,
      maxBytes: 850,
    });
    for (const id of IDS) {
      await repository.write('user-a', task(id, `${id}-${'x'.repeat(120)}`));
      clock += 1;
    }

    expect(await repository.read('user-a', 'task', IDS[0])).toBeNull();
    expect((await repository.read('user-a', 'task', IDS[3]))?.id).toBe(IDS[3]);
  });

  it('refreshes durable LRU order when a snapshot is read', async () => {
    const storage = memoryStorage();
    let clock = NOW;
    const repository = createNavigationSnapshotRepository({
      storage,
      now: () => clock,
      maxBytes: 850,
    });
    await repository.write('user-a', task(IDS[0], 'x'.repeat(120)));
    clock += 1;
    await repository.write('user-a', task(IDS[1], 'x'.repeat(120)));
    clock += 1;
    await repository.read('user-a', 'task', IDS[0]);
    clock += 1;
    await repository.write('user-a', task(IDS[2], 'x'.repeat(120)));

    expect((await repository.read('user-a', 'task', IDS[0]))?.id).toBe(IDS[0]);
    expect(await repository.read('user-a', 'task', IDS[1])).toBeNull();
  });

  it('purges every account bucket on sign-out', async () => {
    const storage = memoryStorage();
    const repository = createNavigationSnapshotRepository({ storage, now: () => NOW });
    await repository.write('user-a', task(IDS[0]));
    await repository.write('user-b', task(IDS[1]));

    await repository.purgeAll();

    expect(storage.records.size).toBe(0);
  });

  it('deletes one inaccessible entity from its account bucket', async () => {
    const storage = memoryStorage();
    const repository = createNavigationSnapshotRepository({ storage, now: () => NOW });
    await repository.write('user-a', task(IDS[0]));
    await repository.write('user-a', task(IDS[1]));

    await repository.remove('user-a', 'task', IDS[0]);

    expect(await repository.read('user-a', 'task', IDS[0])).toBeNull();
    expect((await repository.read('user-a', 'task', IDS[1]))?.id).toBe(IDS[1]);
  });
});

describe('navigation snapshot runtime', () => {
  it('paints from memory before durable storage and isolates account switches', async () => {
    const storage = memoryStorage();
    const store = createNavigationSnapshotStore();
    const repository = createNavigationSnapshotRepository({ storage, now: () => NOW });
    const runtime = createNavigationSnapshotRuntime({ store, repository });
    runtime.setUser('user-a');
    runtime.seed(task(IDS[0]));

    expect((await runtime.read('task', IDS[0]))?.id).toBe(IDS[0]);
    runtime.setUser('user-b');
    expect(await runtime.read('task', IDS[0])).toBeNull();
    runtime.setUser('user-a');
    expect((await runtime.read('task', IDS[0]))?.id).toBe(IDS[0]);
  });

  it('clears memory and every durable account bucket together', async () => {
    const storage = memoryStorage();
    const store = createNavigationSnapshotStore();
    const repository = createNavigationSnapshotRepository({ storage, now: () => NOW });
    const runtime = createNavigationSnapshotRuntime({ store, repository });
    runtime.setUser('user-a');
    runtime.seed(task(IDS[0]));
    await Promise.resolve();

    await runtime.purgeAll();

    expect(store.values()).toHaveLength(0);
    expect(storage.records.size).toBe(0);
  });

  it('purges a revoked entity from memory and durable storage', async () => {
    const storage = memoryStorage();
    const store = createNavigationSnapshotStore();
    const repository = createNavigationSnapshotRepository({ storage, now: () => NOW });
    const runtime = createNavigationSnapshotRuntime({ store, repository });
    runtime.setUser('user-a');
    runtime.seed(task(IDS[0]));
    runtime.seed(task(IDS[1]));
    await Promise.resolve();

    await runtime.remove('task', IDS[0]);

    expect(store.get('task', IDS[0])).toBeNull();
    expect(await repository.read('user-a', 'task', IDS[0])).toBeNull();
    expect(store.get('task', IDS[1])?.id).toBe(IDS[1]);
  });

  it('discards a durable read when the active account changes before it resolves', async () => {
    const store = createNavigationSnapshotStore();
    let resolveRead: ((value: EntityNavigationSnapshot) => void) | undefined;
    const repository = {
      write: async () => undefined,
      read: () =>
        new Promise<EntityNavigationSnapshot>((resolve) => {
          resolveRead = resolve;
        }),
      remove: async () => undefined,
      purgeAll: async () => undefined,
    };
    const runtime = createNavigationSnapshotRuntime({ store, repository });
    runtime.setUser('user-a');
    const pending = runtime.read('task', IDS[0]);
    runtime.setUser('user-b');
    resolveRead?.(task(IDS[0]));

    expect(await pending).toBeNull();
    expect(store.values()).toEqual([]);
  });
});
