import { Hono } from 'hono';
import { and, eq, inArray, or } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { SessionActivityBody } from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type { SessionStatus } from '@docket/types';

import type * as AsyncRunnerModule from '../../src/agent/async-runner';
import { enqueueRunGeneration } from '../../src/agent/run-generation';
import type { ActorCtx, AppEnv } from '../../src/context';
import type { getContainer as GetContainer } from '../../src/container';
import { onError } from '../../src/error';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import { fakeSession, getDb, one } from '../support/routes-harness';

const runnerMocks = vi.hoisted(() => ({
  enabled: false,
  admit: vi.fn<typeof AsyncRunnerModule.admitAthenaGeneration>(async () => ({
    mode: 'sync' as const,
  })),
  wake: vi.fn<typeof AsyncRunnerModule.wakeWaitingAthenaGeneration>(),
}));

vi.mock('../../src/agent/async-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof AsyncRunnerModule>();
  return {
    ...actual,
    asynchronousRunnerEnabled: () => runnerMocks.enabled,
    admitAthenaGeneration: runnerMocks.admit,
    wakeWaitingAthenaGeneration: runnerMocks.wake,
  };
});

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentRuntime!: typeof AgentRuntimeModule;
let agentSessions!: typeof agentSessionsRouter;
let getContainer!: typeof GetContainer;

const JSON_HEADERS = { 'content-type': 'application/json' };

interface Person {
  readonly userId: string;
  readonly actorId: string;
  readonly capabilities: readonly string[];
}

interface Seed {
  readonly orgId: string;
  readonly teamId: string;
  readonly owner: Person;
  readonly other: Person;
  readonly agentId: string;
}

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  agentRuntime = await import('@docket/agent-runtime');
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
  ({ getContainer } = await import('../../src/container'));
});

afterEach(() => {
  runnerMocks.enabled = false;
  runnerMocks.admit.mockReset().mockResolvedValue({ mode: 'sync' });
  runnerMocks.wake.mockReset();
  vi.restoreAllMocks();
});

/** Seed two users in one workspace plus one conventional registered agent. */
async function seedWorkspace(): Promise<Seed> {
  const slug = `owner-private-${Math.random().toString(36).slice(2, 10)}`;
  const org = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  );
  const team = one(
    await db
      .insert(schema.team)
      .values({ organizationId: org.id, name: 'Core', key: `K${slug.slice(-4)}` })
      .returning({ id: schema.team.id }),
  );

  const makePerson = async (
    name: string,
    capabilities: readonly ('view' | 'contribute' | 'assign')[],
  ): Promise<Person> => {
    const user = one(
      await db
        .insert(schema.user)
        .values({ name, email: `${name.toLowerCase()}-${slug}@example.com` })
        .returning({ id: schema.user.id }),
    );
    const role = one(
      await db
        .insert(schema.role)
        .values({
          organizationId: org.id,
          key: `${name.toLowerCase()}-${slug}`,
          name,
          capabilities: [...capabilities],
        })
        .returning({ id: schema.role.id }),
    );
    const actor = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: org.id,
          kind: 'human',
          displayName: name,
          userId: user.id,
          roleId: role.id,
        })
        .returning({ id: schema.actor.id }),
    );
    await db.insert(schema.grant).values({
      organizationId: org.id,
      subjectKind: 'role',
      subjectId: role.id,
      resourceKind: 'organization',
      resourceId: org.id,
      capabilities: [...capabilities],
      effect: 'allow',
    });
    return { userId: user.id, actorId: actor.id, capabilities };
  };

  const owner = await makePerson('Owner', ['view', 'contribute']);
  const other = await makePerson('Other', ['view', 'contribute', 'assign']);
  const agentActor = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: org.id, kind: 'agent', displayName: 'Registered helper' })
      .returning({ id: schema.actor.id }),
  );
  const registered = one(
    await db
      .insert(schema.agent)
      .values({ organizationId: org.id, actorId: agentActor.id, createdBy: owner.actorId })
      .returning({ id: schema.agent.id }),
  );
  return { orgId: org.id, teamId: team.id, owner, other, agentId: registered.id };
}

/** Mount the compatibility router as an authenticated workspace member. */
function appFor(seed: Seed, person: Person, capabilities = person.capabilities) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(person.userId, person.userId, `${person.userId}@example.com`));
    const actorCtx: ActorCtx = {
      orgId: seed.orgId,
      actorId: person.actorId,
      roleId: null,
      capabilities,
    };
    c.set('actorCtx', actorCtx);
    await next();
  });
  app.route('/', agentSessions);
  app.onError(onError);
  return app;
}

