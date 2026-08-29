import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeLockManager } from './fake-lock-manager';

/**
 * The offline write queue end to end, minus the browser: enqueue on an undeliverable write, survive
 * a reload, replay in order on reconnect, and refuse to invent a success.
 *
 * @remarks
 * `idb-keyval` is replaced with an in-memory map rather than a fake IndexedDB, because what is
 * being tested is the queue's behaviour, not the storage driver — and because the durability
 * property that matters ("the change is still there after the tab dies") is expressed exactly by
 * re-reading the same store into a fresh queue, which this makes trivial and honest.
 */

const store = new Map<string, unknown>();
const OUTBOX_EPOCH_KEY = 'docket:outbox-revocation-epoch:v1';

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

const delayedGets = new Map<string, Deferred<unknown>>();
const delayedSets = new Map<string, Deferred<undefined>[]>();
const failedSetNumbers = new Map<string, Set<number>>();
const setCalls: { readonly key: string; readonly value: unknown }[] = [];
let locks: FakeLockManager;

vi.mock('idb-keyval', () => ({
  get: (key: string) =>
    delayedGets.get(key)?.promise ?? Promise.resolve(structuredClone(store.get(key))),
  set: (key: string, value: unknown) => {
    setCalls.push({ key, value });
    const callNumber = setCalls.filter((call) => call.key === key).length;
    if (failedSetNumbers.get(key)?.has(callNumber)) {
      return Promise.reject(new Error(`IndexedDB refused set ${String(callNumber)}`));
    }
    const storedValue = structuredClone(value);
    const write = delayedSets.get(key)?.shift();
    if (write === undefined) {
      store.set(key, storedValue);
      return Promise.resolve();
    }
    return write.promise.then(() => {
      store.set(key, storedValue);
    });
  },
  del: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
  keys: () => Promise.resolve([...store.keys()]),
}));

const { QueuedOfflineWriteError, queuedOfflineWrite, withOfflineOutbox } =
  await import('@/components/pwa/offline-write');
const {
  captureOutboxOwner,
  clearOutboxOwnerForSignOut,
  drainOutbox,
  enqueueWrite,
  outboxSnapshot,
  outboxUserId,
  retryEntry,
  setOutboxUser,
  startOutboxDrain,
  subscribeOutbox,
  withOutboxSessionTransition,
} = await import('@/components/pwa/outbox');
const { outboxKeyFor, purgeAllOutboxes, readOutbox } =
  await import('@/components/pwa/outbox-store');

/** The queue refuses to store anything in an environment with no IndexedDB. */
beforeEach(async () => {
  Object.defineProperty(window, 'indexedDB', { value: {}, configurable: true });
  locks = new FakeLockManager();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  setOnline(true);
  store.clear();
  delayedGets.clear();
  delayedSets.clear();
  failedSetNumbers.clear();
  setCalls.length = 0;
  await setOutboxUser(null);
  await setOutboxUser('user-1');
  setCalls.length = 0;
});

afterEach(async () => {
  await setOutboxUser(null);
  vi.restoreAllMocks();
});

/** A `fetch` that always rejects, standing in for a device with no connection. */
const offlineFetch = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

/** A complete retry contract for direct POST enqueue tests that bypass the live wrapper. */
function postHeaders(key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'Idempotency-Key': key };
}

/** One atomically idempotent write that the browser queue is allowed to own. */
function objectCommand(
  commandId: string,
  fields: Readonly<Record<string, unknown>> = {},
  orgId = 'o1',
): {
  readonly method: 'POST';
  readonly path: string;
  readonly body: string;
  readonly headers: Record<string, string>;
} {
  return {
    method: 'POST',
    path: `/v1/orgs/${orgId}/object-commands`,
    body: JSON.stringify({ commandId, ...fields }),
    headers: postHeaders(commandId),
  };
}

/** Control only the browser's fast connectivity hint. */
function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

