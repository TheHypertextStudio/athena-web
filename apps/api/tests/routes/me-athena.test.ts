import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';
import type { getContainer as GetContainer } from '../../src/container';
import { onError } from '../../src/error';
import type meAthenaRouter from '../../src/routes/me-athena';
import { fakeSession, getDb, one } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentRuntime!: typeof AgentRuntimeModule;
let meAthena!: typeof meAthenaRouter;
let getContainer!: typeof GetContainer;

const JSON_HEADERS = { 'content-type': 'application/json' };

interface Person {
  readonly userId: string;
  readonly actorIds: Readonly<Record<string, string>>;
}

interface Seed {
  readonly orgA: string;
  readonly orgB: string;
  readonly teamA: string;
  readonly teamB: string;
  readonly owner: Person;
  readonly other: Person;
}

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  agentRuntime = await import('@docket/agent-runtime');
  meAthena = (await import('../../src/routes/me-athena')).default;
  ({ getContainer } = await import('../../src/container'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seed two users who share two workspaces, so context never becomes ownership. */
async function seedPeople(): Promise<Seed> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const makeOrg = async (label: string) =>
    one(
      await db
        .insert(schema.organization)
        .values({
          name: `${label}-${suffix}`,
          slug: `${label.toLowerCase()}-${suffix}`,
          lifecycleState: 'active',
        })
        .returning({ id: schema.organization.id }),
    ).id;
  const orgA = await makeOrg('Alpha');
  const orgB = await makeOrg('Beta');
  const teamA = one(
    await db
      .insert(schema.team)
      .values({ organizationId: orgA, name: 'Core', key: `A${suffix.slice(-3)}` })
      .returning({ id: schema.team.id }),
  ).id;
  const teamB = one(
    await db
      .insert(schema.team)
      .values({ organizationId: orgB, name: 'Beta Core', key: `B${suffix.slice(-3)}` })
      .returning({ id: schema.team.id }),
  ).id;

  const makePerson = async (label: string): Promise<Person> => {
    const userId = one(
      await db
        .insert(schema.user)
        .values({ name: label, email: `${label.toLowerCase()}-${suffix}@example.com` })
        .returning({ id: schema.user.id }),
    ).id;
    await db.insert(schema.hub).values({ userId });
    const actorIds: Record<string, string> = {};
    for (const orgId of [orgA, orgB]) {
      const roleId = one(
        await db
          .insert(schema.role)
          .values({
            organizationId: orgId,
            key: `${label.toLowerCase()}-${orgId}`,
            name: label,
            capabilities: ['view', 'contribute'],
          })
          .returning({ id: schema.role.id }),
      ).id;
      const actorId = one(
        await db
          .insert(schema.actor)
          .values({
            organizationId: orgId,
            kind: 'human',
            displayName: label,
            userId,
            roleId,
          })
          .returning({ id: schema.actor.id }),
      ).id;
      await db.insert(schema.grant).values({
        organizationId: orgId,
        subjectKind: 'role',
        subjectId: roleId,
        resourceKind: 'organization',
        resourceId: orgId,
        capabilities: ['view', 'contribute'],
        effect: 'allow',
      });
      actorIds[orgId] = actorId;
    }
    return { userId, actorIds };
  };

  return {
    orgA,
    orgB,
    teamA,
    teamB,
    owner: await makePerson('Owner'),
    other: await makePerson('Other'),
  };
}

/** Mount the personal route with only a Better Auth session, never an org actor context. */
function appFor(person: Person) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(person.userId));
    await next();
  });
  app.route('/', meAthena);
  app.onError(onError);
  return app;
}

/** Insert caller-owned Athena work. */
async function seedSession(
  seed: Seed,
  person: Person,
  status: 'pending' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'completed',
  kind: 'chat' | 'job' = 'job',
): Promise<string> {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: person.userId,
        contextOrganizationId: seed.orgA,
        kind,
        trigger: 'delegation',
        status,
        initiatorId: person.actorIds[seed.orgA],
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
}

