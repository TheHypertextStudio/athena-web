import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(store.get(key)),
  set: (key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  },
  del: (key: string) => {
    store.delete(key);
    return Promise.resolve();
  },
  keys: () => Promise.resolve([...store.keys()]),
}));

const { QueuedOfflineWriteError, queuedOfflineWrite, withOfflineOutbox } =
  await import('@/components/pwa/offline-write');
const { drainOutbox, outboxSnapshot, setOutboxUser } = await import('@/components/pwa/outbox');
const { readOutbox } = await import('@/components/pwa/outbox-store');

/** The queue refuses to store anything in an environment with no IndexedDB. */
beforeEach(async () => {
  Object.defineProperty(window, 'indexedDB', { value: {}, configurable: true });
  store.clear();
  await setOutboxUser(null);
  await setOutboxUser('user-1');
});

afterEach(async () => {
  await setOutboxUser(null);
  vi.restoreAllMocks();
});

/** A `fetch` that always rejects, standing in for a device with no connection. */
const offlineFetch = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));

describe('withOfflineOutbox', () => {
  it('queues an undeliverable API write and says so in the app’s own words', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);

    const caught = await wrapped('/v1/orgs/o1/tasks/t1', {
      method: 'PATCH',
      body: '{"title":"Renamed"}',
      headers: { 'Content-Type': 'application/json' },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(QueuedOfflineWriteError);
    expect((caught as Error).message).toBe(
      "Saved on this device. Docket will sync it as soon as you're back online.",
    );
    expect(outboxSnapshot()).toHaveLength(1);
    expect(outboxSnapshot()[0]).toMatchObject({
      method: 'PATCH',
      path: '/v1/orgs/o1/tasks/t1',
      label: 'Task change',
      status: 'queued',
    });
  });

  it('survives a reload — the entry is read back from storage by a fresh queue', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    await wrapped('/v1/orgs/o1/tasks', { method: 'POST', body: '{"title":"New"}' }).catch(
      () => undefined,
    );

    // Simulate a new tab: nothing in memory, everything from IndexedDB.
    const restored = await readOutbox('user-1', Date.now());
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ label: 'New task', status: 'queued' });
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

  it('never masks a server error as an offline one', async () => {
    // The server answered. Whatever it said is the caller's business, not the queue's.
    const serverError = new Response('{}', { status: 500 });
    const wrapped = withOfflineOutbox(() => Promise.resolve(serverError));
    const response = await wrapped('/v1/orgs/o1/tasks', { method: 'POST', body: '{}' });
    expect(response.status).toBe(500);
    expect(outboxSnapshot()).toHaveLength(0);
  });

  it('queues the body when the client puts it on a Request instead of in init', async () => {
    // Hono's client does exactly this. Reading the body only from `init` produced entries with no
    // body: they replayed, the server answered 200, and the change was silently lost.
    const wrapped = withOfflineOutbox(offlineFetch);
    const request = new Request('https://docket.test/v1/orgs/o1/tasks/t1', {
      method: 'PATCH',
      body: '{"title":"From a Request"}',
      headers: { 'Content-Type': 'application/json' },
    });
    await wrapped(request).catch(() => undefined);

    expect(outboxSnapshot()[0]).toMatchObject({
      method: 'PATCH',
      body: '{"title":"From a Request"}',
      contentType: 'application/json',
    });
  });

  it('refuses a body it could not replay faithfully', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    const form = new FormData();
    form.set('a', 'b');
    const caught = await wrapped('/v1/orgs/o1/tasks', { method: 'POST', body: form }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(TypeError);
    expect(outboxSnapshot()).toHaveLength(0);
  });

  it('fails honestly when no account owns the queue', async () => {
    await setOutboxUser(null);
    const wrapped = withOfflineOutbox(offlineFetch);
    const caught = await wrapped('/v1/orgs/o1/tasks', { method: 'POST', body: '{}' }).then(
      () => null,
      (error: unknown) => error,
    );
    // Nothing took responsibility, so nothing may claim it will sync.
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).not.toBeInstanceOf(QueuedOfflineWriteError);
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
      await wrapped('/v1/orgs/o1/tasks', {
        method: 'POST',
        body: JSON.stringify({ title }),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => undefined);
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

    expect(sent).toEqual(['{"title":"a"}', '{"title":"b"}', '{"title":"c"}']);
    expect(outboxSnapshot()).toHaveLength(0);
    expect(await readOutbox('user-1', Date.now())).toHaveLength(0);
  });

  it('sends the original method, body and content type', async () => {
    const wrapped = withOfflineOutbox(offlineFetch);
    await wrapped('/v1/orgs/o1/tasks/t1', {
      method: 'PATCH',
      body: '{"dueDate":"2026-08-09"}',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => undefined);

    let seen: RequestInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(((_url: string, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch);
    await drainOutbox();

    expect(seen?.method).toBe('PATCH');
    expect(seen?.body).toBe('{"dueDate":"2026-08-09"}');
    expect(seen?.credentials).toBe('include');
    expect((seen?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('stops at the first entry the network could not answer, saving the rest’s attempts', async () => {
    await queueThree();
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    await drainOutbox();

    expect(calls).toBe(1);
    const queue = outboxSnapshot();
    expect(queue.map((entry) => entry.attempts)).toEqual([1, 0, 0]);
    expect(queue.every((entry) => entry.status === 'queued')).toBe(true);
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
});
