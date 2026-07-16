import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { SessionActivityBody } from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type { SessionStatus } from '@docket/types';

import type { ActorCtx, AppEnv } from '../../src/context';
import type { getContainer as GetContainer } from '../../src/container';
import { onError } from '../../src/error';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import { fakeSession, getDb, one } from '../support/routes-harness';

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