/** Append an application-visible activity to personal work. */
async function seedActivity(
  sessionId: string,
  values: Partial<typeof schema.sessionActivity.$inferInsert> & {
    readonly type: typeof schema.sessionActivity.$inferInsert.type;
  },
): Promise<string> {
  return one(
    await db
      .insert(schema.sessionActivity)
      .values({ sessionId, organizationId: null, body: {}, ...values })
      .returning({ id: schema.sessionActivity.id }),
  ).id;
}

/** Fill one owner's durable Athena run slots with fresh leases. */
async function saturateOwnerAdmission(seed: Seed, person: Person): Promise<void> {
  const sessions = await db
    .insert(schema.agentSession)
    .values(
      Array.from({ length: 8 }, () => ({
        executorKind: 'athena' as const,
        ownerUserId: person.userId,
        contextOrganizationId: seed.orgA,
        trigger: 'delegation' as const,
        status: 'running' as const,
      })),
    )
    .returning({ id: schema.agentSession.id });
  await db.insert(schema.agentSessionRun).values(
    sessions.map(({ id }) => ({
      sessionId: id,
      ownerUserId: person.userId,
      generation: 1,
      workflowInstanceId: `${id}:1`,
      status: 'running' as const,
      attempt: 1,
      leaseToken: `personal-route-slot-${id}`,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })),
  );
}

/** Script one provider completion after any already-persisted assistant transcript turns. */
function mockCompletion(text = 'Done', priorAssistantTurns = 0): void {
  const runtime = new agentRuntime.MockAgentTurnRuntime({
    script: [
      ...Array.from({ length: priorAssistantTurns }, () => ({
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Unused' }],
        },
        stopReason: 'end_turn' as const,
      })),
      {
        message: { role: 'assistant', content: [{ type: 'text', text }] },
        stopReason: 'end_turn' as const,
      },
    ],
  });
  vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
    runtime.streamTurn(input),
  );
}

