import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeLockManager } from './fake-lock-manager';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const idb = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  failingReads: new Set<string>(),
  failingDeletes: new Set<string>(),
  failingKeyEnumeration: false,
  setGates: new Map<string, { readonly promise: Promise<void> }>(),
  setCalls: [] as { readonly key: string; readonly value: unknown }[],
}));

vi.mock('idb-keyval', () => ({
  get: (key: string) => {
    if (idb.failingReads.has(key)) return Promise.reject(new Error('IndexedDB read failed'));
    return Promise.resolve(structuredClone(idb.values.get(key)));
  },
  set: async (key: string, value: unknown) => {
    idb.setCalls.push({ key, value });
    const storedValue = structuredClone(value);
    await idb.setGates.get(key)?.promise;
    idb.values.set(key, storedValue);
  },
  del: (key: string) => {
    if (idb.failingDeletes.has(key)) return Promise.reject(new Error('IndexedDB delete failed'));
    idb.values.delete(key);
    return Promise.resolve();
  },
  keys: () =>
    idb.failingKeyEnumeration
      ? Promise.reject(new Error('IndexedDB key enumeration failed'))
      : Promise.resolve([...idb.values.keys()]),
}));

type MessageHandler = ((event: MessageEvent<unknown>) => void) | null;

/** A per-test BroadcastChannel network. The sender does not receive its own message. */
class FakeBroadcastChannel {
  static channels: FakeBroadcastChannel[] = [];
  static messages: unknown[] = [];
  static throwOnConstruct = false;
  static throwOnPost = false;
  onmessage: MessageHandler = null;

  constructor(readonly name: string) {
    if (FakeBroadcastChannel.throwOnConstruct) throw new Error('BroadcastChannel denied');
    FakeBroadcastChannel.channels.push(this);
  }

  postMessage(data: unknown): void {
    if (FakeBroadcastChannel.throwOnPost) throw new Error('BroadcastChannel send failed');
    FakeBroadcastChannel.messages.push(data);
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel === this || channel.name !== this.name) continue;
      queueMicrotask(() => channel.onmessage?.({ data } as MessageEvent<unknown>));
    }
  }

  close(): void {
    FakeBroadcastChannel.channels = FakeBroadcastChannel.channels.filter((item) => item !== this);
  }
}

const resetRuntimes: (() => Promise<void>)[] = [];
let locks: FakeLockManager;

async function loadRuntime() {
  vi.resetModules();
  const runtime = await import('@/components/pwa/outbox');
  const store = await import('@/components/pwa/outbox-store');
  const offlineWrite = await import('@/components/pwa/offline-write');
  resetRuntimes.push(() => runtime.setOutboxUser(null));
  return { runtime, store, offlineWrite };
}

function keyFor(userId: string): string {
  return `docket:outbox:${userId}`;
}

/** Narrow a runtime token to the durable owner required by store operations. */
function durableOwner(owner: { readonly userId: string; readonly epoch: string | null } | null): {
  readonly userId: string;
  readonly epoch: string;
} {
  if (owner === null) throw new Error('Expected a durable owner');
  if (owner.epoch === null) throw new Error('Expected a durable owner');
  return { userId: owner.userId, epoch: owner.epoch };
}

function objectCommand(
  userId: string,
  commandId: string,
  fields: Readonly<Record<string, unknown>> = {},
) {
  return {
    method: 'POST' as const,
    path: `/v1/orgs/${userId}/object-commands`,
    body: JSON.stringify({ commandId, ...fields }),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId },
  };
}

function storedEntry(
  userId: string,
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    id,
    userId,
    method: 'POST',
    path: `/v1/orgs/${userId}/object-commands`,
    body: JSON.stringify({ commandId: id }),
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id },
    label: 'Object change',
    createdAt: Date.now(),
    attempts: 0,
    status: 'queued',
    ...overrides,
  };
}

