import type * as DbModule from '@docket/db';
import type meAthenaRoute from '../../src/routes/me-athena';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AsyncRunnerModule from '../../src/agent/async-runner';

const runnerMocks = vi.hoisted(() => ({
  admit: vi.fn(),
  wake: vi.fn(),
}));

vi.mock('../../src/agent/async-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof AsyncRunnerModule>();
  return {
    ...actual,
    asynchronousRunnerEnabled: () => true,
    admitAthenaGeneration: runnerMocks.admit,
    wakeWaitingAthenaGeneration: runnerMocks.wake,
  };
});

import type { AppEnv } from '../../src/context';
import { enqueueRunGeneration } from '../../src/agent/run-generation';
import { onError } from '../../src/error';
import { fakeSession, getDb } from '../support/routes-harness';

let schema: typeof DbModule;
let meAthena: typeof meAthenaRoute;
let actualWake: typeof AsyncRunnerModule.wakeWaitingAthenaGeneration;

const runnerConfig = {
  APP_MODE: 'production' as const,
  ATHENA_ASYNC_RUNNER_ENABLED: true,
  CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example',
  DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret-long-enough',
};

function failImmediateWakeDelivery(): void {
  runnerMocks.wake.mockImplementation((sessionId) =>
    actualWake(sessionId, {
      config: runnerConfig,
      fetch: vi.fn().mockRejectedValue(new Error('Worker fetch crashed')),
    }),
  );
}

beforeAll(async () => {
  schema = await getDb();
  meAthena = (await import('../../src/routes/me-athena')).default;
  actualWake = (await vi.importActual<typeof AsyncRunnerModule>('../../src/agent/async-runner'))
    .wakeWaitingAthenaGeneration;
});

beforeEach(() => {
  runnerMocks.admit.mockReset();
  runnerMocks.wake.mockReset();
});

function appFor(ownerUserId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(ownerUserId));
    await next();
  });
  app.route('/', meAthena);
  app.onError(onError);
  return app;
}

describe('personal Athena asynchronous acknowledgement', () => {
  it('returns 202 after persisting work and handing off the opaque generation', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Async Owner', email: `async-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    runnerMocks.admit.mockImplementation(async (session, options) => ({
      mode: 'async',
      queued: await enqueueRunGeneration(session, options),
    }));
    const app = appFor(owner!.id);

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Prepare the launch plan.' }),
    });

    expect(response.status).toBe(202);
    expect(runnerMocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({ executorKind: 'athena', ownerUserId: owner!.id }),
      { runnableStatuses: ['pending'] },
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 'running',
      objective: 'Prepare the launch plan.',
    });
    const [queued] = await schema.db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.ownerUserId, owner!.id));
    expect(queued?.status).toBe('queued');
  });

  it('atomically parks or cancels a queued generation immediately after acceptance', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Lifecycle Owner', email: `lifecycle-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    runnerMocks.admit.mockImplementation(async (session, options) => ({
      mode: 'async',
      queued: await enqueueRunGeneration(session, options),
    }));
    const app = appFor(owner!.id);
    const create = async (prompt: string) => {
      const response = await app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      return (await response.json()) as { id: string };
    };

    const pausedSession = await create('Pause this safely.');
    expect(
      (await app.request(`/sessions/${pausedSession.id}/pause`, { method: 'POST' })).status,
    ).toBe(200);
    const [pausedRun] = await schema.db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, pausedSession.id));
    expect(pausedRun?.status).toBe('waiting');

    const canceledSession = await create('Cancel this safely.');
    expect(
      (await app.request(`/sessions/${canceledSession.id}/cancel`, { method: 'POST' })).status,
    ).toBe(200);
    const [canceledRun] = await schema.db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, canceledSession.id));
    expect(canceledRun?.status).toBe('canceled');
  });

  it('commits a reply and wake intent before a failed Worker fetch returns', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Wake Owner', email: `wake-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const [session] = await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: owner!.id,
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: session!.id,
      ownerUserId: owner!.id,
      generation: 1,
      workflowInstanceId: `${session!.id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    const [elicitation] = await schema.db
      .insert(schema.sessionActivity)
      .values({
        sessionId: session!.id,
        organizationId: null,
        type: 'elicitation',
        body: { text: 'Which item?', toolUseId: 'toolu_crash_window' },
      })
      .returning({ id: schema.sessionActivity.id });
    failImmediateWakeDelivery();

    const response = await appFor(owner!.id).request(
      `/sessions/${session!.id}/activity/${elicitation!.id}/reply`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'This item' }),
      },
    );

    expect(response.status).toBe(202);
    const replies = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, session!.id));
    expect(replies.some(({ body }) => body.text === 'This item')).toBe(true);
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, session!.id));
    expect(intent?.agent_session_dispatch).toMatchObject({
      action: 'wake',
      status: 'pending',
      attempt: 1,
    });
  });

  it('commits an awaiting-input chat message, transcript, and wake intent before delivery', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Chat Wake Owner', email: `chat-wake-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const [session] = await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: owner!.id,
        kind: 'chat',
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: session!.id,
      ownerUserId: owner!.id,
      generation: 1,
      workflowInstanceId: `${session!.id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    failImmediateWakeDelivery();

    const response = await appFor(owner!.id).request('/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Continue with this answer' }),
    });

    expect(response.status).toBe(202);
    const [activity] = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, session!.id));
    const [transcript] = await schema.db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, session!.id));
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, session!.id));
    expect(activity?.body.text).toBe('Continue with this answer');
    expect(transcript?.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(intent?.agent_session_dispatch).toMatchObject({
      action: 'wake',
      status: 'pending',
      attempt: 1,
    });
  });

  it('persists a resume wake intent before attempting delivery', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Resume Wake Owner', email: `resume-wake-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const [session] = await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: owner!.id,
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: session!.id,
      ownerUserId: owner!.id,
      generation: 1,
      workflowInstanceId: `${session!.id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    failImmediateWakeDelivery();

    const response = await appFor(owner!.id).request(`/sessions/${session!.id}/resume`, {
      method: 'POST',
    });

    expect(response.status).toBe(202);
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, session!.id));
    expect(intent?.agent_session_dispatch).toMatchObject({
      action: 'wake',
      status: 'pending',
      attempt: 1,
    });
  });

  it('commits cancellation and its wake intent before attempting delivery', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Cancel Wake Owner', email: `cancel-wake-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const [session] = await schema.db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: owner!.id,
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: session!.id,
      ownerUserId: owner!.id,
      generation: 1,
      workflowInstanceId: `${session!.id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    failImmediateWakeDelivery();

    const response = await appFor(owner!.id).request(`/sessions/${session!.id}/cancel`, {
      method: 'POST',
    });

    expect(response.status).toBe(202);
    const [current] = await schema.db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, session!.id));
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, session!.id));
    expect(current?.status).toBe('canceled');
    expect(intent?.agent_session_dispatch).toMatchObject({
      action: 'wake',
      status: 'pending',
      attempt: 1,
    });
  });
});