describe('personal Athena routes', () => {
  it('returns only caller-owned work grouped by product state and the current chat', async () => {
    const seed = await seedPeople();
    const oldChat = await seedSession(seed, seed.owner, 'completed', 'chat');
    const currentChat = await seedSession(seed, seed.owner, 'pending', 'chat');
    const needsYou = await seedSession(seed, seed.owner, 'awaiting_input');
    const working = await seedSession(seed, seed.owner, 'running');
    const finished = await seedSession(seed, seed.owner, 'completed');
    const privateOther = await seedSession(seed, seed.other, 'running');
    await seedActivity(needsYou, { type: 'response', body: { text: 'Need a decision' } });

    const response = await appFor(seed.owner).request('/');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      counts: { needsYou: number; working: number; finished: number };
      currentChat: { id: string } | null;
      sessions: Record<'needsYou' | 'working' | 'finished', { id: string }[]>;
    };
    expect(body.currentChat?.id).toBe(currentChat);
    expect(body.counts).toEqual({ needsYou: 1, working: 2, finished: 2 });
    expect(body.sessions.needsYou.map((row) => row.id)).toEqual([needsYou]);
    expect(body.sessions.working.map((row) => row.id)).toEqual(
      expect.arrayContaining([currentChat, working]),
    );
    expect(body.sessions.finished.map((row) => row.id)).toEqual(
      expect.arrayContaining([oldChat, finished]),
    );
    expect(JSON.stringify(body)).not.toContain(privateOther);
  });

  it('keeps current and fresh chat private while preserving old history', async () => {
    const seed = await seedPeople();
    const ownerApp = appFor(seed.owner);
    const otherApp = appFor(seed.other);
    const initial = (await (await ownerApp.request('/chat')).json()) as { id: string };
    const other = (await (await otherApp.request('/chat')).json()) as { id: string };
    expect(initial.id).not.toBe(other.id);

    const fresh = await ownerApp.request('/chat/new', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ context: { workspaceId: seed.orgB } }),
    });
    expect(fresh.status).toBe(200);
    const freshBody = (await fresh.json()) as { id: string };
    expect(freshBody.id).not.toBe(initial.id);
    expect(((await (await ownerApp.request('/chat')).json()) as { id: string }).id).toBe(
      freshBody.id,
    );
    expect((await ownerApp.request(`/sessions/${initial.id}`)).status).toBe(200);
    expect((await otherApp.request(`/sessions/${initial.id}`)).status).toBe(404);
  });

  it('validates source workspace and caller access before creating contextual work', async () => {
    const seed = await seedPeople();
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: seed.orgA,
          name: 'Launch',
          status: 'active',
          createdBy: seed.owner.actorIds[seed.orgA],
        })
        .returning({ id: schema.project.id }),
    ).id;
    mockCompletion();

    const mismatch = await appFor(seed.owner).request('/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: 'Prepare it',
        context: { workspaceId: seed.orgB, source: { type: 'project', id: projectId } },
      }),
    });
    expect(mismatch.status).toBe(404);

    const forgedOwner = await appFor(seed.owner).request('/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ prompt: 'Prepare it', ownerUserId: seed.other.userId }),
    });
    expect(forgedOwner.status).toBe(422);

    const created = await appFor(seed.owner).request('/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: 'Prepare it',
        context: { source: { type: 'project', id: projectId } },
      }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as {
      id: string;
      workspace: { id: string; name: string } | null;
      context: {
        workspaceId?: string;
        source?: { type: string; id: string; label: string };
      };
    };
    expect(body.context).toEqual({
      workspaceId: seed.orgA,
      source: { type: 'project', id: projectId, label: 'Launch' },
    });
    expect(body.workspace).toEqual({ id: seed.orgA, name: expect.stringMatching(/^Alpha-/) });

    const overview = (await (await appFor(seed.owner).request('/')).json()) as {
      sessions: Record<
        'needsYou' | 'working' | 'finished',
        { id: string; workspace: unknown; context: unknown }[]
      >;
    };
    const summaries = [
      ...overview.sessions.needsYou,
      ...overview.sessions.working,
      ...overview.sessions.finished,
    ];
    expect(summaries.find((session) => session.id === body.id)).toMatchObject({
      workspace: { id: seed.orgA, name: expect.stringMatching(/^Alpha-/) },
      context: {
        workspaceId: seed.orgA,
        source: { type: 'project', id: projectId, label: 'Launch' },
      },
    });
  });

  it('does not disclose canonical labels after the owner loses source access', async () => {
    const seed = await seedPeople();
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: seed.orgA,
          name: 'Secret launch codename',
          status: 'active',
          createdBy: seed.owner.actorIds[seed.orgA],
        })
        .returning({ id: schema.project.id }),
    ).id;
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    await seedActivity(sessionId, {
      type: 'response',
      body: {
        text: 'Review the contextual work',
        author: 'user',
        context: {
          workspaceId: seed.orgA,
          source: { type: 'project', id: projectId },
        },
      },
    });
    const ownerActorId = seed.owner.actorIds[seed.orgA];
    if (!ownerActorId) throw new Error('owner actor missing');
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, ownerActorId));

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspace: unknown;
      context: { source?: { label?: string } } | null;
    };
    expect(body.workspace).toBeNull();
    expect(body.context?.source?.label).toBe('Project');
    expect(JSON.stringify(body)).not.toContain('Secret launch codename');
    expect(JSON.stringify(body)).not.toMatch(/Alpha-/);
  });

  it('supports owner-only proposal review, edits, rejection, and elicitation replies', async () => {
    const seed = await seedPeople();
    const app = appFor(seed.owner);
    const proposalSession = await seedSession(seed, seed.owner, 'awaiting_approval');
    const proposalId = await seedActivity(proposalSession, {
      type: 'action',
      organizationId: seed.orgA,
      approvalStatus: 'proposed',
      proposalGroupId: 'group_personal',
      body: {
        action: {
          kind: 'create_task',
          summary: 'Create draft work',
          toolCall: {
            connection: 'docket',
            tool: 'create_task',
            toolUseId: 'toolu_edit',
            input: { orgId: seed.orgA, teamId: seed.teamA, title: 'Draft' },
          },
        },
      },
    });
    const proposals = (await (
      await app.request(`/sessions/${proposalSession}/proposals`)
    ).json()) as {
      items: { proposalGroupId: string }[];
    };
    expect(proposals.items.map((group) => group.proposalGroupId)).toEqual(['group_personal']);

    const edited = await app.request(
      `/sessions/${proposalSession}/activity/${proposalId}/proposal`,
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          input: { orgId: seed.orgA, teamId: seed.teamA, title: 'Edited draft' },
        }),
      },
    );
    expect(edited.status).toBe(200);
    const rejected = await app.request(
      `/sessions/${proposalSession}/proposals/group_personal/reject`,
      { method: 'POST', headers: JSON_HEADERS, body: '{}' },
    );
    expect(rejected.status).toBe(200);
    expect((await loadApproval(proposalId)).approvalStatus).toBe('rejected');

    const asking = await seedSession(seed, seed.owner, 'awaiting_input');
    const elicitationId = await seedActivity(asking, {
      type: 'elicitation',
      body: { text: 'Which task?' },
    });
    const reply = await app.request(`/sessions/${asking}/activity/${elicitationId}/reply`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: 'The launch task' }),
    });
    expect(reply.status).toBe(200);
    expect((await reply.json()) as { body: { text: string } }).toMatchObject({
      body: { text: 'The launch task' },
    });
  });

  it('reauthorizes proposal edits in the current input workspace and moves attribution atomically', async () => {
    const seed = await seedPeople();
    const app = appFor(seed.owner);
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
    const activityId = await seedActivity(sessionId, {
      type: 'action',
      organizationId: seed.orgA,
      approvalStatus: 'proposed',
      proposalGroupId: 'group_retarget',
      body: {
        action: {
          kind: 'create_task',
          summary: 'Create retargeted work',
          toolCall: {
            connection: 'docket',
            tool: 'create_task',
            toolUseId: 'toolu_retarget',
            input: { orgId: seed.orgA, teamId: seed.teamA, title: 'Original target' },
          },
        },
      },
    });

    const edited = await app.request(`/sessions/${sessionId}/activity/${activityId}/proposal`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        input: { orgId: seed.orgB, teamId: seed.teamB, title: 'Retargeted to Beta' },
      }),
    });
    expect(edited.status).toBe(200);
    const [stored] = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, activityId));
    expect(stored?.organizationId).toBe(seed.orgB);
    expect(stored?.body.action?.toolCall?.input).toMatchObject({ orgId: seed.orgB });

    const approved = await app.request(`/sessions/${sessionId}/activity/${activityId}/approve`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    expect(approved.status).toBe(200);
    const betaTasks = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgB));
    expect(betaTasks).toContainEqual({ title: 'Retargeted to Beta' });
    const [approvalAudit] = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.subjectId, sessionId), eq(schema.auditEvent.type, 'approved')),
      );
    expect(approvalAudit).toMatchObject({
      organizationId: seed.orgB,
      actorId: seed.owner.actorIds[seed.orgB],
    });
  });

  it('rejects unsupported or inaccessible proposal retargeting without changing stored authority', async () => {
    const seed = await seedPeople();
    const app = appFor(seed.owner);
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
    const activityId = await seedActivity(sessionId, {
      type: 'action',
      organizationId: seed.orgA,
      approvalStatus: 'proposed',
      proposalGroupId: 'group_denied_retarget',
      body: {
        action: {
          kind: 'create_task',
          summary: 'Keep original authority',
          toolCall: {
            connection: 'docket',
            tool: 'create_task',
            toolUseId: 'toolu_denied_retarget',
            input: { orgId: seed.orgA, teamId: seed.teamA, title: 'Original authority' },
          },
        },
      },
    });
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, seed.owner.actorIds[seed.orgB]!));

    const missingTarget = await app.request(
      `/sessions/${sessionId}/activity/${activityId}/proposal`,
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ input: { teamId: seed.teamB, title: 'No workspace' } }),
      },
    );
    expect(missingTarget.status).toBe(409);
    const inaccessible = await app.request(
      `/sessions/${sessionId}/activity/${activityId}/proposal`,
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          input: { orgId: seed.orgB, teamId: seed.teamB, title: 'Inaccessible target' },
        }),
      },
    );
    expect(inaccessible.status).toBe(404);

    const [stored] = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, activityId));
    expect(stored).toMatchObject({ organizationId: seed.orgA, approvalStatus: 'proposed' });
    expect(stored?.body.action?.toolCall?.input).toMatchObject({
      orgId: seed.orgA,
      title: 'Original authority',
    });
  });

  it.each(['approve', 'reject'] as const)(
    'rolls back mixed-workspace group %s when any current proposal target is inaccessible',
    async (decision) => {
      const seed = await seedPeople();
      const app = appFor(seed.owner);
      const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
      const groupId = `group_mixed_${decision}`;
      for (const [index, target] of [
        { orgId: seed.orgA, teamId: seed.teamA },
        { orgId: seed.orgB, teamId: seed.teamB },
      ].entries()) {
        await seedActivity(sessionId, {
          type: 'action',
          organizationId: seed.orgA,
          approvalStatus: 'proposed',
          proposalGroupId: groupId,
          body: {
            action: {
              kind: 'create_task',
              summary: `Mixed target ${String(index)}`,
              toolCall: {
                connection: 'docket',
                tool: 'create_task',
                toolUseId: `toolu_group_${decision}_${String(index)}`,
                input: {
                  orgId: target.orgId,
                  teamId: target.teamId,
                  title: `Mixed target ${String(index)}`,
                },
              },
            },
          },
        });
      }
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, seed.owner.actorIds[seed.orgB]!));

      const response = await app.request(
        `/sessions/${sessionId}/proposals/${groupId}/${decision}`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: '{}',
        },
      );
      expect(response.status).toBe(404);
      const actions = await db
        .select({ approvalStatus: schema.sessionActivity.approvalStatus })
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.sessionId, sessionId));
      expect(actions.map((row) => row.approvalStatus)).toEqual(['proposed', 'proposed']);
      expect(
        await db
          .select({ id: schema.auditEvent.id })
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.subjectId, sessionId)),
      ).toHaveLength(0);
    },
  );

  it.each(['approve', 'reject'] as const)(
    'rolls back mixed-workspace all_in_session %s when any current target is inaccessible',
    async (decision) => {
      const seed = await seedPeople();
      const app = appFor(seed.owner);
      const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
      const activityIds: string[] = [];
      for (const [index, target] of [
        { orgId: seed.orgA, teamId: seed.teamA },
        { orgId: seed.orgB, teamId: seed.teamB },
      ].entries()) {
        activityIds.push(
          await seedActivity(sessionId, {
            type: 'action',
            organizationId: seed.orgA,
            approvalStatus: 'proposed',
            proposalGroupId: `group_${String(index)}`,
            body: {
              action: {
                kind: 'create_task',
                summary: `Session target ${String(index)}`,
                toolCall: {
                  connection: 'docket',
                  tool: 'create_task',
                  toolUseId: `toolu_session_${decision}_${String(index)}`,
                  input: {
                    orgId: target.orgId,
                    teamId: target.teamId,
                    title: `Session target ${String(index)}`,
                  },
                },
              },
            },
          }),
        );
      }
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, seed.owner.actorIds[seed.orgB]!));

      const response = await app.request(
        `/sessions/${sessionId}/activity/${activityIds[0]!}/${decision}`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ scope: 'all_in_session' }),
        },
      );
      expect(response.status).toBe(404);
      const actions = await db
        .select({ approvalStatus: schema.sessionActivity.approvalStatus })
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.sessionId, sessionId));
      expect(actions.map((row) => row.approvalStatus)).toEqual(['proposed', 'proposed']);
      expect(
        await db
          .select({ id: schema.auditEvent.id })
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.subjectId, sessionId)),
      ).toHaveLength(0);
    },
  );

  it('audits each accessible mixed-workspace action with its current target Actor', async () => {
    const seed = await seedPeople();
    const app = appFor(seed.owner);
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
    const groupId = 'group_actor_attribution';
    for (const [index, target] of [
      { orgId: seed.orgA, teamId: seed.teamA },
      { orgId: seed.orgB, teamId: seed.teamB },
    ].entries()) {
      await seedActivity(sessionId, {
        type: 'action',
        organizationId: seed.orgA,
        approvalStatus: 'proposed',
        proposalGroupId: groupId,
        body: {
          action: {
            kind: 'create_task',
            summary: `Audited target ${String(index)}`,
            toolCall: {
              connection: 'docket',
              tool: 'create_task',
              toolUseId: `toolu_audit_${String(index)}`,
              input: {
                orgId: target.orgId,
                teamId: target.teamId,
                title: `Audited target ${String(index)}`,
              },
            },
          },
        },
      });
    }

    const response = await app.request(`/sessions/${sessionId}/proposals/${groupId}/approve`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    expect(response.status).toBe(200);
    const approvals = await db
      .select({
        organizationId: schema.auditEvent.organizationId,
        actorId: schema.auditEvent.actorId,
      })
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.subjectId, sessionId), eq(schema.auditEvent.type, 'approved')),
      );
    expect(approvals).toHaveLength(2);
    expect(approvals).toEqual(
      expect.arrayContaining([
        { organizationId: seed.orgA, actorId: seed.owner.actorIds[seed.orgA] },
        { organizationId: seed.orgB, actorId: seed.owner.actorIds[seed.orgB] },
      ]),
    );
  });

  it('owner-scopes activity, SSE replay, steering, and lifecycle controls', async () => {
    const seed = await seedPeople();
    const replaySession = await seedSession(seed, seed.owner, 'completed');
    const first = await seedActivity(replaySession, {
      type: 'response',
      body: { text: 'First' },
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
    });
    const second = await seedActivity(replaySession, {
      type: 'response',
      body: { text: 'Second' },
      createdAt: new Date('2026-07-15T12:00:01.000Z'),
    });
    const sessionId = await seedSession(seed, seed.owner, 'running');
    const cancelSession = await seedSession(seed, seed.owner, 'running');
    const ownerApp = appFor(seed.owner);
    const otherApp = appFor(seed.other);
    mockCompletion('Resumed through a durable generation');

    expect((await otherApp.request(`/sessions/${sessionId}/activity`)).status).toBe(404);
    const stream = await ownerApp.request(`/sessions/${replaySession}/stream`, {
      headers: { 'last-event-id': first },
    });
    expect(stream.status).toBe(200);
    const text = await stream.text();
    expect(text).toContain(`id: ${second}`);
    expect(text).not.toContain(`id: ${first}`);

    expect(
      (await otherApp.request(`/sessions/${sessionId}/pause`, { method: 'POST' })).status,
    ).toBe(404);
    expect(
      (await ownerApp.request(`/sessions/${sessionId}/pause`, { method: 'POST' })).status,
    ).toBe(200);
    expect(
      (await ownerApp.request(`/sessions/${sessionId}/resume`, { method: 'POST' })).status,
    ).toBe(200);
    expect(
      (await ownerApp.request(`/sessions/${cancelSession}/cancel`, { method: 'POST' })).status,
    ).toBe(200);
    const runs = await db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, sessionId));
    expect(runs).toEqual([{ status: 'completed' }]);
  });

  it('admits transcript-free personal replies through durable generations', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_input');
    const elicitationId = await seedActivity(sessionId, {
      type: 'elicitation',
      body: { text: 'Which task?', toolUseId: 'toolu_personal_reply' },
    });
    mockCompletion('Reply received');

    const response = await appFor(seed.owner).request(
      `/sessions/${sessionId}/activity/${elicitationId}/reply`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ body: 'The launch task' }),
      },
    );

    expect(response.status).toBe(200);
    const runs = await db
      .select({ status: schema.agentSessionRun.status })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, sessionId));
    expect(runs).toEqual([{ status: 'completed' }]);
  });

  it('keeps message-resumed work parked when durable admission is full', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_input');
    await saturateOwnerAdmission(seed, seed.owner);

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: 'Continue with the launch task' }),
    });

    expect(response.status).toBe(409);
    const [session] = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(session?.status).toBe('awaiting_input');
  });

  it('keeps explicitly resumed work parked when durable admission is full', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_input');
    await saturateOwnerAdmission(seed, seed.owner);

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/resume`, {
      method: 'POST',
    });

    expect(response.status).toBe(409);
    const [session] = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(session?.status).toBe('awaiting_input');
  });

  it('keeps raw provider reasoning out of personal detail, activity, and SSE projections', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    const thoughtId = await seedActivity(sessionId, {
      type: 'thought',
      body: { text: 'private chain of thought' },
    });
    const responseId = await seedActivity(sessionId, {
      type: 'response',
      body: { text: 'Application-owned progress update' },
    });
    const app = appFor(seed.owner);

    const detail = (await (await app.request(`/sessions/${sessionId}`)).json()) as {
      activities: { id: string; type: string }[];
    };
    expect(detail.activities.map((row) => row.id)).toEqual([responseId]);
    const activity = (await (await app.request(`/sessions/${sessionId}/activity`)).json()) as {
      items: { id: string; type: string }[];
    };
    expect(activity.items.map((row) => row.id)).toEqual([responseId]);
    const stream = await app.request(`/sessions/${sessionId}/stream`);
    const streamBody = await stream.text();
    expect(streamBody).toContain(`id: ${responseId}`);
    expect(streamBody).not.toContain(`id: ${thoughtId}`);
    expect(streamBody).not.toContain('private chain of thought');
  });

  it('replays same-timestamp activity in stable id order', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    const createdAt = new Date('2026-07-15T12:00:00.000Z');
    await seedActivity(sessionId, {
      id: 'activity_zulu',
      type: 'response',
      body: { text: 'Inserted first' },
      createdAt,
    });
    await seedActivity(sessionId, {
      id: 'activity_alpha',
      type: 'response',
      body: { text: 'Inserted second' },
      createdAt,
    });

    const stream = await appFor(seed.owner).request(`/sessions/${sessionId}/stream`);
    const body = await stream.text();
    expect(body.indexOf('id: activity_alpha')).toBeLessThan(body.indexOf('id: activity_zulu'));
  });

  it('lets the owner approve without assign while the underlying tool reauthorizes', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
    const actionId = await seedActivity(sessionId, {
      type: 'action',
      organizationId: seed.orgB,
      approvalStatus: 'proposed',
      body: {
        action: {
          kind: 'create_task',
          summary: 'Create personal approved work',
          toolCall: {
            connection: 'docket',
            tool: 'create_task',
            toolUseId: 'toolu_personal',
            input: {
              orgId: seed.orgB,
              teamId: seed.teamB,
              title: 'Personal approved work',
            },
          },
        },
      },
    });

    const otherAttempt = await appFor(seed.other).request(
      `/sessions/${sessionId}/activity/${actionId}/approve`,
      { method: 'POST', headers: JSON_HEADERS, body: '{}' },
    );
    expect(otherAttempt.status).toBe(404);
    const approved = await appFor(seed.owner).request(
      `/sessions/${sessionId}/activity/${actionId}/approve`,
      { method: 'POST', headers: JSON_HEADERS, body: '{}' },
    );
    expect(approved.status).toBe(200);
    expect(
      await db
        .select({ id: schema.task.id })
        .from(schema.task)
        .where(
          and(
            eq(schema.task.organizationId, seed.orgB),
            eq(schema.task.title, 'Personal approved work'),
          ),
        ),
    ).toHaveLength(1);
  });

  it('uses the action workspace when the session-level shortcut approves, applies, and resumes', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
    const actionId = await seedActivity(sessionId, {
      type: 'action',
      organizationId: seed.orgB,
      approvalStatus: 'proposed',
      body: {
        action: {
          kind: 'create_task',
          summary: 'Create cross-workspace work',
          toolCall: {
            connection: 'docket',
            tool: 'create_task',
            toolUseId: 'toolu_session_shortcut',
            input: {
              orgId: seed.orgB,
              teamId: seed.teamB,
              title: 'Cross-workspace approved work',
            },
          },
        },
      },
    });
    await db
      .update(schema.agentSession)
      .set({ startedAt: new Date() })
      .where(eq(schema.agentSession.id, sessionId));
    await db.insert(schema.agentSessionTranscript).values({
      sessionId,
      ownerUserId: seed.owner.userId,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_session_shortcut',
              name: 'create_task',
              input: {
                orgId: seed.orgB,
                teamId: seed.teamB,
                title: 'Cross-workspace approved work',
              },
            },
          ],
        },
      ],
    });
    mockCompletion('Cross-workspace work created', 1);

    const approved = await appFor(seed.owner).request(`/sessions/${sessionId}/approve`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });

    expect(approved.status).toBe(200);
    expect((await approved.json()) as { status: string }).toMatchObject({ status: 'completed' });
    expect(
      await db
        .select({ id: schema.task.id })
        .from(schema.task)
        .where(
          and(
            eq(schema.task.organizationId, seed.orgB),
            eq(schema.task.title, 'Cross-workspace approved work'),
          ),
        ),
    ).toHaveLength(1);
    expect((await loadApproval(actionId)).approvalStatus).toBe('applied');
  });

  it('audits the owner in the action workspace when the session-level shortcut rejects', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
    const actionId = await seedActivity(sessionId, {
      type: 'action',
      organizationId: seed.orgB,
      approvalStatus: 'proposed',
      body: { action: { kind: 'create_task', summary: 'Do not create this task' } },
    });

    const rejected = await appFor(seed.owner).request(`/sessions/${sessionId}/reject`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });

    expect(rejected.status).toBe(200);
    expect((await rejected.json()) as { status: string }).toMatchObject({ status: 'canceled' });
    expect((await loadApproval(actionId)).approvalStatus).toBe('rejected');
    const audits = await db
      .select()
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.organizationId, seed.orgB),
          eq(schema.auditEvent.subjectId, sessionId),
          eq(schema.auditEvent.type, 'rejected'),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: seed.owner.actorIds[seed.orgB] });
    expect(audits[0]?.metadata).toMatchObject({
      activityId: actionId,
      approverActorId: seed.owner.actorIds[seed.orgB],
      executionOrigin: 'athena',
      athenaSessionId: sessionId,
      requestedByUserId: seed.owner.userId,
    });
  });
});

/** Load one activity's current approval status for proposal assertions. */
async function loadApproval(activityId: string) {
  return one(
    await db
      .select({ approvalStatus: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, activityId)),
  );
}