describe('withOfflineOutbox', () => {
  it('queues an undeliverable API write and says so in the app’s own words', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const command = objectCommand('rename-task');

    const caught = await wrapped(command.path, command).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(QueuedOfflineWriteError);
    expect((caught as Error).message).toBe(
      "Saved on this device. Docket will sync it as soon as you're back online.",
    );
    expect(outboxSnapshot()).toHaveLength(1);
    expect(outboxSnapshot()[0]).toMatchObject({
      method: 'POST',
      path: '/v1/orgs/o1/object-commands',
      label: 'Object change',
      status: 'queued',
    });
  });

  it('ages a queued write from the start of its first live attempt', async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const command = objectCommand('lost-response-age');
    const wrapped = withOfflineOutbox(async () => {
      now += 30_000;
      throw new TypeError('Response was lost');
    });

    await expect(wrapped(command.path, command)).rejects.toBeInstanceOf(QueuedOfflineWriteError);

    expect(outboxSnapshot()[0]?.createdAt).toBe(1_800_000_000_000);
  });

  it('refuses to queue when the first live attempt already consumed the replay window', async () => {
    const startedAt = 1_800_000_000_000;
    let now = startedAt;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const command = objectCommand('too-late-to-queue');
    const failure = new TypeError('Response was lost too late');
    const wrapped = withOfflineOutbox(async () => {
      now = startedAt + 24 * 60 * 60 * 1000;
      throw failure;
    });

    await expect(wrapped(command.path, command)).rejects.toBe(failure);

    expect(outboxSnapshot()).toEqual([]);
  });

  it('survives a reload — the entry is read back from storage by a fresh queue', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const command = objectCommand('survive-reload');
    await wrapped(command.path, command).catch(() => undefined);

    // Simulate a new tab: nothing in memory, everything from IndexedDB.
    const restored = await readOutbox('user-1', Date.now());
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ label: 'Object change', status: 'queued' });
  });

  it('injects one stable idempotency key into string, URL, and Request POST attempts', async () => {
    const liveRequests: { readonly key: string | null; readonly body: string }[] = [];
    const wrapped = withOfflineOutbox(async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected a prepared Request');
      liveRequests.push({
        key: input.headers.get('Idempotency-Key'),
        body: await input.text(),
      });
      throw new TypeError('Response was lost');
    });
    const existingKey = 'caller-owned-key';
    const request = new Request(new URL('/v1/orgs/o1/object-commands', window.location.origin), {
      method: 'POST',
      body: JSON.stringify({ commandId: existingKey }),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': existingKey,
        'If-Match': '"must-not-persist"',
      },
    });

    for (const [input, init] of [
      [
        '/v1/orgs/o1/object-commands',
        {
          method: 'POST',
          body: JSON.stringify({ commandId: 'string-command' }),
          headers: { 'Content-Type': 'application/json' },
        },
      ],
      [
        new URL('/v1/orgs/o1/object-commands', window.location.origin),
        {
          method: 'POST',
          body: JSON.stringify({ commandId: 'url-command' }),
          headers: { 'Content-Type': 'application/json' },
        },
      ],
      [request, undefined],
    ] as const) {
      const caught = await wrapped(input, init).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(QueuedOfflineWriteError);
    }

    expect(liveRequests.map((attempt) => attempt.body)).toEqual([
      JSON.stringify({ commandId: 'string-command' }),
      JSON.stringify({ commandId: 'url-command' }),
      JSON.stringify({ commandId: existingKey }),
    ]);
    expect(liveRequests.every((attempt) => Boolean(attempt.key))).toBe(true);
    expect(liveRequests[2]?.key).toBe(existingKey);
    expect(outboxSnapshot().map((entry) => entry.headers['Idempotency-Key'])).toEqual(
      liveRequests.map((attempt) => attempt.key),
    );
    expect(outboxSnapshot()[2]?.headers).not.toHaveProperty('If-Match');
    expect(outboxSnapshot()[2]?.headers).not.toHaveProperty('X-Docket-Replay-Owner');
  });

  it('replays the exact key from a POST whose committed response was lost', async () => {
    let liveKey: string | null = null;
    const wrapped = withOfflineOutbox(async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected a prepared Request');
      liveKey = input.headers.get('Idempotency-Key');
      await input.text();
      throw new TypeError('The server committed before the connection dropped');
    });
    const command = objectCommand('committed-response-lost');
    await wrapped(command.path, command).catch(() => undefined);

    let replayKey: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      replayKey = new Headers(init?.headers).get('Idempotency-Key');
      return new Response('{"id":"task-1"}', { status: 201 });
    });
    await drainOutbox();

    expect(liveKey).not.toBeNull();
    expect(replayKey).toBe(liveKey);
    expect(outboxSnapshot()).toEqual([]);
  });

  it('passes a read straight through — a failed read has nothing to replay', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const caught = await wrapped('/v1/orgs/o1/tasks').then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(TypeError);
    expect(outboxSnapshot()).toHaveLength(0);
  });

  it('never queues auth traffic', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    await wrapped('/api/auth/sign-in/passkey', { method: 'POST', body: '{}' }).catch(
      () => undefined,
    );
    expect(outboxSnapshot()).toHaveLength(0);
  });

  it('never claims sensitive or response-dependent writes after a network failure', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    for (const [method, path] of [
      ['POST', '/v1/me/recovery-codes'],
      ['DELETE', '/v1/me'],
      ['POST', '/v1/orgs/o1/billing/checkout'],
      ['POST', '/v1/orgs/o1/object-commands/replay-access'],
      ['POST', '/v1/orgs/o1/labels'],
    ] as const) {
      const caught = await wrapped(path, { method, body: '{}' }).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).not.toBeInstanceOf(QueuedOfflineWriteError);
    }
    expect(outboxSnapshot()).toEqual([]);
  });

  it('never masks a server error as an offline one', async () => {
    // The server answered. Whatever it said is the caller's business, not the queue's.
    const serverError = new Response('{}', { status: 500 });
    const wrapped = withOfflineOutbox(() => Promise.resolve(serverError));
    const response = await wrapped('/v1/orgs/o1/tasks', { method: 'POST', body: '{}' });
    expect(response.status).toBe(500);
    expect(outboxSnapshot()).toHaveLength(0);
  });

  it('does not enqueue an A request under B when its live fetch rejects after the switch', async () => {
    await setOutboxUser('user-a');
    const liveFetch = deferred<Response>();
    const wrapped = withOfflineOutbox(() => liveFetch.promise);
    const command = objectCommand('switch-a-one', { title: 'A one' }, 'user-a');
    const pending = wrapped(command.path, command).then(
      () => null,
      (error: unknown) => error,
    );

    await setOutboxUser('user-b');
    const failure = new TypeError('Failed to fetch');
    liveFetch.reject(failure);

    await expect(pending).resolves.toBe(failure);
    expect(outboxSnapshot()).toEqual([]);
    expect(await readOutbox('user-b', Date.now())).toEqual([]);
  });

  it('does not enqueue after A changes to B and back to a new A generation', async () => {
    await setOutboxUser('user-a');
    const liveFetch = deferred<Response>();
    const wrapped = withOfflineOutbox(() => liveFetch.promise);
    const command = objectCommand('old-a', { title: 'Old A' }, 'user-a');
    const pending = wrapped(command.path, command).then(
      () => null,
      (error: unknown) => error,
    );

    await setOutboxUser('user-b');
    await setOutboxUser('user-a');
    const failure = new TypeError('Failed to fetch');
    liveFetch.reject(failure);

    await expect(pending).resolves.toBe(failure);
    expect(outboxSnapshot()).toEqual([]);
    expect(await readOutbox('user-a', Date.now())).toEqual([]);
  });

  it('queues the body when the client puts it on a Request instead of in init', async () => {
    // Hono's client does exactly this. Reading the body only from `init` produced entries with no
    // body: they replayed, the server answered 200, and the change was silently lost.
    const wrapped = withOfflineOutbox(offlineFetch);
    const command = objectCommand('request-body', { title: 'From a Request' });
    const request = new Request(new URL(command.path, window.location.origin), {
      method: command.method,
      body: command.body,
      headers: command.headers,
    });
    await wrapped(request).catch(() => undefined);

    expect(outboxSnapshot()[0]).toMatchObject({
      method: 'POST',
      body: command.body,
      headers: command.headers,
    });
  });

  it('never converts failed external or protocol-relative writes into Docket writes', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const targets: readonly (string | URL | Request)[] = [
      'https://outside.test/v1/orgs/o1/tasks',
      '//outside.test/v1/orgs/o1/tasks',
      new URL('https://outside.test/v1/orgs/o1/tasks'),
      new Request('https://outside.test/v1/orgs/o1/tasks', {
        method: 'POST',
        body: '{}',
      }),
    ];

    for (const target of targets) {
      await wrapped(target, { method: 'POST', body: '{}' }).catch(() => undefined);
    }

    expect(outboxSnapshot()).toHaveLength(0);
    expect(await readOutbox('user-1', Date.now())).toHaveLength(0);
  });

  it('does not queue malformed API targets or unapproved methods', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    for (const [method, target] of [
      ['POST', ''],
      ['POST', '/not-v1/tasks'],
      ['GET', '/v1/orgs/o1/tasks'],
      ['TRACE', '/v1/orgs/o1/tasks'],
      ['POST', '/v1/../api/auth/sign-out'],
      ['POST', '/v1/orgs/o1/tasks#fragment'],
    ] as const) {
      await wrapped(target, { method, body: '{}' }).catch(() => undefined);
    }

    expect(outboxSnapshot()).toHaveLength(0);
  });

  it('refuses a body it could not replay faithfully', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const form = new FormData();
    form.set('a', 'b');
    const caught = await wrapped('/v1/orgs/o1/object-commands', {
      method: 'POST',
      body: form,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(TypeError);
    expect(outboxSnapshot()).toHaveLength(0);
  });

  it('fails honestly when no account owns the queue', async () => {
    await setOutboxUser(null);
    const inner = vi.fn(offlineFetch);
    const wrapped = withOfflineOutbox(inner);
    const command = objectCommand('no-owner');
    const caught = await wrapped(command.path, command).then(
      () => null,
      (error: unknown) => error,
    );
    // Nothing took responsibility, so nothing may claim it will sync.
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).not.toBeInstanceOf(QueuedOfflineWriteError);
    expect(inner).not.toHaveBeenCalled();
  });

  it('sends an online command under the requested account while durable binding is pending', async () => {
    await setOutboxUser(null);
    setCalls.length = 0;
    const bindingGate = deferred<undefined>();
    delayedSets.set(OUTBOX_EPOCH_KEY, [bindingGate]);
    const binding = setOutboxUser('binding-user');
    await vi.waitFor(() => {
      expect(setCalls.some((call) => call.key === OUTBOX_EPOCH_KEY)).toBe(true);
    });
    expect(captureOutboxOwner()).toBeNull();

    let replayOwner: string | null = null;
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      if (!(input instanceof Request)) throw new Error('Expected a prepared Request');
      replayOwner = input.headers.get('X-Docket-Replay-Owner');
      return new Response('{}', { status: 200 });
    });
    const command = objectCommand('binding-live-command', {}, 'binding-user');
    const result = await withOfflineOutbox(inner)(command.path, command).catch(
      (error: unknown) => error,
    );

    bindingGate.resolve(undefined);
    await binding;

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(200);
    expect(replayOwner).toBe('binding-user');
    expect(inner).toHaveBeenCalledOnce();
    expect(outboxSnapshot()).toEqual([]);
  });

  it('uses an object command id as the missing live and replay idempotency key', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const caught = await wrapped('/v1/orgs/org-1/object-commands', {
      method: 'POST',
      body: JSON.stringify({
        commandId: 'restore-project-1',
        direction: 'undo',
        receipt: {
          commandId: 'trash-project-1',
          objectKind: 'project',
          action: 'trash',
          entries: [],
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(QueuedOfflineWriteError);
    expect(outboxSnapshot()).toHaveLength(1);
    expect(outboxSnapshot()[0]?.headers['Idempotency-Key']).toBe('restore-project-1');
  });

  it('binds a delayed live attempt to the account captured before body serialization', async () => {
    await setOutboxUser('user-a');
    let releaseBody!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        releaseBody = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ commandId: 'delayed-a' })));
          controller.close();
        };
      },
    });
    const request = new Request(new URL('/v1/orgs/o1/object-commands', window.location.origin), {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      duplex: 'half',
    } as RequestInit & { readonly duplex: 'half' });
    let liveHeaders = new Headers();
    let ambientUserId = 'user-a';
    let domainExecutions = 0;
    const wrapped = withOfflineOutbox(async (input) => {
      if (!(input instanceof Request)) throw new Error('Expected a prepared Request');
      liveHeaders = new Headers(input.headers);
      if (liveHeaders.get('X-Docket-Replay-Owner') !== ambientUserId) {
        return new Response('{}', { status: 401 });
      }
      domainExecutions += 1;
      return new Response('{}', { status: 200 });
    });

    const pending = wrapped(request);
    await setOutboxUser('user-b');
    ambientUserId = 'user-b';
    releaseBody();

    await expect(pending).resolves.toMatchObject({ status: 401 });
    expect(liveHeaders.get('X-Docket-Replay-Owner')).toBe('user-a');
    expect(domainExecutions).toBe(0);
    expect(await readOutbox('user-a', Date.now())).toEqual([]);
    expect(await readOutbox('user-b', Date.now())).toEqual([]);
  });

  it('normalizes every same-origin input form and rejects embedded URL credentials', async () => {
    const liveOwners: (string | null)[] = [];
    const inner = vi.fn((input: RequestInfo | URL) => {
      if (!(input instanceof Request)) throw new Error('Expected a prepared Request');
      liveOwners.push(input.headers.get('X-Docket-Replay-Owner'));
      return offlineFetch();
    });
    const wrapped = withOfflineOutbox(inner);
    const body = JSON.stringify({ commandId: 'same-origin-command' });
    const headers = { 'Content-Type': 'application/json' };
    const targets: readonly (string | URL | Request)[] = [
      '/v1/orgs/o1/object-commands',
      `${window.location.origin}/v1/orgs/o1/object-commands`,
      new URL('/v1/orgs/o1/object-commands', window.location.origin),
      new Request(new URL('/v1/orgs/o1/object-commands', window.location.origin), {
        method: 'POST',
        body,
        headers,
      }),
      `${window.location.origin}/v1/orgs/o1/object-commands#ignored-by-fetch`,
      new URL('/v1/orgs/o1/object-commands#ignored-by-fetch', window.location.origin),
      new Request(new URL('/v1/orgs/o1/object-commands#ignored-by-fetch', window.location.origin), {
        method: 'POST',
        body,
        headers,
      }),
    ];

    for (const target of targets) {
      const init = target instanceof Request ? undefined : { method: 'POST', body, headers };
      const caught = await wrapped(target, init).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(QueuedOfflineWriteError);
    }
    expect(outboxSnapshot()).toHaveLength(7);
    expect(inner).toHaveBeenCalledTimes(7);
    expect(liveOwners).toEqual(Array.from({ length: 7 }, () => 'user-1'));

    const credentialUrl = `${window.location.protocol}//user:secret@${window.location.host}/v1/orgs/o1/object-commands`;
    const credentialRequest = new Request(
      new URL('/v1/orgs/o1/object-commands', window.location.origin),
      { method: 'POST', body, headers },
    );
    Object.defineProperty(credentialRequest, 'url', { value: credentialUrl });
    for (const target of [credentialUrl, new URL(credentialUrl), credentialRequest]) {
      const init = target instanceof Request ? undefined : { method: 'POST', body, headers };
      const caught = await wrapped(target, init).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).not.toBeInstanceOf(QueuedOfflineWriteError);
    }
    expect(outboxSnapshot()).toHaveLength(7);
    expect(inner).toHaveBeenCalledTimes(7);
  });
});

