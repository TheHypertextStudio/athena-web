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

/** Script one provider completion so synchronous personal routes settle deterministically. */
function mockCompletion(text = 'Done'): void {
  const runtime = new agentRuntime.MockAgentTurnRuntime({
    script: [
      {
        message: { role: 'assistant', content: [{ type: 'text', text }] },
        stopReason: 'end_turn',
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
      context: { workspaceId?: string; source?: { type: string; id: string } };
    };
    expect(body.context).toEqual({
      workspaceId: seed.orgA,
      source: { type: 'project', id: projectId },
    });
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

  it('owner-scopes activity, SSE replay, steering, and lifecycle controls', async () => {
    const seed = await seedPeople();
    const replaySession = await seedSession(seed, seed.owner, 'completed');
    const first = await seedActivity(replaySession, { type: 'response', body: { text: 'First' } });
    const second = await seedActivity(replaySession, {
      type: 'response',
      body: { text: 'Second' },
    });
    const sessionId = await seedSession(seed, seed.owner, 'running');
    const ownerApp = appFor(seed.owner);
    const otherApp = appFor(seed.other);

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
      (await ownerApp.request(`/sessions/${sessionId}/cancel`, { method: 'POST' })).status,
    ).toBe(200);
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
