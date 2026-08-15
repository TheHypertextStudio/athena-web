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
import { assertDefined } from '@docket/test-utils';

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

/**
 * Seed just enough for an approval decision to authorize: an owner-side workspace with the
 * caller's own active human actor in it. {@link authorizeApprovalTarget} needs no capability
 * grant for an `athena` session — only that the actor exists, active, in the proposal's
 * workspace.
 */
async function seedApprovalWorkspace(ownerUserId: string): Promise<{ readonly orgId: string }> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const [org] = await schema.db
    .insert(schema.organization)
    .values({ name: `Approve-${suffix}`, slug: `approve-${suffix}`, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  await schema.db.insert(schema.actor).values({
    organizationId: assertDefined(org).id,
    kind: 'human',
    displayName: 'Owner',
    userId: ownerUserId,
  });
  return { orgId: assertDefined(org).id };
}

/** Seed the caller's Personal workspace required by a context-free Athena creation. */
async function seedPersonalWorkspace(ownerUserId: string): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const [org] = await schema.db
    .insert(schema.organization)
    .values({
      name: `Personal-${suffix}`,
      slug: `personal-${suffix}`,
      isPersonal: true,
      lifecycleState: 'active',
    })
    .returning({ id: schema.organization.id });
  await schema.db.insert(schema.actor).values({
    organizationId: assertDefined(org).id,
    kind: 'human',
    displayName: 'Owner',
    userId: ownerUserId,
  });
}

/**
 * Insert one caller-owned Athena session with a durable `waiting` generation — the precondition
 * {@link persistWaitingAthenaWake} enforces before it will queue a wake dispatch.
 */
async function seedOwnedSession(
  ownerUserId: string,
  status: 'awaiting_approval' | 'awaiting_input' | 'pending' | 'running',
  contextOrganizationId?: string,
): Promise<string> {
  const [session] = await schema.db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      trigger: 'delegation',
      status,
      ...(contextOrganizationId ? { contextOrganizationId } : {}),
    })
    .returning({ id: schema.agentSession.id });
  await schema.db.insert(schema.agentSessionRun).values({
    sessionId: assertDefined(session).id,
    ownerUserId,
    generation: 1,
    workflowInstanceId: `${assertDefined(session).id}:1`,
    status: 'waiting',
    attempt: 1,
  });
  return assertDefined(session).id;
}

/** Append one still-pending proposed action to a session. */
async function seedProposedAction(
  sessionId: string,
  orgId: string,
  summary: string,
  proposalGroupId?: string,
): Promise<string> {
  const [activity] = await schema.db
    .insert(schema.sessionActivity)
    .values({
      sessionId,
      organizationId: orgId,
      type: 'action',
      approvalStatus: 'proposed',
      ...(proposalGroupId ? { proposalGroupId } : {}),
      body: { action: { kind: 'capture', summary } },
    })
    .returning({ id: schema.sessionActivity.id });
  return assertDefined(activity).id;
}

