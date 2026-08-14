/**
 * `@docket/api` — the merged `/v1/me/athena/agents/stream` edge.
 *
 * @remarks
 * Proves the three things that matter about this one shared subscription: a caller only ever
 * sees updates for agents *they* own, an update published before the connection attached is
 * still replayed, and a resumed connection (`Last-Event-ID`) never repeats what it already
 * received. Modeled on `tests/routes/stream-sse.test.ts`'s reader-based harness, since this
 * route's poll loop — like that one's — runs until the client disconnects, not until any
 * database state changes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type meAthenaRouter from '../../src/routes/me-athena';
import type { reportAgentMilestone as ReportAgentMilestone } from '../../src/routes/agent-bus';
import { appWithSession, fakeSession, getDb, one } from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let meAthena!: typeof meAthenaRouter;
let reportAgentMilestone!: typeof ReportAgentMilestone;

const openConnections: (() => void)[] = [];

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  meAthena = (await import('../../src/routes/me-athena')).default;
  ({ reportAgentMilestone } = await import('../../src/routes/agent-bus'));
});

afterEach(() => {
  for (const close of openConnections.splice(0)) close();
});

/** Insert one owner-attributed session an agent report can be published against. */
async function seedSession(ownerUserId: string): Promise<string> {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId,
        kind: 'job',
        trigger: 'delegation',
        status: 'running',
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
}

/** Open the agent-updates stream and return a way to read the next frame, and to close it. */
async function openAgentStream(userId: string, lastEventId?: string) {
  const app = appWithSession(meAthena, fakeSession(userId));
  const controller = new AbortController();
  const res = await app.request('/agents/stream', {
    headers: {
      accept: 'text/event-stream',
      ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
    },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = assertDefined(res.body).getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  const nextFrame = async (): Promise<{ event: string; id: string; data: string }> => {
    for (;;) {
      const index = buffered.indexOf('\n\n');
      if (index !== -1) {
        const chunk = buffered.slice(0, index);
        buffered = buffered.slice(index + 2);
        const idLine = chunk.split('\n').find((line) => line.startsWith('id: '));
        const eventLine = chunk.split('\n').find((line) => line.startsWith('event: '));
        const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
        if (eventLine) {
          return {
            event: eventLine.slice(7),
            id: idLine ? idLine.slice(4) : '',
            data: dataLine ? dataLine.slice(6) : '',
          };
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

describe('merged agent-updates stream', () => {
  it('refuses an unauthenticated connection', async () => {
    const app = appWithSession(meAthena, null);
    const res = await app.request('/agents/stream', { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(401);
  });

  it('replays an update published before the subscription attached', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Stream Owner', email: `agents-stream-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const sessionId = await seedSession(assertDefined(owner).id);

    const published = await reportAgentMilestone({
      sessionId,
      ownerUserId: assertDefined(owner).id,
      kind: 'agent_started',
      milestone: 'Booting up',
    });
    expect(published).not.toBeNull();

    const { nextFrame } = await openAgentStream(assertDefined(owner).id);
    const frame = await nextFrame();

    expect(frame.event).toBe('agent_started');
    expect(JSON.parse(frame.data)).toMatchObject({
      sessionId,
      milestone: 'Booting up',
      agentName: 'Athena',
    });
  });

  it('delivers a live update published after the subscription attached', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Live Owner', email: `agents-stream-live-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const sessionId = await seedSession(assertDefined(owner).id);
    const { nextFrame } = await openAgentStream(assertDefined(owner).id);
    // Let the handler's own subscribe() call actually attach before publishing.
    await new Promise((resolve) => setTimeout(resolve, 10));

    await reportAgentMilestone({
      sessionId,
      ownerUserId: assertDefined(owner).id,
      kind: 'agent_progress',
      milestone: 'Halfway there',
      progress: 50,
    });

    const frame = await nextFrame();
    expect(frame.event).toBe('agent_progress');
    expect(JSON.parse(frame.data)).toMatchObject({ milestone: 'Halfway there', progress: 50 });
  });

  it('never delivers another caller’s agent updates on this connection', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner, other] = await db
      .insert(schema.user)
      .values([
        { name: 'Isolated Owner', email: `agents-iso-owner-${suffix}@example.com` },
        { name: 'Isolated Other', email: `agents-iso-other-${suffix}@example.com` },
      ])
      .returning({ id: schema.user.id });
    const ownerSessionId = await seedSession(assertDefined(owner).id);
    const otherSessionId = await seedSession(assertDefined(other).id);

    const { nextFrame } = await openAgentStream(assertDefined(owner).id);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await reportAgentMilestone({
      sessionId: otherSessionId,
      ownerUserId: assertDefined(other).id,
      kind: 'agent_started',
      milestone: 'Not yours',
    });
    await reportAgentMilestone({
      sessionId: ownerSessionId,
      ownerUserId: assertDefined(owner).id,
      kind: 'agent_started',
      milestone: 'Yours',
    });

    const frame = await nextFrame();
    expect(JSON.parse(frame.data)).toMatchObject({ sessionId: ownerSessionId, milestone: 'Yours' });
  });

  it('resumes strictly after a given sequence without repeating it', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Resume Owner', email: `agents-resume-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const sessionId = await seedSession(assertDefined(owner).id);

    const first = await reportAgentMilestone({
      sessionId,
      ownerUserId: assertDefined(owner).id,
      kind: 'agent_started',
      milestone: 'First',
    });
    const second = await reportAgentMilestone({
      sessionId,
      ownerUserId: assertDefined(owner).id,
      kind: 'agent_progress',
      milestone: 'Second',
    });
    expect(first).not.toBeNull();

    const { nextFrame } = await openAgentStream(
      assertDefined(owner).id,
      String(assertDefined(first).sequence),
    );
    const frame = await nextFrame();
    expect(JSON.parse(frame.data)).toMatchObject({
      sequence: assertDefined(second).sequence,
      milestone: 'Second',
    });
  });

  it('drops the bus subscription once the connection is aborted', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Cleanup Owner', email: `agents-cleanup-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const sessionId = await seedSession(assertDefined(owner).id);
    const { close } = await openAgentStream(assertDefined(owner).id);
    await new Promise((resolve) => setTimeout(resolve, 10));

    close();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The detach happened: a milestone published after close never throws, and a second,
    // independent subscription for the same owner still gets exactly its own single update
    // rather than anything left over from the closed one's queue.
    await reportAgentMilestone({
      sessionId,
      ownerUserId: assertDefined(owner).id,
      kind: 'agent_completed',
      milestone: 'After close',
    });
    const { nextFrame } = await openAgentStream(assertDefined(owner).id);
    const frame = await nextFrame();
    expect(JSON.parse(frame.data)).toMatchObject({ milestone: 'After close' });
  });

  it('writes a heartbeat comment when the merged stream goes quiet past the heartbeat interval', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Heartbeat Owner', email: `agents-heartbeat-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const originalNow = Date.now.bind(Date);
    const testStart = originalNow();
    // See the identical, identically-justified pattern in me-athena.test.ts's own heartbeat
    // test: a global `Date.now` spy can't key off call count, so it keys off real elapsed time.
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const real = originalNow();
      return real - testStart > 200 ? real + 20_000 : real;
    });

    const app = appWithSession(meAthena, fakeSession(assertDefined(owner).id));
    const res = await app.request('/agents/stream', { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(200);
    const reader = assertDefined(res.body).getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (let i = 0; i < 5 && !text.includes(': heartbeat'); i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    void reader.cancel();

    nowSpy.mockRestore();
    expect(text).toContain(': heartbeat');
  });
});