/** Insert one personal Athena session for a user. */
async function seedAthena(
  seed: Seed,
  person: Person,
  status: SessionStatus = 'pending',
): Promise<string> {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        contextOrganizationId: seed.orgId,
        trigger: 'delegation',
        status,
        initiatorId: person.actorId,
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
}

/** Insert one workspace-owned registered-agent session. */
async function seedRegistered(seed: Seed, status: SessionStatus = 'pending') {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'registered_agent',
        organizationId: seed.orgId,
        agentId: seed.agentId,
        trigger: 'delegation',
        status,
        initiatorId: seed.owner.actorId,
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
}

/** Attach the human-waiting generation whose wake must be committed with the mutation. */
async function seedWaitingRun(person: Person, sessionId: string): Promise<void> {
  await db.insert(schema.agentSessionRun).values({
    sessionId,
    ownerUserId: person.userId,
    generation: 1,
    workflowInstanceId: `${sessionId}:1`,
    status: 'waiting',
    attempt: 1,
  });
}

/** Add an activity to a session, with personal or workspace attribution. */
async function seedActivity(
  seed: Seed,
  sessionId: string,
  executorKind: 'athena' | 'registered_agent',
  values: {
    readonly type: 'thought' | 'action' | 'response' | 'elicitation' | 'error';
    readonly body: SessionActivityBody;
    readonly approvalStatus?: 'proposed' | 'approved' | 'rejected' | 'applied';
    readonly proposalGroupId?: string;
  },
): Promise<string> {
  return one(
    await db
      .insert(schema.sessionActivity)
      .values({
        sessionId,
        organizationId: executorKind === 'athena' ? null : seed.orgId,
        ...values,
      })
      .returning({ id: schema.sessionActivity.id }),
  ).id;
}