describe('queuedOfflineWrite', () => {
  it('recognises the queued error through the data layer’s wrapping', () => {
    const queued = new QueuedOfflineWriteError('entry-1');
    const wrapped = new Error('Could not save the task.', { cause: queued });
    expect(queuedOfflineWrite(wrapped)).toBe(queued);
    expect(queuedOfflineWrite(new Error('plain'))).toBeNull();
    expect(queuedOfflineWrite(undefined)).toBeNull();
  });
});

describe('drainOutbox', () => {
  /** Queue three writes with no connection, then reconnect. */
  async function queueThree(): Promise<void> {
    const wrapped = withOfflineOutbox(offlineFetch);
    for (const title of ['a', 'b', 'c']) {
      const command = objectCommand(`queue-${title}`, { title });
      await wrapped(command.path, command).catch(() => undefined);
    }
  }

  it('replays every queued write, in the order it was made, with no user action', async () => {
    await queueThree();
    const sent: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(((_url: string, init?: RequestInit) => {
      sent.push(typeof init?.body === 'string' ? init.body : '');
      return Promise.resolve(new Response('{}', { status: 201 }));
    }) as unknown as typeof fetch);

    await drainOutbox();

    expect(sent).toEqual([
      '{"commandId":"queue-a","title":"a"}',
      '{"commandId":"queue-b","title":"b"}',
      '{"commandId":"queue-c","title":"c"}',
    ]);
    expect(outboxSnapshot()).toHaveLength(0);
    expect(await readOutbox('user-1', Date.now())).toHaveLength(0);
  });

  it('sends the original method, body and content type', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const command = objectCommand('due-date-command', { dueDate: '2026-08-09' });
    await wrapped(command.path, command).catch(() => undefined);

    let seen: RequestInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(((_url: string, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch);
    await drainOutbox();

    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe(command.body);
    expect(seen?.credentials).toBe('include');
    expect(new Headers(seen?.headers).get('Content-Type')).toBe('application/json');
  });

  it('never persists or replays If-Match from the live request', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const command = objectCommand('unconditional-replay', { title: 'Conditional' });
    await wrapped(command.path, {
      ...command,
      headers: {
        ...command.headers,
        'If-Match': '"task-version-9"',
      },
    }).catch(() => undefined);
    let replayHeaders = new Headers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      replayHeaders = new Headers(init?.headers);
      return new Response('{}', { status: 200 });
    });

    await drainOutbox();

    expect(replayHeaders.get('If-Match')).toBeNull();
  });

  it('replays an object command with its idempotency contract and no sensitive headers', async () => {
    const body = JSON.stringify({
      commandId: 'restore-project-1',
      direction: 'undo',
      receipt: {
        commandId: 'trash-project-1',
        objectKind: 'project',
        action: 'trash',
        entries: [],
      },
    });
    const wrapped = withOfflineOutbox(offlineFetch);
    await wrapped('/v1/orgs/org-1/object-commands', {
      method: 'POST',
      body,
      headers: {
        Authorization: 'Bearer must-not-be-persisted',
        Cookie: 'session=must-not-be-persisted',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'restore-project-1',
        'X-Request-Secret': 'must-not-be-persisted',
      },
    }).catch(() => undefined);
    await setOutboxUser(null);
    await setOutboxUser('user-1');

    let replayHeaders = new Headers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(((_url: string, init?: RequestInit) => {
      replayHeaders = new Headers(init?.headers);
      const validObjectCommand =
        init?.body === body &&
        replayHeaders.get('content-type') === 'application/json' &&
        replayHeaders.get('idempotency-key') === 'restore-project-1';
      return Promise.resolve(new Response('{}', { status: validObjectCommand ? 200 : 422 }));
    }) as unknown as typeof fetch);

    await drainOutbox();

    expect(outboxSnapshot()).toHaveLength(0);
    expect(replayHeaders.get('content-type')).toBe('application/json');
    expect(replayHeaders.get('idempotency-key')).toBe('restore-project-1');
    expect(replayHeaders.get('authorization')).toBeNull();
    expect(replayHeaders.get('cookie')).toBeNull();
    expect(replayHeaders.get('x-request-secret')).toBeNull();
  });

  it('replays a stored object command from the old schema with its body command identity', async () => {
    store.set(outboxKeyFor('user-1'), [
      {
        id: 'legacy-object-command',
        userId: 'user-1',
        method: 'POST',
        path: '/v1/orgs/org-1/object-commands',
        body: JSON.stringify({
          commandId: 'restore-project-1',
          direction: 'undo',
          receipt: {
            commandId: 'trash-project-1',
            objectKind: 'project',
            action: 'trash',
            entries: [],
          },
        }),
        contentType: 'application/json',
        label: 'Change',
        createdAt: Date.now(),
        attempts: 0,
        status: 'queued',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1');
    let replayHeaders = new Headers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(((_url: string, init?: RequestInit) => {
      replayHeaders = new Headers(init?.headers);
      const validObjectCommand =
        replayHeaders.get('content-type') === 'application/json' &&
        replayHeaders.get('idempotency-key') === 'restore-project-1';
      return Promise.resolve(new Response('{}', { status: validObjectCommand ? 200 : 422 }));
    }) as unknown as typeof fetch);

    await drainOutbox();

    expect(outboxSnapshot()).toHaveLength(0);
    expect(replayHeaders.get('content-type')).toBe('application/json');
    expect(replayHeaders.get('idempotency-key')).toBe('restore-project-1');
  });

  it('preserves an unsupported ordinary PATCH stored with the old content-type field', async () => {
    store.set(outboxKeyFor('user-1'), [
      {
        id: 'legacy-task-change',
        userId: 'user-1',
        method: 'PATCH',
        path: '/v1/orgs/org-1/tasks/task-1',
        body: '{"title":"Legacy"}',
        contentType: 'application/json',
        label: 'Task change',
        createdAt: Date.now(),
        attempts: 0,
        status: 'queued',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1');
    const sent = vi.spyOn(globalThis, 'fetch');

    await drainOutbox();

    expect(outboxSnapshot()).toHaveLength(0);
    expect(sent).not.toHaveBeenCalled();
    expect(store.get(outboxKeyFor('user-1'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'legacy-task-change' })]),
    );
  });

  it('stops at the first unanswered request without spending any retry attempts', async () => {
    await queueThree();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    await drainOutbox();

    expect(calls).toBe(1);
    const queue = outboxSnapshot();
    expect(queue.map((entry) => entry.attempts)).toEqual([0, 0, 0]);
    expect(queue.every((entry) => entry.status === 'queued')).toBe(true);
  });

  it('uses navigator.onLine as a fast pause and does not call fetch while it is false', async () => {
    await queueThree();
    setOnline(false);
    const sent = vi.spyOn(globalThis, 'fetch');

    await drainOutbox();

    expect(sent).not.toHaveBeenCalled();
    expect(outboxSnapshot().map((entry) => entry.attempts)).toEqual([0, 0, 0]);
  });

  it('keeps the owner bound and asks the session recovery path after a replay 401', async () => {
    await queueThree();
    const owner = captureOutboxOwner();
    setOnline(false);
    const unauthorized = vi.fn();
    const stop = startOutboxDrain(vi.fn(), unauthorized);
    setOnline(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));

    await drainOutbox();

    expect(outboxUserId()).toBe('user-1');
    expect(outboxSnapshot().map((entry) => entry.attempts)).toEqual([0, 0, 0]);
    expect(outboxSnapshot().every((entry) => entry.status === 'queued')).toBe(true);
    expect(unauthorized).toHaveBeenCalledExactlyOnceWith(owner);
    stop();
  });

  it.each([408, 425, 429, 500, 503])(
    'spends one attempt and stops at the first transient %i response',
    async (status) => {
      await queueThree();
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }));

      await drainOutbox();

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(outboxSnapshot().map((entry) => entry.attempts)).toEqual([1, 0, 0]);
    },
  );

  it('refuses direct PATCH and DELETE admission before replay', async () => {
    const patch = await enqueueWrite({
      method: 'PATCH',
      path: '/v1/orgs/o1/tasks/missing',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    const deletion = await enqueueWrite({
      method: 'DELETE',
      path: '/v1/orgs/o1/tasks/gone',
      body: null,
    });

    expect(patch).toBeNull();
    expect(deletion).toBeNull();
    expect(outboxSnapshot()).toEqual([]);
  });

  it('marks a refused change as needing a person, and does not strand the rest behind it', async () => {
    await queueThree();
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      return Promise.resolve(new Response('{}', { status: call === 1 ? 409 : 201 }));
    });

    await drainOutbox();

    const queue = outboxSnapshot();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ status: 'blocked' });
  });

  it.each([
    ['concurrent 409 with delta seconds', 409, '120', 0],
    ['throttled 429 with an HTTP date', 429, new Date(1_800_000_120_000).toUTCString(), 1],
    ['unavailable 503 with delta seconds', 503, '120', 1],
  ])(
    'persists a %s Retry-After deadline without burning attempts early',
    async (_label, status, value, expectedAttempts) => {
      const now = 1_800_000_000_000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      await enqueueWrite(objectCommand('paced-command'), now);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status, headers: { 'Retry-After': value } }),
      );

      await drainOutbox();
      expect(outboxSnapshot()[0]).toMatchObject({
        status: 'queued',
        attempts: expectedAttempts,
        notBeforeAt: now + 120_000,
      });

      clock.mockReturnValue(now + 119_999);
      await drainOutbox();
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(outboxSnapshot()[0]).toMatchObject({ attempts: expectedAttempts });

      clock.mockReturnValue(now + 120_000);
      vi.mocked(globalThis.fetch).mockResolvedValue(new Response('{}', { status: 200 }));
      await drainOutbox();
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(outboxSnapshot()).toEqual([]);
    },
  );

  it('does not send a later command while the queue head is paced', async () => {
    const startedAt = 1_800_000_000_000;
    let now = startedAt;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await enqueueWrite(objectCommand('paced-head'), startedAt);
    await enqueueWrite(objectCommand('dependent-tail'), startedAt + 1);
    const sent: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      sent.push(typeof init?.body === 'string' ? init.body : '');
      return sent.length === 1
        ? new Response('{}', { status: 503, headers: { 'Retry-After': '120' } })
        : new Response('{}', { status: 200 });
    });

    await drainOutbox();
    now = startedAt + 60_000;
    await drainOutbox();
    expect(sent).toEqual(['{"commandId":"paced-head"}']);

    now = startedAt + 120_000;
    await drainOutbox();
    expect(sent).toEqual([
      '{"commandId":"paced-head"}',
      '{"commandId":"paced-head"}',
      '{"commandId":"dependent-tail"}',
    ]);
    expect(outboxSnapshot()).toEqual([]);
  });

  it('keeps an in-progress idempotency key queued beyond five contention intervals', async () => {
    const startedAt = 1_800_000_000_000;
    let now = startedAt;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await enqueueWrite(objectCommand('long-running-command'), startedAt);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 409, headers: { 'Retry-After': '1' } }),
    );

    for (let contention = 0; contention < 7; contention += 1) {
      now = startedAt + contention * 1_000;
      await drainOutbox();
    }

    expect(globalThis.fetch).toHaveBeenCalledTimes(7);
    expect(outboxSnapshot()[0]).toMatchObject({
      status: 'queued',
      attempts: 0,
      notBeforeAt: startedAt + 7_000,
    });
  });

  it('does not let manual retry bypass a future server deadline at the attempt limit', async () => {
    const startedAt = 1_800_000_000_000;
    let now = startedAt;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await enqueueWrite(objectCommand('max-attempt-pacing'), startedAt);
    const stored = outboxSnapshot()[0];
    if (stored === undefined) throw new Error('Expected the queued command');
    store.set(outboxKeyFor('user-1'), [
      { ...stored, attempts: 4, status: 'queued', notBeforeAt: null },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1', startedAt);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 503, headers: { 'Retry-After': '120' } }),
    );

    await drainOutbox();
    expect(outboxSnapshot()[0]).toMatchObject({
      status: 'blocked',
      attempts: 5,
      notBeforeAt: startedAt + 120_000,
    });

    now = startedAt + 119_999;
    await retryEntry(stored.id);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(outboxSnapshot()[0]).toMatchObject({
      status: 'blocked',
      attempts: 5,
      notBeforeAt: startedAt + 120_000,
    });

    now = startedAt + 120_000;
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('{}', { status: 200 }));
    await retryEntry(stored.id);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(outboxSnapshot()).toEqual([]);
  });

  it('keeps a generic domain 409 blocked when it has no retry deadline', async () => {
    await enqueueWrite(objectCommand('domain-conflict'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));

    await drainOutbox();

    expect(outboxSnapshot()[0]).toMatchObject({ status: 'blocked', attempts: 1 });
  });

  it('recomputes time before selecting each serial replay', async () => {
    const startedAt = 1_800_000_000_000;
    let now = startedAt;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await enqueueWrite(objectCommand('first-command'), startedAt);
    await enqueueWrite(objectCommand('second-command'), startedAt);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      now = startedAt + 24 * 60 * 60 * 1000 + 1;
      return new Response('{}', { status: 200 });
    });

    await drainOutbox();

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(outboxSnapshot()).toHaveLength(1);
    expect(outboxSnapshot()[0]).toMatchObject({
      headers: { 'Idempotency-Key': 'second-command' },
      status: 'expired',
    });
  });

  it('fails the whole load when one current-owner stored route is unsupported', async () => {
    const createdAt = Date.now();
    store.set(outboxKeyFor('user-1'), [
      {
        id: 'external',
        userId: 'user-1',
        method: 'POST',
        path: 'https://outside.test/v1/orgs/o1/tasks',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        label: 'New task',
        createdAt,
        attempts: 0,
        status: 'queued',
      },
      {
        id: 'read',
        userId: 'user-1',
        method: 'GET',
        path: '/v1/orgs/o1/tasks',
        body: null,
        headers: {},
        label: 'Change',
        createdAt,
        attempts: 0,
        status: 'queued',
      },
      {
        id: 'valid',
        userId: 'user-1',
        ...objectCommand('valid'),
        label: 'Object change',
        createdAt,
        attempts: 0,
        status: 'queued',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1');
    const sent: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (typeof input !== 'string') throw new Error('Expected replay to use a relative path');
      sent.push(input);
      return new Response('{}', { status: 200 });
    });

    await drainOutbox();

    expect(sent).toEqual([]);
    expect(outboxSnapshot()).toHaveLength(0);
    expect(store.get(outboxKeyFor('user-1'))).toHaveLength(3);
  });

  it('preserves unmatched and legacy POSTs without an atomic dedupe contract', async () => {
    const createdAt = Date.now();
    store.set(outboxKeyFor('user-1'), [
      {
        id: 'sensitive',
        userId: 'user-1',
        method: 'POST',
        path: '/v1/me/recovery-codes',
        body: '{}',
        headers: postHeaders('must-never-run'),
        label: 'Change',
        createdAt,
        attempts: 0,
        status: 'queued',
      },
      {
        id: 'legacy-post',
        userId: 'user-1',
        method: 'POST',
        path: '/v1/orgs/o1/tasks',
        body: '{"title":"Legacy"}',
        headers: { 'Content-Type': 'application/json' },
        label: 'New task',
        createdAt,
        attempts: 0,
        status: 'queued',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1');
    const sent = vi.spyOn(globalThis, 'fetch');

    await drainOutbox();

    expect(sent).not.toHaveBeenCalled();
    expect(outboxSnapshot()).toEqual([]);
    expect(store.get(outboxKeyFor('user-1'))).toHaveLength(2);
  });

  it('blocks a restored queued entry that already spent its attempt budget', async () => {
    store.set(outboxKeyFor('user-1'), [
      {
        id: 'spent',
        userId: 'user-1',
        ...objectCommand('spent'),
        label: 'Object change',
        createdAt: Date.now(),
        attempts: 5,
        status: 'queued',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1');

    expect(outboxSnapshot()[0]).toMatchObject({ id: 'spent', status: 'blocked' });
  });

  it('never retries an expired entry beyond the idempotency retention window', async () => {
    const oldCreatedAt = Date.now() - 3 * 24 * 60 * 60 * 1000;
    store.set(outboxKeyFor('user-1'), [
      {
        id: 'expired',
        userId: 'user-1',
        ...objectCommand('expired'),
        label: 'Object change',
        createdAt: oldCreatedAt,
        attempts: 2,
        status: 'expired',
      },
    ]);
    await setOutboxUser(null);
    await setOutboxUser('user-1');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Still offline'));
    await retryEntry('expired');

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(outboxSnapshot()[0]).toMatchObject({
      status: 'expired',
      attempts: 2,
      createdAt: oldCreatedAt,
      headers: { 'Idempotency-Key': 'expired' },
    });
  });

  it('does not let a mutated in-memory projection replace the durable request line', async () => {
    await enqueueWrite(objectCommand('durable-one'));
    await enqueueWrite(objectCommand('durable-two'));
    const loaded = outboxSnapshot() as unknown as { method: string; path: string }[];
    const [external, read] = loaded;
    if (external === undefined || read === undefined) throw new Error('Expected two queued writes');
    external.path = 'https://outside.test/v1/orgs/o1/tasks/t1';
    read.method = 'GET';
    const sent: { readonly method: string; readonly path: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (typeof input !== 'string') throw new Error('Expected a relative replay path');
      sent.push({ method: init?.method ?? '', path: input });
      return new Response('{}', { status: 200 });
    });

    await drainOutbox();

    expect(sent).toEqual([
      { method: 'POST', path: '/v1/orgs/o1/object-commands' },
      { method: 'POST', path: '/v1/orgs/o1/object-commands' },
    ]);
    expect(outboxSnapshot()).toEqual([]);
  });
});

describe('account generation isolation', () => {
  function storedEntry(userId: string, id: string, title: string) {
    return {
      id,
      userId,
      ...objectCommand(id, { title }, userId),
      label: 'Object change',
      createdAt: Date.now(),
      attempts: 0,
      status: 'queued',
    } as const;
  }

  it('publishes a completed owner binding before its queue read settles', async () => {
    await setOutboxUser(null);
    const stalledRead = deferred<unknown>();
    delayedGets.set(outboxKeyFor('user-1'), stalledRead);
    const observedOwners: ReturnType<typeof captureOutboxOwner>[] = [];
    const unsubscribe = subscribeOutbox(() => {
      observedOwners.push(captureOutboxOwner());
    });

    const loading = setOutboxUser('user-1');
    await vi.waitFor(() => {
      expect(observedOwners).toContainEqual(expect.objectContaining({ userId: 'user-1' }));
    });

    stalledRead.reject(new Error('IndexedDB read failed'));
    await loading;
    unsubscribe();
  });

  it('keeps a replacement account outside a delayed previous-account cleanup', async () => {
    await setOutboxUser('user-a');
    const ownerA = captureOutboxOwner();
    if (ownerA === null) throw new Error('Expected user A to own the outbox');
    const cleanup = deferred<undefined>();
    let replacementRequested!: () => boolean;
    const transition = withOutboxSessionTransition(ownerA, async (invalidateOwner, requested) => {
      replacementRequested = requested;
      expect(replacementRequested()).toBe(false);
      invalidateOwner();
      await cleanup.promise;
      return 'cleared' as const;
    });
    await vi.waitFor(() => {
      expect(captureOutboxOwner()).toBeNull();
    });

    const bindingB = setOutboxUser('user-b');
    const boundB = vi.fn();
    void bindingB.then(boundB);
    await Promise.resolve();

    expect(boundB).not.toHaveBeenCalled();
    expect(replacementRequested()).toBe(true);
    cleanup.resolve(undefined);
    await expect(transition).resolves.toEqual({
      status: 'completed',
      value: 'cleared',
      replacementRequested: true,
    });
    await bindingB;
    expect(captureOutboxOwner()).toMatchObject({ userId: 'user-b' });
  });

  it('does not overwrite unread storage after a rejected load and recovers on reload', async () => {
    await setOutboxUser(null);
    const existing = storedEntry('user-1', 'existing', 'Keep me');
    store.set(outboxKeyFor('user-1'), [existing]);
    const failedRead = deferred<unknown>();
    delayedGets.set(outboxKeyFor('user-1'), failedRead);
    const loading = setOutboxUser('user-1');
    failedRead.reject(new Error('IndexedDB read failed'));
    await loading;
    setCalls.length = 0;

    const queued = await enqueueWrite(objectCommand('unread-store-write', {}, 'user-1'));
    const sent = vi.spyOn(globalThis, 'fetch');
    await drainOutbox();

    expect(queued).toBeNull();
    expect(sent).not.toHaveBeenCalled();
    expect(setCalls).toEqual([]);
    expect(store.get(outboxKeyFor('user-1'))).toEqual([existing]);

    delayedGets.delete(outboxKeyFor('user-1'));
    await setOutboxUser('user-1');
    expect(outboxSnapshot().map((entry) => entry.id)).toEqual(['existing']);
  });

  it('does not replace a malformed top-level store until a later read succeeds', async () => {
    await setOutboxUser(null);
    store.set(outboxKeyFor('user-1'), { unread: 'private queue bytes' });
    await setOutboxUser('user-1');
    setCalls.length = 0;

    const queued = await enqueueWrite(objectCommand('malformed-store-write', {}, 'user-1'));

    expect(queued).toBeNull();
    expect(setCalls).toEqual([]);
    expect(store.get(outboxKeyFor('user-1'))).toEqual({ unread: 'private queue bytes' });

    const recovered = storedEntry('user-1', 'recovered', 'Recovered');
    store.set(outboxKeyFor('user-1'), [recovered]);
    await setOutboxUser('user-1');
    expect(outboxSnapshot().map((entry) => entry.id)).toEqual(['recovered']);
  });

  it('does not overwrite a current-epoch entry whose route became unsupported', async () => {
    await setOutboxUser(null);
    const epoch = 'current-contract-epoch';
    const unsupported = {
      id: 'unsupported-current',
      userId: 'user-1',
      epoch,
      method: 'PATCH',
      path: '/v1/orgs/user-1/tasks/task-1',
      body: '{"title":"Do not lose me"}',
      headers: { 'Content-Type': 'application/json' },
      label: 'Task change',
      createdAt: Date.now(),
      notBeforeAt: null,
      attempts: 0,
      status: 'queued',
    } as const;
    store.set(OUTBOX_EPOCH_KEY, epoch);
    store.set(outboxKeyFor('user-1'), [unsupported]);
    await setOutboxUser('user-1');
    setCalls.length = 0;

    const queued = await enqueueWrite(objectCommand('must-not-overwrite'));
    const sent = vi.spyOn(globalThis, 'fetch');
    await drainOutbox();

    expect(queued).toBeNull();
    expect(sent).not.toHaveBeenCalled();
    expect(setCalls).toEqual([]);
    expect(store.get(outboxKeyFor('user-1'))).toEqual([unsupported]);
  });

  it('clears A immediately and never drains it while B is still loading', async () => {
    const userA = storedEntry('user-a', 'a-1', 'A one');
    store.set(outboxKeyFor('user-a'), [userA]);
    await setOutboxUser('user-a');
    const loadB = deferred<unknown>();
    delayedGets.set(outboxKeyFor('user-b'), loadB);
    const switching = setOutboxUser('user-b');
    const sent: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      sent.push(typeof init?.body === 'string' ? init.body : '');
      return new Response('{}', { status: 200 });
    });

    expect(outboxSnapshot()).toEqual([]);
    const draining = drainOutbox();
    await Promise.resolve();
    expect(sent).toEqual([]);

    loadB.resolve([]);
    await switching;
    await draining;
    expect(sent).toEqual([]);
  });

  it('keeps B active when overlapping B and A loads resolve in the opposite order', async () => {
    await setOutboxUser(null);
    const loadA = deferred<unknown>();
    const loadB = deferred<unknown>();
    delayedGets.set(outboxKeyFor('user-a'), loadA);
    delayedGets.set(outboxKeyFor('user-b'), loadB);

    const loadingA = setOutboxUser('user-a');
    const loadingB = setOutboxUser('user-b');
    loadB.resolve([]);
    await loadingB;
    await enqueueWrite(objectCommand('b-1', { title: 'B one' }, 'user-b'));
    expect(outboxUserId()).toBe('user-b');
    expect(outboxSnapshot().map((entry) => entry.body)).toEqual([
      objectCommand('b-1', { title: 'B one' }, 'user-b').body,
    ]);

    loadA.resolve([storedEntry('user-a', 'a-1', 'A one')]);
    await loadingA;
    expect(outboxUserId()).toBe('user-b');
    expect(outboxSnapshot().map((entry) => entry.body)).toEqual([
      objectCommand('b-1', { title: 'B one' }, 'user-b').body,
    ]);
  });

  it('orders B activation after A replay before draining B', async () => {
    const aOne = objectCommand('a-1', { title: 'A one' }, 'user-a');
    const aTwo = objectCommand('a-2', { title: 'A two' }, 'user-a');
    const bOne = objectCommand('b-1', { title: 'B one' }, 'user-b');
    await setOutboxUser('user-a');
    await enqueueWrite(aOne);
    await enqueueWrite(aTwo);
    const firstA = deferred<Response>();
    const sent: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      sent.push(body);
      return body === aOne.body ? firstA.promise : new Response('{}', { status: 200 });
    });

    const drainingA = drainOutbox();
    await vi.waitFor(() => {
      expect(sent).toEqual([aOne.body]);
    });
    const switchingB = setOutboxUser('user-b');
    const switchedB = vi.fn();
    void switchingB.then(switchedB);
    await Promise.resolve();
    expect(switchedB).not.toHaveBeenCalled();
    firstA.resolve(new Response('{}', { status: 200 }));
    await Promise.all([drainingA, switchingB]);
    await enqueueWrite(bOne);
    const drainingB = drainOutbox();
    await drainingB;
    expect(sent).toEqual([aOne.body, bOne.body]);
    expect(outboxSnapshot()).toEqual([]);
    expect(await readOutbox('user-b', Date.now())).toEqual([]);
    expect(await readOutbox('user-a', Date.now())).toEqual([]);
  });

  it('reports a committed A enqueue before B takes ownership without relying on rollback', async () => {
    await setOutboxUser('user-a');
    const writeA = deferred<undefined>();
    delayedSets.set(outboxKeyFor('user-a'), [writeA]);
    failedSetNumbers.set(outboxKeyFor('user-a'), new Set([2]));
    const command = objectCommand('enqueue-a-one', { title: 'A one' }, 'user-a');
    const enqueuingA = enqueueWrite(command);
    await vi.waitFor(() => {
      expect(setCalls.some((call) => call.key === outboxKeyFor('user-a'))).toBe(true);
    });
    expect(outboxSnapshot()).toEqual([]);

    const loadB = deferred<unknown>();
    delayedGets.set(outboxKeyFor('user-b'), loadB);
    const switching = setOutboxUser('user-b');
    const switched = vi.fn();
    void switching.then(switched);
    await Promise.resolve();
    expect(switched).not.toHaveBeenCalled();
    writeA.resolve(undefined);

    await expect(enqueuingA).resolves.toMatchObject({ body: command.body });
    expect(outboxSnapshot()).toEqual([]);
    loadB.resolve([]);
    await switching;
    const commandB = objectCommand('b-1', { title: 'B one' }, 'user-b');
    await enqueueWrite(commandB);
    expect(outboxSnapshot().map((entry) => entry.body)).toEqual([commandB.body]);
    expect(await readOutbox('user-a', Date.now())).toEqual([]);
    expect(setCalls.filter((call) => call.key === outboxKeyFor('user-a'))).toHaveLength(1);
  });

  it('reports a durable enqueue when explicit invalidation makes rollback fail', async () => {
    await setOutboxUser('user-a');
    const writeA = deferred<undefined>();
    delayedSets.set(outboxKeyFor('user-a'), [writeA]);
    failedSetNumbers.set(outboxKeyFor('user-a'), new Set([2]));
    const command = objectCommand('rollback-failed-a', { title: 'A one' }, 'user-a');
    const enqueuing = enqueueWrite(command);
    await vi.waitFor(() => {
      expect(setCalls.filter((call) => call.key === outboxKeyFor('user-a'))).toHaveLength(1);
    });

    clearOutboxOwnerForSignOut();
    writeA.resolve(undefined);

    await expect(enqueuing).resolves.toMatchObject({ body: command.body });
    expect((await readOutbox('user-a', Date.now())).map((entry) => entry.body)).toEqual([
      command.body,
    ]);
    expect(setCalls.filter((call) => call.key === outboxKeyFor('user-a'))).toHaveLength(2);

    await purgeAllOutboxes();
    expect(await readOutbox('user-a', Date.now())).toEqual([]);
  });

  it('does not expose failed A through a concurrent B snapshot or abrupt read', async () => {
    const firstSet = deferred<undefined>();
    const secondSet = deferred<undefined>();
    const rollbackSet = deferred<undefined>();
    delayedSets.set(outboxKeyFor('user-1'), [firstSet, secondSet, rollbackSet]);
    const commandA = objectCommand('concurrent-failed-a', { title: 'A' }, 'user-1');
    const commandB = objectCommand('concurrent-valid-b', { title: 'B' }, 'user-1');
    const first = enqueueWrite(commandA);
    await vi.waitFor(() => {
      expect(setCalls).toHaveLength(1);
    });
    const second = enqueueWrite(commandB);
    await Promise.resolve();
    const observed = readOutbox('user-1', Date.now());

    firstSet.reject(new Error('IndexedDB refused A'));
    secondSet.resolve(undefined);
    const abruptRead = await observed;
    rollbackSet.resolve(undefined);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBeNull();
    expect(secondResult).toMatchObject({ body: commandB.body });
    expect(abruptRead.map((entry) => entry.body)).toEqual([commandB.body]);
    expect((await readOutbox('user-1', Date.now())).map((entry) => entry.body)).toEqual([
      commandB.body,
    ]);
  });

  it('reports only the A transition that became durable before B takes ownership', async () => {
    await setOutboxUser('user-a');
    const firstSet = deferred<undefined>();
    const secondSet = deferred<undefined>();
    delayedSets.set(outboxKeyFor('user-a'), [firstSet, secondSet]);
    const commandA = objectCommand('switched-a-one', { title: 'A' }, 'user-a');
    const commandB = objectCommand('switched-a-two', { title: 'B' }, 'user-a');
    const first = enqueueWrite(commandA);
    await vi.waitFor(() => {
      expect(setCalls.some((call) => call.key === outboxKeyFor('user-a'))).toBe(true);
    });
    const second = enqueueWrite(commandB);
    await Promise.resolve();
    const observed = readOutbox('user-a', Date.now());

    const switching = setOutboxUser('user-b');
    firstSet.reject(new Error('IndexedDB refused A'));
    await vi.waitFor(() => {
      expect(setCalls.filter((call) => call.key === outboxKeyFor('user-a'))).toHaveLength(2);
    });
    secondSet.resolve(undefined);
    const [firstResult, secondResult, abruptRead] = await Promise.all([
      first,
      second,
      observed,
      switching,
    ]);

    expect(firstResult).toBeNull();
    expect(secondResult).toMatchObject({ body: commandB.body });
    expect(abruptRead.map((entry) => entry.body)).toEqual([commandB.body]);
    expect(await readOutbox('user-a', Date.now())).toEqual([]);
  });

  it('serializes concurrent durable writes from the same user', async () => {
    const firstSet = deferred<undefined>();
    const secondSet = deferred<undefined>();
    delayedSets.set(outboxKeyFor('user-1'), [firstSet, secondSet]);
    const commandA = objectCommand('serialized-a', { title: 'A' }, 'user-1');
    const commandB = objectCommand('serialized-b', { title: 'B' }, 'user-1');
    const first = enqueueWrite(commandA);
    await vi.waitFor(() => {
      expect(setCalls).toHaveLength(1);
    });
    const second = enqueueWrite(commandB);

    secondSet.resolve(undefined);
    await Promise.resolve();
    firstSet.resolve(undefined);
    await Promise.all([first, second]);

    expect(setCalls).toHaveLength(2);
    expect((await readOutbox('user-1', Date.now())).map((entry) => entry.body)).toEqual([
      commandA.body,
      commandB.body,
    ]);
  });

  it('waits for a started A enqueue before rotating away and back to A', async () => {
    await setOutboxUser('user-a');
    const firstASet = deferred<undefined>();
    delayedSets.set(outboxKeyFor('user-a'), [firstASet]);
    const aOne = objectCommand('return-a-one', { title: 'A one' }, 'user-a');
    const bOne = objectCommand('return-b-one', { title: 'B one' }, 'user-b');
    const aTwo = objectCommand('return-a-two', { title: 'A two' }, 'user-a');
    const firstA = enqueueWrite(aOne);
    await vi.waitFor(() => {
      expect(setCalls.some((call) => call.key === outboxKeyFor('user-a'))).toBe(true);
    });

    const switchingToB = setOutboxUser('user-b');
    const switchedToB = vi.fn();
    void switchingToB.then(switchedToB);
    await Promise.resolve();
    expect(switchedToB).not.toHaveBeenCalled();
    firstASet.resolve(undefined);
    await Promise.all([firstA, switchingToB]);
    await enqueueWrite(bOne);
    const returningToA = setOutboxUser('user-a');
    await returningToA;

    expect(outboxSnapshot()).toEqual([]);
    await enqueueWrite(aTwo);
    expect((await readOutbox('user-a', Date.now())).map((entry) => entry.body)).toEqual([
      aTwo.body,
    ]);
    expect(await readOutbox('user-b', Date.now())).toEqual([]);
  });

  it('purges after an already-started durable write settles', async () => {
    await setOutboxUser('user-a');
    const delayedSet = deferred<undefined>();
    delayedSets.set(outboxKeyFor('user-a'), [delayedSet]);
    const enqueuing = enqueueWrite(objectCommand('private-a', { title: 'Private' }, 'user-a'));
    await vi.waitFor(() => {
      expect(setCalls.some((call) => call.key === outboxKeyFor('user-a'))).toBe(true);
    });

    const purging = purgeAllOutboxes();
    delayedSet.resolve(undefined);
    await Promise.all([enqueuing, purging]);
    clearOutboxOwnerForSignOut();

    expect(store.has(outboxKeyFor('user-a'))).toBe(false);
    expect(await readOutbox('user-a', Date.now())).toEqual([]);
  });

  it('delivers replay callbacks only to the account whose locked replay completed', async () => {
    await setOutboxUser('user-a');
    const firstA = deferred<Response>();
    const aCommand = objectCommand('callback-a', { title: 'A one' }, 'user-a');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) =>
      init?.body === aCommand.body ? firstA.promise : new Response('{}', { status: 200 }),
    );
    const syncedA = vi.fn();
    const syncedB = vi.fn();
    const stopA = startOutboxDrain(syncedA);
    await Promise.resolve();
    await enqueueWrite(aCommand);
    const drainingA = drainOutbox();
    await vi.waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });

    const switchingB = setOutboxUser('user-b');
    const switchedB = vi.fn();
    void switchingB.then(switchedB);
    await Promise.resolve();
    expect(switchedB).not.toHaveBeenCalled();
    firstA.resolve(new Response('{}', { status: 200 }));
    await Promise.all([drainingA, switchingB]);
    expect(syncedA).not.toHaveBeenCalled();
    stopA();
    const stopB = startOutboxDrain(syncedB);
    await enqueueWrite(objectCommand('b-1', { title: 'B one' }, 'user-b'));
    await drainOutbox();
    await vi.waitFor(() => {
      expect(outboxSnapshot()).toEqual([]);
    });

    expect(syncedA).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(syncedB).toHaveBeenCalledOnce();
    });
    stopB();
  });
});