beforeEach(() => {
  idb.values.clear();
  idb.failingReads.clear();
  idb.failingDeletes.clear();
  idb.failingKeyEnumeration = false;
  idb.setGates.clear();
  idb.setCalls.length = 0;
  resetRuntimes.length = 0;
  locks = new FakeLockManager();
  FakeBroadcastChannel.channels = [];
  FakeBroadcastChannel.messages = [];
  FakeBroadcastChannel.throwOnConstruct = false;
  FakeBroadcastChannel.throwOnPost = false;
  Object.defineProperty(window, 'indexedDB', { value: {}, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: FakeBroadcastChannel,
    configurable: true,
  });
});

afterEach(async () => {
  await Promise.all(resetRuntimes.map((reset) => reset()));
  vi.restoreAllMocks();
});

describe('cross-tab outbox authority', () => {
  it('preserves both appends when two runtimes enqueue for the same user concurrently', async () => {
    const a = await loadRuntime();
    const b = await loadRuntime();
    await Promise.all([a.runtime.setOutboxUser('user-1'), b.runtime.setOutboxUser('user-1')]);

    const [first, second] = await Promise.all([
      a.runtime.enqueueWrite(objectCommand('user-1', 'command-a', { title: 'A' })),
      b.runtime.enqueueWrite(objectCommand('user-1', 'command-b', { title: 'B' })),
    ]);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const stored = idb.values.get(keyFor('user-1')) as { body: string; path: string }[];
    expect(stored.map((entry) => entry.path)).toEqual([
      '/v1/orgs/user-1/object-commands',
      '/v1/orgs/user-1/object-commands',
    ]);
    expect(stored.map((entry) => JSON.parse(entry.body).commandId)).toEqual([
      'command-a',
      'command-b',
    ]);
  });

  it('holds one user lock across replay so two drains fetch once and both finish empty', async () => {
    idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'task-1')]);
    const a = await loadRuntime();
    const b = await loadRuntime();
    await Promise.all([a.runtime.setOutboxUser('user-1'), b.runtime.setOutboxUser('user-1')]);
    const response = deferred<Response>();
    const sentHeaders: Headers[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      sentHeaders.push(new Headers(init?.headers));
      return response.promise;
    });

    const drainingA = a.runtime.drainOutbox();
    const drainingB = b.runtime.drainOutbox();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });
    expect(idb.values.get(keyFor('user-1'))).toEqual([
      expect.objectContaining({
        status: 'queued',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'task-1',
        },
      }),
    ]);
    response.resolve(new Response('{}', { status: 200 }));
    await Promise.all([drainingA, drainingB]);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(sentHeaders[0]?.get('X-Docket-Replay-Owner')).toBe('user-1');
    expect(a.runtime.outboxSnapshot()).toEqual([]);
    expect(b.runtime.outboxSnapshot()).toEqual([]);
    expect(idb.values.get(keyFor('user-1'))).toEqual([]);
  });

  it('lets one browser-wide drain wave own a network rejection', async () => {
    idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'offline')]);
    const a = await loadRuntime();
    const b = await loadRuntime();
    await Promise.all([a.runtime.setOutboxUser('user-1'), b.runtime.setOutboxUser('user-1')]);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network unavailable'));

    await Promise.all([a.runtime.drainOutbox(), b.runtime.drainOutbox()]);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(idb.values.get(keyFor('user-1'))).toEqual([
      expect.objectContaining({ status: 'queued', attempts: 0 }),
    ]);
  });

  it('lets one browser-wide drain wave spend one transient attempt', async () => {
    idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'transient')]);
    const a = await loadRuntime();
    const b = await loadRuntime();
    await Promise.all([a.runtime.setOutboxUser('user-1'), b.runtime.setOutboxUser('user-1')]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));

    await Promise.all([a.runtime.drainOutbox(), b.runtime.drainOutbox()]);

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(idb.values.get(keyFor('user-1'))).toEqual([
      expect.objectContaining({ status: 'queued', attempts: 1 }),
    ]);
  });

  it('orders a different-account activation after a started queue write', async () => {
    const a = await loadRuntime();
    const b = await loadRuntime();
    await a.runtime.setOutboxUser('user-a');
    const gate = deferred<undefined>();
    idb.setGates.set(keyFor('user-a'), gate);

    const enqueueA = a.runtime.enqueueWrite(objectCommand('user-a', 'command-a'));
    await vi.waitFor(() => {
      expect(idb.setCalls.some((call) => call.key === keyFor('user-a'))).toBe(true);
    });
    const bindingB = b.runtime.setOutboxUser('user-b');
    const boundB = vi.fn();
    void bindingB.then(boundB);
    await Promise.resolve();
    expect(boundB).not.toHaveBeenCalled();

    gate.resolve(undefined);
    await expect(enqueueA).resolves.not.toBeNull();
    await bindingB;
    await expect(
      b.runtime.enqueueWrite(objectCommand('user-b', 'command-b')),
    ).resolves.not.toBeNull();

    expect(idb.values.has(keyFor('user-a'))).toBe(false);
    expect(idb.values.get(keyFor('user-b'))).toEqual([
      expect.objectContaining({ body: expect.stringContaining('command-b') }),
    ]);
  });

  it('recovers legacy persisted sending state before one locked replay', async () => {
    idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'task-1', { status: 'sending' })]);
    const { runtime } = await loadRuntime();
    await runtime.setOutboxUser('user-1');
    expect(runtime.outboxSnapshot()[0]).toMatchObject({ status: 'queued' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await runtime.drainOutbox();

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(idb.values.get(keyFor('user-1'))).toEqual([]);
  });

  it('refuses enqueue and replay when Web Locks are absent or reject acquisition', async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    const missing = await loadRuntime();
    expect(missing.store.canQueueWrites()).toBe(false);
    await missing.runtime.setOutboxUser('user-1');
    expect(missing.runtime.captureOutboxOwner()).toMatchObject({
      userId: 'user-1',
      epoch: null,
    });
    await expect(
      missing.runtime.enqueueWrite(objectCommand('user-1', 'missing-lock')),
    ).resolves.toBeNull();
    const liveFetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    await expect(
      missing.offlineWrite.withOfflineOutbox(liveFetch)(
        '/v1/orgs/user-1/object-commands',
        objectCommand('user-1', 'online-without-locks'),
      ),
    ).resolves.toHaveProperty('status', 200);
    expect(liveFetch).toHaveBeenCalledOnce();
    await expect(missing.store.purgeAllOutboxes()).resolves.toBe(true);
    idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'task-1')]);
    const sent = vi.spyOn(globalThis, 'fetch');
    await missing.runtime.drainOutbox();
    expect(sent).not.toHaveBeenCalled();
    await expect(missing.store.purgeAllOutboxes()).resolves.toBe(false);

    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    locks.rejectRequests = true;
    const rejected = await loadRuntime();
    await rejected.runtime.setOutboxUser('user-1');
    expect(rejected.runtime.captureOutboxOwner()).toMatchObject({
      userId: 'user-1',
      epoch: null,
    });
    await expect(
      rejected.runtime.enqueueWrite(objectCommand('user-1', 'rejected-lock')),
    ).resolves.toBeNull();
    await rejected.runtime.drainOutbox();
    expect(sent).not.toHaveBeenCalled();
    await expect(rejected.store.purgeAllOutboxes()).resolves.toBe(false);
  });

  it('does not overwrite a queue whose locked storage read failed', async () => {
    const existing = [storedEntry('user-1', 'keep')];
    idb.values.set(keyFor('user-1'), existing);
    idb.failingReads.add(keyFor('user-1'));
    const { runtime } = await loadRuntime();
    await runtime.setOutboxUser('user-1');

    await expect(runtime.enqueueWrite(objectCommand('user-1', 'new'))).resolves.toBeNull();
    const sent = vi.spyOn(globalThis, 'fetch');
    await runtime.drainOutbox();

    expect(sent).not.toHaveBeenCalled();
    expect(idb.setCalls.filter((call) => call.key === keyFor('user-1'))).toEqual([]);
    expect(idb.values.get(keyFor('user-1'))).toBe(existing);
  });

  it('orders an exclusive purge after an in-flight shared-barrier transition', async () => {
    const { runtime, store } = await loadRuntime();
    await runtime.setOutboxUser('user-1');
    const gate = deferred<undefined>();
    idb.setGates.set(keyFor('user-1'), gate);
    const enqueuing = runtime.enqueueWrite(objectCommand('user-1', 'private'));
    await vi.waitFor(() => {
      expect(idb.setCalls).toHaveLength(1);
    });

    const purging = store.purgeAllOutboxes();
    await Promise.resolve();
    expect(idb.values.has(keyFor('user-1'))).toBe(false);
    gate.resolve(undefined);
    await Promise.all([enqueuing, purging]);

    expect(idb.values.has(keyFor('user-1'))).toBe(false);
  });

  it('uses a data-free BroadcastChannel hint to reread another runtime under a lock', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const a = await loadRuntime();
    const b = await loadRuntime();
    await Promise.all([a.runtime.setOutboxUser('user-1'), b.runtime.setOutboxUser('user-1')]);

    await a.runtime.enqueueWrite(objectCommand('user-1', 'command-a'));

    await vi.waitFor(() => {
      expect(b.runtime.outboxSnapshot().map((entry) => entry.path)).toEqual([
        '/v1/orgs/user-1/object-commands',
      ]);
    });
    expect(FakeBroadcastChannel.channels).toHaveLength(2);
  });

  it('invalidates peer ownership when an exclusive purge announces completed deletion', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const a = await loadRuntime();
    const b = await loadRuntime();
    await Promise.all([a.runtime.setOutboxUser('user-1'), b.runtime.setOutboxUser('user-1')]);
    idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'private')]);

    await a.store.purgeAllOutboxes();

    await vi.waitFor(() => {
      expect(b.runtime.outboxUserId()).toBeNull();
    });
    await expect(b.runtime.enqueueWrite(objectCommand('user-1', 'late'))).resolves.toBeNull();
    expect(idb.values.has(keyFor('user-1'))).toBe(false);
    expect(FakeBroadcastChannel.messages.at(-1)).toBe('purge');
  });

  it('rebinds every same-account peer when an explicit sign-out fails after revocation', async () => {
    const signer = await loadRuntime();
    const peer = await loadRuntime();
    await Promise.all([
      signer.runtime.setOutboxUser('user-1'),
      peer.runtime.setOutboxUser('user-1'),
    ]);

    const owner = durableOwner(signer.runtime.captureOutboxOwner());
    const suspension = await signer.store.suspendOutboxesForOwner(owner);
    if (suspension === null) throw new Error('Expected a suspension receipt');
    signer.runtime.clearOutboxOwnerForSignOut();
    await expect(signer.store.rollbackOutboxSuspension(suspension)).resolves.toBe(true);
    await expect(signer.runtime.restoreOutboxUserAfterFailedSignOut('user-1')).resolves.toBe(
      'restored',
    );

    await vi.waitFor(() => {
      expect(peer.runtime.captureOutboxOwner()).toMatchObject({ userId: 'user-1' });
    });
    expect(FakeBroadcastChannel.messages).toEqual(['purge', 'restore']);
    await expect(
      peer.runtime.enqueueWrite(objectCommand('user-1', 'peer-after-failed-sign-out')),
    ).resolves.not.toBeNull();
    expect(FakeBroadcastChannel.messages.at(-1)).toBe('change');
  });

  it('does not let a stale account replace the durable owner on a restore hint', async () => {
    const staleA = await loadRuntime();
    await staleA.runtime.setOutboxUser('user-a');
    const currentB = await loadRuntime();
    await currentB.runtime.setOutboxUser('user-b');
    await vi.waitFor(() => {
      expect(staleA.runtime.captureOutboxOwner()).toBeNull();
    });
    await currentB.runtime.enqueueWrite(objectCommand('user-b', 'keep-user-b'));
    const ownerB = durableOwner(currentB.runtime.captureOutboxOwner());

    const suspension = await currentB.store.suspendOutboxesForOwner(ownerB);
    if (suspension === null) throw new Error('Expected a suspension receipt');
    currentB.runtime.clearOutboxOwnerForSignOut();
    await currentB.store.rollbackOutboxSuspension(suspension);
    await currentB.runtime.restoreOutboxUserAfterFailedSignOut('user-b');

    await vi.waitFor(() => {
      expect(currentB.runtime.captureOutboxOwner()).toMatchObject({ userId: 'user-b' });
    });
    expect(staleA.runtime.captureOutboxOwner()).toBeNull();
    await expect(currentB.store.readOutbox('user-b', Date.now())).resolves.toEqual([
      expect.objectContaining({ body: expect.stringContaining('keep-user-b') }),
    ]);
  });

  it('restores the exact queue bytes and epoch after a suspended sign-out rolls back', async () => {
    const { runtime, store } = await loadRuntime();
    await runtime.setOutboxUser('user-1');
    await runtime.enqueueWrite(objectCommand('user-1', 'keep-after-failed-sign-out'));
    const owner = durableOwner(runtime.captureOutboxOwner());
    const storedBefore = structuredClone(idb.values.get(keyFor('user-1')));

    const suspension = await store.suspendOutboxesForOwner(owner);
    expect(suspension).not.toBeNull();
    expect(idb.values.get(keyFor('user-1'))).toEqual(storedBefore);
    await expect(store.readOutbox('user-1', Date.now())).resolves.toEqual([]);

    if (suspension === null) throw new Error('Expected a suspension receipt');
    await expect(store.rollbackOutboxSuspension(suspension)).resolves.toBe(true);
    await expect(store.readOutbox('user-1', Date.now())).resolves.toEqual([
      expect.objectContaining({
        userId: 'user-1',
        epoch: owner.epoch,
        body: expect.stringContaining('keep-after-failed-sign-out'),
      }),
    ]);
    expect(idb.values.get(keyFor('user-1'))).toEqual(storedBefore);
  });

  it('deletes suspended queue bytes only after sign-out commits', async () => {
    const { runtime, store } = await loadRuntime();
    await runtime.setOutboxUser('user-1');
    await runtime.enqueueWrite(objectCommand('user-1', 'discard-after-sign-out'));
    const owner = durableOwner(runtime.captureOutboxOwner());

    const suspension = await store.suspendOutboxesForOwner(owner);
    if (suspension === null) throw new Error('Expected a suspension receipt');
    expect(idb.values.has(keyFor('user-1'))).toBe(true);

    await expect(store.commitOutboxSuspension(suspension)).resolves.toBe(true);
    expect(idb.values.has(keyFor('user-1'))).toBe(false);
    await expect(store.rollbackOutboxSuspension(suspension)).resolves.toBe(false);
  });

  it('keeps post-purge local invalidation out of the advisory channel', async () => {
    const a = await loadRuntime();
    const b = await loadRuntime();
    await Promise.all([a.runtime.setOutboxUser('user-1'), b.runtime.setOutboxUser('user-1')]);

    await a.store.purgeAllOutboxes();
    await vi.waitFor(() => {
      expect(b.runtime.outboxUserId()).toBeNull();
    });
    expect(a.runtime.outboxUserId()).toBe('user-1');
    a.runtime.clearOutboxOwnerForSignOut();

    expect(a.runtime.outboxUserId()).toBeNull();
    expect(FakeBroadcastChannel.messages).toEqual(['purge']);
  });

  it('keeps locked storage authoritative when the advisory channel throws', async () => {
    FakeBroadcastChannel.throwOnConstruct = true;
    const constructorFailure = await loadRuntime();
    await constructorFailure.runtime.setOutboxUser('user-1');
    await expect(
      constructorFailure.runtime.enqueueWrite(objectCommand('user-1', 'constructor')),
    ).resolves.not.toBeNull();

    FakeBroadcastChannel.throwOnConstruct = false;
    FakeBroadcastChannel.throwOnPost = true;
    const postFailure = await loadRuntime();
    await postFailure.runtime.setOutboxUser('user-2');
    await expect(
      postFailure.runtime.enqueueWrite(objectCommand('user-2', 'post')),
    ).resolves.not.toBeNull();

    expect(idb.values.has(keyFor('user-1'))).toBe(false);
    expect((idb.values.get(keyFor('user-2')) as unknown[]).length).toBe(1);
  });

  it('fails a mixed malformed load without overwriting or replaying its valid neighbor', async () => {
    const original = [storedEntry('user-1', 'valid'), { id: 'broken', userId: 'user-1' }];
    idb.values.set(keyFor('user-1'), original);
    const { runtime } = await loadRuntime();

    await runtime.setOutboxUser('user-1');
    const appended = await runtime.enqueueWrite({
      method: 'POST',
      path: '/v1/orgs/user-1/object-commands',
      body: JSON.stringify({ commandId: 'late' }),
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'late' },
    });
    const sent = vi.spyOn(globalThis, 'fetch');
    await runtime.drainOutbox();

    expect(appended).toBeNull();
    expect(sent).not.toHaveBeenCalled();
    expect(idb.values.get(keyFor('user-1'))).toEqual(original);
  });

  it.each([42, '', 'x'.repeat(257)])(
    'fails a load whose otherwise-valid record has malformed explicit epoch %j',
    async (epoch) => {
      const original = [storedEntry('user-1', 'malformed-epoch', { epoch })];
      idb.values.set(keyFor('user-1'), original);
      const { runtime } = await loadRuntime();

      await runtime.setOutboxUser('user-1');
      const appended = await runtime.enqueueWrite(objectCommand('user-1', 'late'));
      const sent = vi.spyOn(globalThis, 'fetch');
      await runtime.drainOutbox();

      expect(appended).toBeNull();
      expect(sent).not.toHaveBeenCalled();
      expect(idb.values.get(keyFor('user-1'))).toEqual(original);
    },
  );

  it('fails a load with duplicate entry ids before replay can remove both', async () => {
    const duplicate = [
      storedEntry('user-1', 'same', { body: JSON.stringify({ commandId: 'same' }) }),
      storedEntry('user-1', 'same', { body: JSON.stringify({ commandId: 'same' }) }),
    ];
    idb.values.set(keyFor('user-1'), duplicate);
    const { runtime } = await loadRuntime();
    await runtime.setOutboxUser('user-1');
    const sent = vi.spyOn(globalThis, 'fetch');

    await runtime.drainOutbox();

    expect(sent).not.toHaveBeenCalled();
    expect(idb.values.get(keyFor('user-1'))).toEqual(duplicate);
  });

  it.each(['enumeration', 'deletion'] as const)(
    'uses the durable purge epoch when a peer misses every channel message and %s fails',
    async (failureMode) => {
      FakeBroadcastChannel.throwOnConstruct = true;
      const peer = await loadRuntime();
      await peer.runtime.setOutboxUser('user-1');
      FakeBroadcastChannel.throwOnConstruct = false;
      const signer = await loadRuntime();
      await signer.runtime.setOutboxUser('user-1');
      const oldEntry = storedEntry('user-1', 'old-private');
      idb.values.set(keyFor('user-1'), [oldEntry]);
      if (failureMode === 'enumeration') idb.failingKeyEnumeration = true;
      else idb.failingDeletes.add(keyFor('user-1'));
      const liveAttempt = deferred<Response>();
      const started = vi.fn();
      const wrapped = peer.offlineWrite.withOfflineOutbox(() => {
        started();
        return liveAttempt.promise;
      });
      const pending = wrapped('/v1/orgs/user-1/object-commands', {
        method: 'POST',
        body: JSON.stringify({ commandId: 'late-private' }),
        headers: { 'Content-Type': 'application/json' },
      }).catch((error: unknown) => error);
      await vi.waitFor(() => {
        expect(started).toHaveBeenCalledOnce();
      });

      await signer.store.purgeAllOutboxes();
      const failure = new TypeError('The signed-out request failed');
      liveAttempt.reject(failure);

      await expect(pending).resolves.toBe(failure);
      expect(idb.values.get(keyFor('user-1'))).toEqual([oldEntry]);
      await expect(signer.store.readOutbox('user-1', Date.now())).resolves.toEqual([]);
    },
  );

  it('leaves a peer that misses channel delivery usable when durable purge fails', async () => {
    FakeBroadcastChannel.throwOnConstruct = true;
    const peer = await loadRuntime();
    await peer.runtime.setOutboxUser('user-1');
    await peer.runtime.enqueueWrite(objectCommand('user-1', 'before-failed-purge'));
    FakeBroadcastChannel.throwOnConstruct = false;
    const signer = await loadRuntime();
    await signer.runtime.setOutboxUser('user-1');
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });

    await expect(signer.store.purgeAllOutboxes()).resolves.toBe(false);

    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    expect(peer.runtime.outboxUserId()).toBe('user-1');
    await expect(
      peer.runtime.enqueueWrite(objectCommand('user-1', 'after-failed-purge')),
    ).resolves.not.toBeNull();
    expect(peer.runtime.outboxSnapshot()).toHaveLength(2);
    expect(FakeBroadcastChannel.messages).toEqual([]);
  });

  it('does not report a captured durable owner revoked after Web Locks disappear', async () => {
    const runtime = await loadRuntime();
    await runtime.runtime.setOutboxUser('user-1');
    await runtime.runtime.enqueueWrite(objectCommand('user-1', 'private-before-lock-loss'));
    const owner = runtime.runtime.captureOutboxOwner();
    if (typeof owner?.epoch !== 'string') {
      throw new Error('Expected a durable owner before Web Locks disappeared');
    }
    const stored = structuredClone(idb.values.get(keyFor('user-1')));

    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });

    await expect(
      runtime.store.purgeOutboxesForOwner({ ...owner, epoch: owner.epoch }),
    ).resolves.toBe(false);
    expect(idb.values.get(keyFor('user-1'))).toEqual(stored);
  });

  it('refuses a stale missed-channel purge without deleting a newer-epoch queue', async () => {
    FakeBroadcastChannel.throwOnConstruct = true;
    const stale = await loadRuntime();
    await stale.runtime.setOutboxUser('user-a');
    const staleOwner = stale.runtime.captureOutboxOwner();
    expect(staleOwner).not.toBeNull();
    if (staleOwner === null) throw new Error('Expected user A to own the stale runtime');
    if (staleOwner.epoch === null) throw new Error('Expected user A to hold a durable epoch');

    FakeBroadcastChannel.throwOnConstruct = false;
    const current = await loadRuntime();
    await current.store.purgeAllOutboxes();
    await current.runtime.setOutboxUser('user-b');
    await current.runtime.enqueueWrite(objectCommand('user-b', 'newer-user-b'));
    const newerEpoch = await current.store.readOutboxEpoch();
    const storedB = structuredClone(idb.values.get(keyFor('user-b')));

    await expect(
      stale.store.purgeOutboxesForOwner({ ...staleOwner, epoch: staleOwner.epoch }),
    ).resolves.toBe(false);

    expect(await current.store.readOutboxEpoch()).toBe(newerEpoch);
    expect(idb.values.get(keyFor('user-b'))).toEqual(storedB);
    expect(current.runtime.outboxUserId()).toBe('user-b');
    expect(current.runtime.outboxSnapshot()).toEqual([
      expect.objectContaining({ userId: 'user-b', body: expect.stringContaining('newer-user-b') }),
    ]);
  });

  it('rotates authority when a second account activates from the same initial epoch', async () => {
    FakeBroadcastChannel.throwOnConstruct = true;
    const a = await loadRuntime();
    const b = await loadRuntime();
    await a.runtime.setOutboxUser('user-a');
    const ownerA = a.runtime.captureOutboxOwner();
    if (ownerA === null) throw new Error('Expected user A to own its runtime');
    if (ownerA.epoch === null) throw new Error('Expected user A to hold a durable epoch');
    await a.runtime.enqueueWrite(objectCommand('user-a', 'user-a-private'));

    await b.runtime.setOutboxUser('user-b');
    const ownerB = b.runtime.captureOutboxOwner();
    if (ownerB === null) throw new Error('Expected user B to own its runtime');
    await b.runtime.enqueueWrite(objectCommand('user-b', 'user-b-private'));
    const storedB = structuredClone(idb.values.get(keyFor('user-b')));

    expect(ownerB.epoch).not.toBe(ownerA.epoch);
    await expect(a.store.purgeOutboxesForOwner({ ...ownerA, epoch: ownerA.epoch })).resolves.toBe(
      false,
    );
    expect(idb.values.get(keyFor('user-b'))).toEqual(storedB);
    expect(b.runtime.outboxSnapshot()).toEqual([
      expect.objectContaining({
        userId: 'user-b',
        body: expect.stringContaining('user-b-private'),
      }),
    ]);
  });

  it('keeps a newer owner when an older purge hint arrives late', async () => {
    const current = await loadRuntime();
    await current.runtime.setOutboxUser('user-a');
    await current.runtime.setOutboxUser('user-b');
    await current.runtime.enqueueWrite(objectCommand('user-b', 'newer-after-old-hint'));

    FakeBroadcastChannel.channels[0]?.onmessage?.({ data: 'purge' } as MessageEvent<unknown>);

    await vi.waitFor(() => {
      expect(current.runtime.outboxUserId()).toBe('user-b');
      expect(current.runtime.outboxSnapshot()).toEqual([
        expect.objectContaining({
          userId: 'user-b',
          body: expect.stringContaining('newer-after-old-hint'),
        }),
      ]);
    });
  });

  it('reconciles accepted removal in every tab without BroadcastChannel delivery', async () => {
    FakeBroadcastChannel.throwOnConstruct = true;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'accepted')]);
    const leader = await loadRuntime();
    const follower = await loadRuntime();
    await Promise.all([
      leader.runtime.setOutboxUser('user-1'),
      follower.runtime.setOutboxUser('user-1'),
    ]);
    const leaderSynced = vi.fn();
    const followerSynced = vi.fn();
    const stopLeader = leader.runtime.startOutboxDrain(leaderSynced);
    const stopFollower = follower.runtime.startOutboxDrain(followerSynced);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    await leader.runtime.drainOutbox();
    await follower.runtime.drainOutbox();

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(leaderSynced).toHaveBeenCalledOnce();
    expect(followerSynced).toHaveBeenCalledOnce();
    stopLeader();
    stopFollower();
  });

  it('times out a hung replay so an exclusive purge can take the barrier', async () => {
    vi.useFakeTimers();
    try {
      idb.values.set(keyFor('user-1'), [storedEntry('user-1', 'hung')]);
      const { runtime, store } = await loadRuntime();
      await runtime.setOutboxUser('user-1');
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Timed out', 'AbortError'));
            });
          }),
      );

      const draining = runtime.drainOutbox();
      await vi.advanceTimersByTimeAsync(0);
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const purging = store.purgeAllOutboxes();
      const purged = vi.fn();
      void purging.then(purged);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(purged).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([draining, purging]);

      expect(purged).toHaveBeenCalledOnce();
      expect(idb.values.has(keyFor('user-1'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