describe('personal Athena asynchronous acknowledgement', () => {
  it('returns 202 after persisting work and handing off the opaque generation', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Async Owner', email: `async-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    await seedPersonalWorkspace(assertDefined(owner).id);
    runnerMocks.admit.mockImplementation(async (session, options) => ({
      mode: 'async',
      queued: await enqueueRunGeneration(session, options),
    }));
    const app = appFor(assertDefined(owner).id);

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Prepare the launch plan.' }),
    });

    expect(response.status).toBe(202);
    expect(runnerMocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({ executorKind: 'athena', ownerUserId: assertDefined(owner).id }),
      { runnableStatuses: ['pending'] },
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 'running',
      objective: 'Prepare the launch plan.',
    });
    const [queued] = await schema.db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.ownerUserId, assertDefined(owner).id));
    expect(queued?.status).toBe('queued');
  });

  it('atomically parks or cancels a queued generation immediately after acceptance', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Lifecycle Owner', email: `lifecycle-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    await seedPersonalWorkspace(assertDefined(owner).id);
    runnerMocks.admit.mockImplementation(async (session, options) => ({
      mode: 'async',
      queued: await enqueueRunGeneration(session, options),
    }));
    const app = appFor(assertDefined(owner).id);
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
        ownerUserId: assertDefined(owner).id,
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: assertDefined(session).id,
      ownerUserId: assertDefined(owner).id,
      generation: 1,
      workflowInstanceId: `${assertDefined(session).id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    const [elicitation] = await schema.db
      .insert(schema.sessionActivity)
      .values({
        sessionId: assertDefined(session).id,
        organizationId: null,
        type: 'elicitation',
        body: { text: 'Which item?', toolUseId: 'toolu_crash_window' },
      })
      .returning({ id: schema.sessionActivity.id });
    failImmediateWakeDelivery();

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${assertDefined(session).id}/activity/${assertDefined(elicitation).id}/reply`,
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
      .where(eq(schema.sessionActivity.sessionId, assertDefined(session).id));
    expect(replies.some(({ body }) => body.text === 'This item')).toBe(true);
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, assertDefined(session).id));
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
        ownerUserId: assertDefined(owner).id,
        kind: 'chat',
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: assertDefined(session).id,
      ownerUserId: assertDefined(owner).id,
      generation: 1,
      workflowInstanceId: `${assertDefined(session).id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    failImmediateWakeDelivery();

    const response = await appFor(assertDefined(owner).id).request('/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Continue with this answer' }),
    });

    expect(response.status).toBe(202);
    const [activity] = await schema.db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, assertDefined(session).id));
    const [transcript] = await schema.db
      .select()
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, assertDefined(session).id));
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, assertDefined(session).id));
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
        ownerUserId: assertDefined(owner).id,
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: assertDefined(session).id,
      ownerUserId: assertDefined(owner).id,
      generation: 1,
      workflowInstanceId: `${assertDefined(session).id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    failImmediateWakeDelivery();

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${assertDefined(session).id}/resume`,
      {
        method: 'POST',
      },
    );

    expect(response.status).toBe(202);
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, assertDefined(session).id));
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
        ownerUserId: assertDefined(owner).id,
        trigger: 'delegation',
        status: 'awaiting_input',
      })
      .returning({ id: schema.agentSession.id });
    await schema.db.insert(schema.agentSessionRun).values({
      sessionId: assertDefined(session).id,
      ownerUserId: assertDefined(owner).id,
      generation: 1,
      workflowInstanceId: `${assertDefined(session).id}:1`,
      status: 'waiting',
      attempt: 1,
    });
    failImmediateWakeDelivery();

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${assertDefined(session).id}/cancel`,
      {
        method: 'POST',
      },
    );

    expect(response.status).toBe(202);
    const [current] = await schema.db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, assertDefined(session).id));
    const [intent] = await schema.db
      .select()
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(eq(schema.agentSessionRun.sessionId, assertDefined(session).id));
    expect(current?.status).toBe('canceled');
    expect(intent?.agent_session_dispatch).toMatchObject({
      action: 'wake',
      status: 'pending',
      attempt: 1,
    });
  });

  it('acknowledges a single-activity approval by queueing a wake rather than resuming inline', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Approve Owner', email: `approve-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const ws = await seedApprovalWorkspace(assertDefined(owner).id);
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'awaiting_approval');
    const activityId = await seedProposedAction(sessionId, ws.orgId, 'Async approve target');

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${sessionId}/activity/${activityId}/decision`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      },
    );

    expect(response.status).toBe(202);
    expect((await response.json()) as { approvalStatus: string }).toMatchObject({
      approvalStatus: 'approved',
    });
    expect(runnerMocks.wake).toHaveBeenCalledWith(sessionId);
    expect(runnerMocks.admit).not.toHaveBeenCalled();
  });

  it('acknowledges a single-activity rejection by queueing a wake rather than resuming inline', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Reject Owner', email: `reject-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const ws = await seedApprovalWorkspace(assertDefined(owner).id);
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'awaiting_approval');
    const activityId = await seedProposedAction(sessionId, ws.orgId, 'Async reject target');

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${sessionId}/activity/${activityId}/decision`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      },
    );

    expect(response.status).toBe(202);
    expect((await response.json()) as { approvalStatus: string }).toMatchObject({
      approvalStatus: 'rejected',
    });
    expect(runnerMocks.wake).toHaveBeenCalledWith(sessionId);
  });

  it('acknowledges a proposal-group approval by queueing one wake for the whole group', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Group Approve Owner', email: `group-approve-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const ws = await seedApprovalWorkspace(assertDefined(owner).id);
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'awaiting_approval');
    const groupId = 'group_async_approve';
    const first = await seedProposedAction(sessionId, ws.orgId, 'First in group', groupId);
    const second = await seedProposedAction(sessionId, ws.orgId, 'Second in group', groupId);

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${sessionId}/proposals/${groupId}/decision`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      },
    );

    expect(response.status).toBe(202);
    expect(runnerMocks.wake).toHaveBeenCalledWith(sessionId);
    const rows = await schema.db
      .select({
        id: schema.sessionActivity.id,
        approvalStatus: schema.sessionActivity.approvalStatus,
      })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, sessionId));
    expect(
      rows
        .filter((row) => [first, second].includes(row.id))
        .every((row) => row.approvalStatus === 'approved'),
    ).toBe(true);
  });

  it('acknowledges a proposal-group rejection by queueing one wake for the whole group', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Group Reject Owner', email: `group-reject-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const ws = await seedApprovalWorkspace(assertDefined(owner).id);
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'awaiting_approval');
    const groupId = 'group_async_reject';
    await seedProposedAction(sessionId, ws.orgId, 'Only in group', groupId);

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${sessionId}/proposals/${groupId}/decision`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      },
    );

    expect(response.status).toBe(202);
    expect(runnerMocks.wake).toHaveBeenCalledWith(sessionId);
  });

  it('acknowledges the session-level approve shortcut by queueing a wake, not resuming inline', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Shortcut Approve Owner', email: `shortcut-approve-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const ws = await seedApprovalWorkspace(assertDefined(owner).id);
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'awaiting_approval');
    await seedProposedAction(sessionId, ws.orgId, 'Latest action');

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${sessionId}/decision`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approved' }),
      },
    );

    expect(response.status).toBe(202);
    expect(runnerMocks.wake).toHaveBeenCalledWith(sessionId);
  });

  it('acknowledges the session-level reject shortcut by queueing a wake, not resuming inline', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Shortcut Reject Owner', email: `shortcut-reject-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const ws = await seedApprovalWorkspace(assertDefined(owner).id);
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'awaiting_approval');
    await seedProposedAction(sessionId, ws.orgId, 'Latest action to reject');

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${sessionId}/decision`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      },
    );

    expect(response.status).toBe(202);
    expect(runnerMocks.wake).toHaveBeenCalledWith(sessionId);
  });

  it('steers pending or running work through admission rather than a wake', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Steer Owner', email: `steer-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'running');
    await schema.db.insert(schema.agentSessionTranscript).values({
      sessionId,
      ownerUserId: assertDefined(owner).id,
      messages: [],
    });
    runnerMocks.admit.mockResolvedValue({
      mode: 'async',
      queued: { runId: 'run_x', generation: 1 },
    });

    const response = await appFor(assertDefined(owner).id).request(
      `/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Keep steering this while it runs' }),
      },
    );

    expect(response.status).toBe(202);
    expect(runnerMocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({ id: sessionId }),
      expect.objectContaining({
        runnableStatuses: ['pending', 'running', 'completed', 'failed'],
        clearEndedAt: true,
      }),
    );
    expect(runnerMocks.wake).not.toHaveBeenCalled();
  });

  it('acknowledges /run for pending or running work rather than running it inline', async () => {
    const suffix = Math.random().toString(36).slice(2, 9);
    const [owner] = await schema.db
      .insert(schema.user)
      .values({ name: 'Run Owner', email: `run-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const sessionId = await seedOwnedSession(assertDefined(owner).id, 'running');
    runnerMocks.admit.mockResolvedValue({
      mode: 'async',
      queued: { runId: 'run_y', generation: 1 },
    });

    const response = await appFor(assertDefined(owner).id).request(`/sessions/${sessionId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(202);
    expect(runnerMocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({ id: sessionId }),
      expect.objectContaining({ runnableStatuses: ['pending', 'running'] }),
    );
  });
});