/** Issue a JSON POST to a compatibility action. */
function post(app: ReturnType<typeof appFor>, path: string, body: unknown = {}) {
  return app.request(path, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

describe('owner-private Athena compatibility routes', () => {
  it('returns asynchronous acceptance across the personal compatibility mutation matrix', async () => {
    runnerMocks.enabled = true;
    runnerMocks.admit.mockImplementation(
      async (
        session: Parameters<typeof enqueueRunGeneration>[0],
        options?: Parameters<typeof enqueueRunGeneration>[1],
      ) => ({ mode: 'async' as const, queued: await enqueueRunGeneration(session, options) }),
    );
    runnerMocks.wake.mockImplementation(async (sessionId: string) => ({
      sessionId,
      generation: 1,
      workflowId: `${sessionId}:1`,
    }));

    const seed = await seedWorkspace();
    const ownerApp = appFor(seed, seed.owner);
    const otherApp = appFor(seed, seed.other);
    const runtime = new agentRuntime.MockAgentTurnRuntime({
      script: Array.from({ length: 10 }, (_, index) => ({
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: `Settled ${index}` }],
        },
        stopReason: 'end_turn' as const,
      })),
    });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );

    const created = await post(ownerApp, '/', { prompt: 'Queue this personal request' });
    expect(created.status).toBe(202);
    const createdBody = (await created.json()) as { id: string; status: string };
    expect(createdBody).toMatchObject({ status: 'running' });
    expect((await post(ownerApp, `/${createdBody.id}/pause`)).status).toBe(200);
    const [pausedRun] = await db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, createdBody.id));
    expect(pausedRun?.status).toBe('waiting');

    const cancelCreated = await post(ownerApp, '/', { prompt: 'Cancel this queued request' });
    expect(cancelCreated.status).toBe(202);
    const cancelBody = (await cancelCreated.json()) as { id: string };
    expect((await post(ownerApp, `/${cancelBody.id}/cancel`)).status).toBe(200);
    const [canceledRun] = await db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, cancelBody.id));
    expect(canceledRun?.status).toBe('canceled');

    const chatted = await post(ownerApp, '/chat/messages', { body: 'Queue this chat turn' });
    expect(chatted.status).toBe(202);
    const chatBody = (await chatted.json()) as { id: string; status: string };
    expect(chatBody).toMatchObject({ status: 'running' });
    await db
      .update(schema.agentSession)
      .set({ status: 'awaiting_approval' })
      .where(eq(schema.agentSession.id, chatBody.id));
    const admissionsBeforeParkedMessage = runnerMocks.admit.mock.calls.length;
    const parkedMessage = await post(ownerApp, '/chat/messages', {
      body: 'Keep this message parked behind the existing review',
    });
    expect(parkedMessage.status).toBe(200);
    expect((await parkedMessage.json()) as { status: string }).toMatchObject({
      status: 'awaiting_approval',
    });
    expect(runnerMocks.admit).toHaveBeenCalledTimes(admissionsBeforeParkedMessage);

    const runnable = await seedAthena(seed, seed.owner, 'pending');
    await seedActivity(seed, runnable, 'athena', {
      type: 'response',
      body: { text: 'Queue this existing session' },
    });
    const admissionsBeforeIntrusion = runnerMocks.admit.mock.calls.length;
    expect((await post(otherApp, `/${runnable}/run`)).status).toBe(404);
    expect(runnerMocks.admit).toHaveBeenCalledTimes(admissionsBeforeIntrusion);
    expect((await post(ownerApp, `/${runnable}/run`)).status).toBe(202);

    const approval = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedWaitingRun(seed.owner, approval);
    await seedActivity(seed, approval, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'note', summary: 'Approve asynchronously' } },
    });
    const wakesBeforeShortcutIntrusion = runnerMocks.wake.mock.calls.length;
    expect((await post(otherApp, `/${approval}/approve`)).status).toBe(404);
    expect(runnerMocks.wake).toHaveBeenCalledTimes(wakesBeforeShortcutIntrusion);
    expect((await post(ownerApp, `/${approval}/approve`)).status).toBe(202);

    const rejection = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedWaitingRun(seed.owner, rejection);
    await seedActivity(seed, rejection, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'note', summary: 'Reject asynchronously' } },
    });
    expect((await post(ownerApp, `/${rejection}/reject`)).status).toBe(202);

    const activityApproval = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedWaitingRun(seed.owner, activityApproval);
    const activityApprovalId = await seedActivity(seed, activityApproval, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'note', summary: 'Approve one asynchronously' } },
    });
    const wakesBeforeActivityIntrusion = runnerMocks.wake.mock.calls.length;
    expect(
      (await post(otherApp, `/${activityApproval}/activity/${activityApprovalId}/approve`)).status,
    ).toBe(404);
    expect(runnerMocks.wake).toHaveBeenCalledTimes(wakesBeforeActivityIntrusion);
    expect(
      (await post(ownerApp, `/${activityApproval}/activity/${activityApprovalId}/approve`)).status,
    ).toBe(202);

    const activityRejection = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedWaitingRun(seed.owner, activityRejection);
    const activityRejectionId = await seedActivity(seed, activityRejection, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'note', summary: 'Reject one asynchronously' } },
    });
    expect(
      (await post(ownerApp, `/${activityRejection}/activity/${activityRejectionId}/reject`)).status,
    ).toBe(202);

    const groupApproval = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedWaitingRun(seed.owner, groupApproval);
    await seedActivity(seed, groupApproval, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'group_async_approve',
      body: { action: { kind: 'note', summary: 'Approve the group asynchronously' } },
    });
    const wakesBeforeGroupIntrusion = runnerMocks.wake.mock.calls.length;
    expect(
      (await post(otherApp, `/${groupApproval}/proposals/group_async_approve/approve`)).status,
    ).toBe(404);
    expect(runnerMocks.wake).toHaveBeenCalledTimes(wakesBeforeGroupIntrusion);
    expect(
      (await post(ownerApp, `/${groupApproval}/proposals/group_async_approve/approve`)).status,
    ).toBe(202);

    const groupRejection = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedWaitingRun(seed.owner, groupRejection);
    await seedActivity(seed, groupRejection, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'group_async_reject',
      body: { action: { kind: 'note', summary: 'Reject the group asynchronously' } },
    });
    expect(
      (await post(ownerApp, `/${groupRejection}/proposals/group_async_reject/reject`)).status,
    ).toBe(202);

    const asking = await seedAthena(seed, seed.owner, 'awaiting_input');
    await seedWaitingRun(seed.owner, asking);
    const elicitation = await seedActivity(seed, asking, 'athena', {
      type: 'elicitation',
      body: { text: 'Which one?', toolUseId: 'toolu_compat_async' },
    });
    expect(
      (await post(ownerApp, `/${asking}/activity/${elicitation}/reply`, { body: 'This one' }))
        .status,
    ).toBe(202);

    const resumable = await seedAthena(seed, seed.owner, 'awaiting_input');
    await seedWaitingRun(seed.owner, resumable);
    expect((await post(ownerApp, `/${resumable}/resume`)).status).toBe(202);

    const registered = await post(ownerApp, '/', {
      prompt: 'Keep the conventional agent synchronous',
      agentId: seed.agentId,
    });
    expect(registered.status).toBe(200);

    const registeredActivityApproval = await seedRegistered(seed, 'awaiting_approval');
    const registeredActivityApprovalId = await seedActivity(
      seed,
      registeredActivityApproval,
      'registered_agent',
      {
        type: 'action',
        approvalStatus: 'proposed',
        body: { action: { kind: 'note', summary: 'Registered activity approval' } },
      },
    );
    expect(
      (
        await post(
          otherApp,
          `/${registeredActivityApproval}/activity/${registeredActivityApprovalId}/approve`,
        )
      ).status,
    ).toBe(200);

    const registeredActivityRejection = await seedRegistered(seed, 'awaiting_approval');
    const registeredActivityRejectionId = await seedActivity(
      seed,
      registeredActivityRejection,
      'registered_agent',
      {
        type: 'action',
        approvalStatus: 'proposed',
        body: { action: { kind: 'note', summary: 'Registered activity rejection' } },
      },
    );
    expect(
      (
        await post(
          otherApp,
          `/${registeredActivityRejection}/activity/${registeredActivityRejectionId}/reject`,
        )
      ).status,
    ).toBe(200);

    const registeredGroupApproval = await seedRegistered(seed, 'awaiting_approval');
    await seedActivity(seed, registeredGroupApproval, 'registered_agent', {
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'registered_group_approve',
      body: { action: { kind: 'note', summary: 'Registered group approval' } },
    });
    expect(
      (
        await post(
          otherApp,
          `/${registeredGroupApproval}/proposals/registered_group_approve/approve`,
        )
      ).status,
    ).toBe(200);

    const registeredGroupRejection = await seedRegistered(seed, 'awaiting_approval');
    await seedActivity(seed, registeredGroupRejection, 'registered_agent', {
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'registered_group_reject',
      body: { action: { kind: 'note', summary: 'Registered group rejection' } },
    });
    expect(
      (
        await post(
          otherApp,
          `/${registeredGroupRejection}/proposals/registered_group_reject/reject`,
        )
      ).status,
    ).toBe(200);
    expect(runnerMocks.admit).toHaveBeenCalledTimes(4);
    expect(runnerMocks.wake).toHaveBeenCalledTimes(8);
    const wakeIntents = await db
      .select({ sessionId: schema.agentSessionRun.sessionId })
      .from(schema.agentSessionDispatch)
      .innerJoin(
        schema.agentSessionRun,
        eq(schema.agentSessionRun.id, schema.agentSessionDispatch.runId),
      )
      .where(
        and(
          eq(schema.agentSessionDispatch.action, 'wake'),
          inArray(schema.agentSessionRun.sessionId, [
            approval,
            rejection,
            activityApproval,
            activityRejection,
            groupApproval,
            groupRejection,
            asking,
            resumable,
          ]),
        ),
      );
    expect(wakeIntents).toHaveLength(8);
  });

  it("lists only the caller's Athena work while retaining shared registered-agent sessions", async () => {
    const seed = await seedWorkspace();
    const mine = await seedAthena(seed, seed.owner, 'completed');
    const theirs = await seedAthena(seed, seed.other, 'completed');
    const shared = await seedRegistered(seed, 'completed');

    const ownerResponse = await appFor(seed, seed.owner).request('/');
    const ownerIds = ((await ownerResponse.json()) as { items: { id: string }[] }).items.map(
      ({ id }) => id,
    );
    expect(ownerIds).toContain(mine);
    expect(ownerIds).toContain(shared);
    expect(ownerIds).not.toContain(theirs);

    const otherResponse = await appFor(seed, seed.other).request('/');
    const otherIds = ((await otherResponse.json()) as { items: { id: string }[] }).items.map(
      ({ id }) => id,
    );
    expect(otherIds).toContain(theirs);
    expect(otherIds).toContain(shared);
    expect(otherIds).not.toContain(mine);
  });

  it('hides detail, activity, SSE, proposals, and proposal editing from another member', async () => {
    const seed = await seedWorkspace();
    const sessionId = await seedAthena(seed, seed.owner, 'completed');
    const activityId = await seedActivity(seed, sessionId, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'group_private',
      body: {
        action: {
          kind: 'create_task',
          summary: 'Create a private task',
          toolCall: {
            connection: 'docket',
            tool: 'create_task',
            toolUseId: 'toolu_private',
            input: { orgId: seed.orgId, teamId: seed.teamId, title: 'Private' },
          },
        },
      },
    });
    const intruder = appFor(seed, seed.other);

    for (const path of [
      `/${sessionId}`,
      `/${sessionId}/activity`,
      `/${sessionId}/stream`,
      `/${sessionId}/proposals`,
    ]) {
      expect((await intruder.request(path)).status).toBe(404);
    }
    const edited = await intruder.request(`/${sessionId}/activity/${activityId}/proposal`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ input: { title: 'Stolen' } }),
    });
    expect(edited.status).toBe(404);
  });

  it("keeps each user's compatibility chat private and returns only their own current thread", async () => {
    const seed = await seedWorkspace();
    const ownerApp = appFor(seed, seed.owner);
    const otherApp = appFor(seed, seed.other);
    const ownerChat = (await (await ownerApp.request('/chat')).json()) as { id: string };
    const otherChat = (await (await otherApp.request('/chat')).json()) as { id: string };

    expect(otherChat.id).not.toBe(ownerChat.id);
    expect((await otherApp.request(`/${ownerChat.id}`)).status).toBe(404);
    expect((await ownerApp.request(`/${otherChat.id}`)).status).toBe(404);
  });

  it('allows only the owner to run, pause, resume, cancel, and reply to Athena work', async () => {
    const seed = await seedWorkspace();
    const ownerApp = appFor(seed, seed.owner);
    const otherApp = appFor(seed, seed.other);

    const running = await seedAthena(seed, seed.owner, 'running');
    expect((await otherApp.request(`/${running}/pause`, { method: 'POST' })).status).toBe(404);
    expect((await ownerApp.request(`/${running}/pause`, { method: 'POST' })).status).toBe(200);
    expect((await ownerApp.request(`/${running}/resume`, { method: 'POST' })).status).toBe(200);
    expect((await ownerApp.request(`/${running}/cancel`, { method: 'POST' })).status).toBe(200);

    const asking = await seedAthena(seed, seed.owner, 'awaiting_input');
    const elicitation = await seedActivity(seed, asking, 'athena', {
      type: 'elicitation',
      body: { text: 'Which task?' },
    });
    expect(
      (await post(otherApp, `/${asking}/activity/${elicitation}/reply`, { body: 'Mine' })).status,
    ).toBe(404);
    expect(
      (await post(ownerApp, `/${asking}/activity/${elicitation}/reply`, { body: 'Mine' })).status,
    ).toBe(200);

    const pending = await seedAthena(seed, seed.owner, 'pending');
    await seedActivity(seed, pending, 'athena', {
      type: 'response',
      body: { text: 'Summarize my work' },
    });
    expect((await post(otherApp, `/${pending}/run`)).status).toBe(404);
    const runtime = new agentRuntime.MockAgentTurnRuntime({
      script: [
        {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Here is the summary.' }],
          },
          stopReason: 'end_turn',
        },
      ],
    });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );
    expect((await post(ownerApp, `/${pending}/run`)).status).toBe(200);
  });

  it('admits owner lifecycle and reply resumes through durable generations', async () => {
    const seed = await seedWorkspace();
    const ownerApp = appFor(seed, seed.owner);
    const runtime = new agentRuntime.MockAgentTurnRuntime({
      script: [
        {
          message: { role: 'assistant', content: [{ type: 'text', text: 'Resumed safely.' }] },
          stopReason: 'end_turn',
        },
        {
          message: { role: 'assistant', content: [{ type: 'text', text: 'Reply received.' }] },
          stopReason: 'end_turn',
        },
      ],
    });
    vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
      runtime.streamTurn(input),
    );

    const lifecycleSession = await seedAthena(seed, seed.owner, 'awaiting_input');
    const lifecycleResponse = await ownerApp.request(`/${lifecycleSession}/resume`, {
      method: 'POST',
    });
    expect(lifecycleResponse.status).toBe(200);
    expect(((await lifecycleResponse.json()) as { status: string }).status).toBe('completed');

    const replySession = await seedAthena(seed, seed.owner, 'awaiting_input');
    const elicitation = await seedActivity(seed, replySession, 'athena', {
      type: 'elicitation',
      body: { text: 'Which task?', toolUseId: 'toolu_owner_reply' },
    });
    expect(
      (await post(ownerApp, `/${replySession}/activity/${elicitation}/reply`, { body: 'Mine' }))
        .status,
    ).toBe(200);

    const sessions = await db
      .select({ id: schema.agentSession.id, status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(
        or(eq(schema.agentSession.id, lifecycleSession), eq(schema.agentSession.id, replySession)),
      );
    expect(sessions.map(({ status }) => status).sort()).toEqual(['completed', 'completed']);
    const runs = await db
      .select({
        sessionId: schema.agentSessionRun.sessionId,
        status: schema.agentSessionRun.status,
      })
      .from(schema.agentSessionRun)
      .where(
        or(
          eq(schema.agentSessionRun.sessionId, lifecycleSession),
          eq(schema.agentSessionRun.sessionId, replySession),
        ),
      );
    expect(runs).toHaveLength(2);
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);
  });

  it('lets a contribute-only owner approve while the tool still enforces current permissions', async () => {
    const seed = await seedWorkspace();
    const ownerApp = appFor(seed, seed.owner, ['view', 'contribute']);
    const intruder = appFor(seed, seed.other, ['assign']);
    const sessionId = await seedAthena(seed, seed.owner, 'awaiting_approval');
    const actionId = await seedActivity(seed, sessionId, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      body: {
        action: {
          kind: 'create_task',
          summary: 'Create an allowed task',
          toolCall: {
            connection: 'docket',
            tool: 'create_task',
            toolUseId: 'toolu_allowed',
            input: { orgId: seed.orgId, teamId: seed.teamId, title: 'Allowed by contribute' },
          },
        },
      },
    });

    expect((await post(intruder, `/${sessionId}/activity/${actionId}/approve`)).status).toBe(404);
    const approved = await post(ownerApp, `/${sessionId}/activity/${actionId}/approve`);
    expect(approved.status).toBe(200);
    const created = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(
        and(
          eq(schema.task.organizationId, seed.orgId),
          eq(schema.task.title, 'Allowed by contribute'),
        ),
      );
    expect(created).toHaveLength(1);

    const deniedSession = await seedAthena(seed, seed.owner, 'awaiting_approval');
    const deniedId = await seedActivity(seed, deniedSession, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      body: {
        action: {
          kind: 'create_program',
          summary: 'Create a forbidden program',
          toolCall: {
            connection: 'docket',
            tool: 'create_program',
            toolUseId: 'toolu_forbidden',
            input: { orgId: seed.orgId, name: 'Must remain forbidden' },
          },
        },
      },
    });
    const denied = await post(ownerApp, `/${deniedSession}/activity/${deniedId}/approve`);
    expect(denied.status).toBe(200);
    const deniedBody = (await denied.json()) as {
      approvalStatus: string;
      body: { action?: { result?: { isError?: boolean } } };
    };
    expect(deniedBody.approvalStatus).toBe('applied');
    expect(deniedBody.body.action?.result?.isError).toBe(true);
    const programs = await db
      .select({ id: schema.program.id })
      .from(schema.program)
      .where(eq(schema.program.organizationId, seed.orgId));
    expect(programs).toHaveLength(0);
  });

  it('owner-scopes group and session decisions but preserves registered-agent assign policy', async () => {
    const seed = await seedWorkspace();
    const ownerApp = appFor(seed, seed.owner, ['contribute']);
    const otherApp = appFor(seed, seed.other, ['assign']);

    const groupSession = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedActivity(seed, groupSession, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      proposalGroupId: 'group_owner',
      body: { action: { kind: 'note', summary: 'Review this batch' } },
    });
    expect((await post(otherApp, `/${groupSession}/proposals/group_owner/reject`)).status).toBe(
      404,
    );
    expect((await post(ownerApp, `/${groupSession}/proposals/group_owner/reject`)).status).toBe(
      200,
    );

    const shortcut = await seedAthena(seed, seed.owner, 'awaiting_approval');
    await seedActivity(seed, shortcut, 'athena', {
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'note', summary: 'Owner decision' } },
    });
    expect((await post(otherApp, `/${shortcut}/reject`)).status).toBe(404);
    expect((await post(ownerApp, `/${shortcut}/reject`)).status).toBe(200);

    const registered = await seedRegistered(seed, 'awaiting_approval');
    await seedActivity(seed, registered, 'registered_agent', {
      type: 'action',
      approvalStatus: 'proposed',
      body: { action: { kind: 'note', summary: 'Registered decision' } },
    });
    expect((await post(ownerApp, `/${registered}/approve`)).status).toBe(403);
    expect((await post(otherApp, `/${registered}/approve`)).status).toBe(200);
  });
});
