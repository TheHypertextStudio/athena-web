/**
 * `@docket/api` — the live `/v1/stream/sse` edge.
 *
 * @remarks
 * Proves the two things that matter about a long-lived connection: an unauthenticated caller
 * cannot open one, and an event published for the connected user actually arrives as a
 * `stream-event` frame with the exact JSON the emit path handed to `publish`. Cleanup is asserted
 * too — aborting the request must drop the bus subscription, or every reconnect leaks a listener.
 */
import type { StreamEvent } from '../../src/lib/event-bus';
import { listenerCount, publish } from '../../src/lib/event-bus';
import { appWithSession, fakeSession } from '../support/routes-harness';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

let streamSse!: unknown;

const openConnections: (() => void)[] = [];

async function loadRouter() {
  streamSse ??= (await import('../../src/routes/stream-sse')).default;
  return streamSse;
}

afterEach(() => {
  for (const close of openConnections.splice(0)) close();
});

/** Open the SSE connection and return a way to read the next frame, and to close it. */
async function openStream(userId: string) {
  const router = await loadRouter();
  const app = appWithSession(router, fakeSession(userId));
  const controller = new AbortController();
  const res = await app.request('/sse', {
    headers: { accept: 'text/event-stream' },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = assertDefined(res.body).getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  const nextFrame = async (): Promise<{ event: string; data: string }> => {
    for (;;) {
      const index = buffered.indexOf('\n\n');
      if (index !== -1) {
        const chunk = buffered.slice(0, index);
        buffered = buffered.slice(index + 2);
        const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '));
        const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
        if (eventLine) {
          return { event: eventLine.slice(7), data: dataLine ? dataLine.slice(6) : '' };
        }
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream closed before a frame arrived');
      buffered += decoder.decode(value, { stream: true });
    }
  };

  const close = (): void => {
    void reader.cancel();
    controller.abort();
  };
  openConnections.push(close);
  return { nextFrame, close };
}

const SAMPLE_EVENT: StreamEvent = {
  id: 'evt_01',
  organizationId: 'org_01',
  kind: 'created',
  occurredAt: '2026-08-02T12:00:00.000Z',
  title: 'Task created',
  summary: null,
  permalink: null,
  source: { system: 'docket', integrationId: null, externalUrl: null },
  actor: null,
  entity: null,
  participants: [],
  detail: null,
  createdAt: '2026-08-02T12:00:00.000Z',
  actorIsViewer: false,
  relevance: null,
  rendering: { icon: 'task', category: 'progress' },
};

describe('live stream SSE', () => {
  it('refuses an unauthenticated connection', async () => {
    const router = await loadRouter();
    const app = appWithSession(router, null);
    const res = await app.request('/sse', { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(401);
  });

  it('forwards a published event as a stream-event frame with the exact payload', async () => {
    const userId = `sse-user-${Math.random().toString(36).slice(2)}`;
    const { nextFrame } = await openStream(userId);

    publish(userId, SAMPLE_EVENT);

    const frame = await nextFrame();
    expect(frame.event).toBe('stream-event');
    expect(JSON.parse(frame.data)).toEqual(SAMPLE_EVENT);
  });

  it('never delivers another user’s events on this connection', async () => {
    const userId = `sse-user-${Math.random().toString(36).slice(2)}`;
    const otherUserId = `sse-other-${Math.random().toString(36).slice(2)}`;
    const { nextFrame } = await openStream(userId);

    publish(otherUserId, SAMPLE_EVENT);
    publish(userId, { ...SAMPLE_EVENT, id: 'evt_02', title: 'Mine' });

    const frame = await nextFrame();
    expect(JSON.parse(frame.data)).toMatchObject({ id: 'evt_02', title: 'Mine' });
  });

  it('drops the bus subscription once the connection is aborted', async () => {
    const userId = `sse-user-${Math.random().toString(36).slice(2)}`;
    const { close } = await openStream(userId);
    // Let the handler's subscribe() call actually run before asserting on it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listenerCount(userId)).toBeGreaterThan(0);

    close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listenerCount(userId)).toBe(0);
  });

  it('batches multiple events published before the writer catches up', async () => {
    const userId = `sse-user-${Math.random().toString(36).slice(2)}`;
    const { nextFrame } = await openStream(userId);

    publish(userId, { ...SAMPLE_EVENT, id: 'evt_a' });
    publish(userId, { ...SAMPLE_EVENT, id: 'evt_b' });

    const first = await nextFrame();
    const second = await nextFrame();
    expect([JSON.parse(first.data).id, JSON.parse(second.data).id]).toEqual(['evt_a', 'evt_b']);
  });
});
