import type * as AgentRuntimeModule from '@docket/athena/turn';
import type * as AuthzModule from '@docket/authz';
import type * as DbModule from '@docket/db';
import { and, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';
import type { getContainer as GetContainer } from '../../src/container';
import { onError } from '../../src/error';
import type meAthenaRouter from '../../src/routes/me-athena';
import {
  fakeSession,
  getDb,
  grantDocketPro,
  one,
  seedStatuses,
  type StatusIdLookup,
} from '../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentRuntime!: typeof AgentRuntimeModule;
let authz!: typeof AuthzModule;
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
  readonly statusA: StatusIdLookup;
}

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  agentRuntime = await import('@docket/athena/turn');
  authz = await import('@docket/authz');
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
  await Promise.all([grantDocketPro(db, schema, orgA), grantDocketPro(db, schema, orgB)]);
  const statusA = await seedStatuses(db, schema, orgA);
  await seedStatuses(db, schema, orgB);
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
    statusA,
  };
}

/** Give one test user the account invariant context-free personal Athena work relies on. */
async function seedPersonalWorkspace(person: Person): Promise<{
  readonly organizationId: string;
  readonly actorId: string;
}> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const organizationId = one(
    await db
      .insert(schema.organization)
      .values({
        name: 'Personal',
        slug: `personal-${suffix}`,
        isPersonal: true,
        lifecycleState: 'active',
      })
      .returning({ id: schema.organization.id }),
  ).id;
  // A real workspace is given its status set when it is created; this one is inserted straight
  // into the table, so the work the route creates here would have no status to point at.
  await seedStatuses(db, schema, organizationId);
  await grantDocketPro(db, schema, organizationId);
  await db.insert(schema.team).values({
    organizationId,
    name: 'Personal',
    key: `P${suffix.slice(-3)}`,
  });
  const roleId = one(
    await db
      .insert(schema.role)
      .values({
        organizationId,
        key: `owner-${suffix}`,
        name: 'Owner',
        capabilities: ['view', 'contribute'],
      })
      .returning({ id: schema.role.id }),
  ).id;
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({
        organizationId,
        kind: 'human',
        displayName: 'Owner',
        userId: person.userId,
        roleId,
      })
      .returning({ id: schema.actor.id }),
  ).id;
  await db.insert(schema.grant).values({
    organizationId,
    subjectKind: 'role',
    subjectId: roleId,
    resourceKind: 'organization',
    resourceId: organizationId,
    capabilities: ['view', 'contribute'],
    effect: 'allow',
  });
  return { organizationId, actorId };
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
  status: 'pending' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'completed' | 'canceled',
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
  it('refuses every route to a caller with no session', async () => {
    const app = new Hono<AppEnv>();
    app.route('/', meAthena);
    app.onError(onError);
    expect((await app.request('/')).status).toBe(401);
  });

  it('returns an empty overview for a brand-new caller with no Athena work at all', async () => {
    const seed = await seedPeople();
    const response = await appFor(seed.owner).request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      counts: { needsYou: 0, working: 0, finished: 0 },
      currentChat: null,
      sessions: { needsYou: [], working: [], finished: [] },
    });
  });

  it('lists the same grouped work under the plural /sessions alias', async () => {
    const seed = await seedPeople();
    const needsYou = await seedSession(seed, seed.owner, 'awaiting_input');
    const response = await appFor(seed.owner).request('/sessions');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Record<'needsYou' | 'working' | 'finished', { id: string }[]>;
    };
    expect(body.sessions.needsYou.map((row) => row.id)).toEqual([needsYou]);
  });

  it('rejects a history cursor whose embedded timestamp does not round-trip', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    const malformed = Buffer.from('activity|not-a-real-date|abc123', 'utf8').toString('base64url');
    const response = await appFor(seed.owner).request(
      `/sessions/${sessionId}/activity?cursor=${malformed}`,
    );
    expect(response.status).toBe(422);
  });

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

  it('derives a null objective from a textless first response, and a null context from a workspace-less session', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_input');
    // Empty text on the *first* response — the objective it seeds must be null, not "".
    await seedActivity(sessionId, {
      type: 'response',
      body: { text: '', author: 'user' },
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
    });
    // A later response on the *same* session carries a context — proves the per-session
    // metadata map merges into the entry the first loop already created, rather than
    // clobbering it.
    await seedActivity(sessionId, {
      type: 'response',
      body: { text: 'Following up', author: 'user', context: { workspaceId: seed.orgA } },
      createdAt: new Date('2026-07-15T12:00:01.000Z'),
    });

    const response = await appFor(seed.owner).request('/');
    const body = (await response.json()) as {
      sessions: {
        needsYou: { id: string; objective: string | null; context: unknown }[];
      };
    };
    const summary = body.sessions.needsYou.find((row) => row.id === sessionId);
    expect(summary?.objective).toBeNull();
    expect(summary?.context).toMatchObject({ workspaceId: seed.orgA });
  });

  it('derives a null objective for a session whose only carried context is on a non-response row', async () => {
    const seed = await seedPeople();
    const contextOnlySession = await seedSession(seed, seed.owner, 'awaiting_input');
    // No `response`-type row at all on this session — the context-bearing lookup has to match
    // it independently of the objective lookup, which finds nothing to seed a grouped entry
    // from first.
    await seedActivity(contextOnlySession, {
      type: 'elicitation',
      body: { text: 'Which one?', context: { workspaceId: seed.orgA } },
    });

    const response = await appFor(seed.owner).request('/');
    const body = (await response.json()) as {
      sessions: { needsYou: { id: string; objective: string | null; context: unknown }[] };
    };
    const summary = body.sessions.needsYou.find((row) => row.id === contextOnlySession);
    expect(summary?.objective).toBeNull();
    expect(summary?.context).toMatchObject({ workspaceId: seed.orgA });
  });

  it('shows a null context and workspace for work with no focus of its own in the overview', async () => {
    const seed = await seedPeople();
    const sessionId = one(
      await db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: seed.owner.userId,
          kind: 'job',
          trigger: 'delegation',
          status: 'awaiting_input',
        })
        .returning({ id: schema.agentSession.id }),
    ).id;

    const response = await appFor(seed.owner).request('/');
    const body = (await response.json()) as {
      sessions: { needsYou: { id: string; context: unknown; workspace: unknown }[] };
    };
    const summary = body.sessions.needsYou.find((row) => row.id === sessionId);
    expect(summary).toMatchObject({ context: null, workspace: null });
  });

  it('bounds active and finished history while batching many distinct display contexts', async () => {
    const seed = await seedPeople();
    const needs = await seedSession(seed, seed.owner, 'awaiting_input');
    const working = await seedSession(seed, seed.owner, 'running');
    const historicalChat = one(
      await db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          ownerUserId: seed.owner.userId,
          contextOrganizationId: seed.orgA,
          kind: 'chat',
          trigger: 'delegation',
          status: 'pending',
          initiatorId: seed.owner.actorIds[seed.orgA],
          createdAt: new Date('2020-01-01T00:00:00.000Z'),
        })
        .returning({ id: schema.agentSession.id }),
    ).id;
    await seedActivity(needs, { type: 'response', body: { text: 'Need input' } });
    await seedActivity(working, { type: 'response', body: { text: 'Still working' } });
    await db.insert(schema.sessionActivity).values(
      Array.from({ length: 200 }, (_, index) => ({
        sessionId: working,
        organizationId: null,
        type: 'thought' as const,
        body: { text: `Unbounded activity ${index}` },
      })),
    );
    const activeProjectStatusId = seed.statusA('project', 'active');
    const projects = await db
      .insert(schema.project)
      .values(
        Array.from({ length: 30 }, (_, index) => ({
          organizationId: seed.orgA,
          name: `Context project ${String(index)}`,
          status: 'active' as const,
          statusId: activeProjectStatusId,
          createdBy: seed.owner.actorIds[seed.orgA],
        })),
      )
      .returning({ id: schema.project.id });
    const contextualSessions = await db
      .insert(schema.agentSession)
      .values(
        Array.from({ length: 105 }, () => ({
          executorKind: 'athena' as const,
          ownerUserId: seed.owner.userId,
          contextOrganizationId: seed.orgA,
          kind: 'job' as const,
          trigger: 'delegation' as const,
          status: 'running' as const,
          initiatorId: seed.owner.actorIds[seed.orgA],
        })),
      )
      .returning({ id: schema.agentSession.id });
    await db.insert(schema.sessionActivity).values(
      projects.map((project, index) => ({
        sessionId: assertDefined(contextualSessions[index]).id,
        organizationId: null,
        type: 'response' as const,
        body: {
          text: `Contextual work ${String(index)}`,
          context: {
            workspaceId: seed.orgA,
            source: { type: 'project' as const, id: project.id },
          },
        },
      })),
    );
    for (let index = 0; index < 55; index += 1) {
      const finished = await seedSession(seed, seed.owner, 'completed');
      await seedActivity(finished, { type: 'response', body: { text: `Finished ${index}` } });
    }
    const client = Reflect.get(db, '$client') as {
      query: (...args: unknown[]) => Promise<unknown>;
    };
    const query = vi.spyOn(client, 'query');

    const response = await appFor(seed.owner).request('/');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      counts: { needsYou: number; working: number; finished: number };
      currentChat: { id: string } | null;
      sessions: Record<'needsYou' | 'working' | 'finished', { id: string }[]>;
    };
    expect(body.counts).toEqual({ needsYou: 1, working: 107, finished: 55 });
    expect(body.currentChat?.id).toBe(historicalChat);
    expect(body.sessions.needsYou.length + body.sessions.working.length).toBeLessThanOrEqual(100);
    expect(body.sessions.working.map((row) => row.id)).not.toContain(historicalChat);
    expect(body.sessions.finished).toHaveLength(50);
    expect(query.mock.calls.length).toBeLessThanOrEqual(16);
  });

  it('keeps older Needs-you work discoverable through lane-scoped cursors', async () => {
    const seed = await seedPeople();
    const base = new Date('2026-07-16T12:00:00.000Z');
    const needsYou = await Promise.all(
      ['awaiting_input', 'awaiting_approval', 'awaiting_input'].map(async (status, index) => {
        const id = await seedSession(
          seed,
          seed.owner,
          status as 'awaiting_input' | 'awaiting_approval',
        );
        await db
          .update(schema.agentSession)
          .set({ createdAt: new Date(base.getTime() + index * 1_000) })
          .where(eq(schema.agentSession.id, id));
        await seedActivity(id, {
          type: status === 'awaiting_approval' ? 'action' : 'elicitation',
          body: { text: `Needs owner ${String(index)}` },
        });
        return id;
      }),
    );
    await seedSession(seed, seed.owner, 'running');

    const first = await appFor(seed.owner).request('/?limit=2');

    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      counts: { needsYou: number; working: number; finished: number };
      sessions: Record<'needsYou' | 'working' | 'finished', { id: string }[]>;
      nextCursors?: { needsYou?: string; working?: string; finished?: string };
    };
    expect(firstBody.counts.needsYou).toBe(3);
    expect(firstBody.sessions.needsYou.map(({ id }) => id)).toEqual([needsYou[2], needsYou[1]]);
    expect(firstBody.nextCursors?.needsYou).toEqual(expect.any(String));

    const cursor = firstBody.nextCursors?.needsYou;
    if (!cursor) throw new Error('Needs-you page did not return a cursor');
    const second = await appFor(seed.owner).request(
      `/?limit=2&needsYouCursor=${encodeURIComponent(cursor)}`,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      counts: { needsYou: number };
      sessions: { needsYou: { id: string }[] };
      nextCursors?: { needsYou?: string };
    };
    expect(secondBody.counts.needsYou).toBe(3);
    expect(secondBody.sessions.needsYou.map(({ id }) => id)).toEqual([needsYou[0]]);
    expect(secondBody.nextCursors?.needsYou).toBeUndefined();

    const wrongLane = await appFor(seed.owner).request(
      `/?limit=2&workingCursor=${encodeURIComponent(cursor)}`,
    );
    expect(wrongLane.status).toBe(422);
  });

  it('lists the current chat’s topic segments through its own route', async () => {
    const seed = await seedPeople();
    const app = appFor(seed.owner);
    await app.request('/chat', { method: 'GET' });
    const response = await app.request('/chat/segments');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [] });
  });

  it('searches the caller’s own conversations through its own route', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    await seedActivity(sessionId, {
      type: 'response',
      body: { text: 'Let’s review the launch checklist', author: 'user' },
    });

    const response = await appFor(seed.owner).request('/chat/search?q=checklist');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { sessionId: string }[] };
    expect(body.items.some((item) => item.sessionId === sessionId)).toBe(true);
  });

  it('returns compact pulse counts without personal session history', async () => {
    const seed = await seedPeople();
    await seedSession(seed, seed.owner, 'awaiting_approval');
    await seedSession(seed, seed.owner, 'running');
    await seedSession(seed, seed.owner, 'completed');

    const response = await appFor(seed.owner).request('/pulse');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ needsYou: 1, working: 1 });
  });

  it('sanitizes personal activity recursively at the server boundary', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    await seedActivity(sessionId, {
      type: 'action',
      approvalStatus: 'applied',
      body: {
        action: {
          kind: 'remote_tool',
          summary: 'Created the launch task',
          toolCall: {
            connection: 'sunsama',
            tool: 'create_task',
            toolUseId: 'provider-internal-id',
            input: {
              title: 'Launch task',
              nested: {
                apiKey: 'sk-private',
                safe: 'visible',
                deeper: { cookie: 'session-secret' },
              },
            },
          },
          result: { content: 'Created Launch task', isError: false, providerTrace: 'trace-secret' },
        },
        authorization: 'Bearer private',
      } as unknown as typeof schema.sessionActivity.$inferInsert.body,
    });
    await seedActivity(sessionId, {
      type: 'action',
      approvalStatus: 'applied',
      body: {
        action: {
          kind: 'remote_tool',
          summary: 'Processed the large import',
          toolCall: {
            connection: 'docket',
            tool: 'import',
            toolUseId: 'large-import',
            input: Object.fromEntries(
              Array.from({ length: 12 }, (_, index) => [`field${index}`, 'x'.repeat(600)]),
            ),
          },
          result: { content: 'opaque provider success', isError: false },
        },
      },
    });
    await seedActivity(sessionId, {
      type: 'error',
      body: { text: 'Provider exception sk-private', stack: 'private stack' },
    });

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}`);

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('Created the launch task');
    expect(serialized).toContain('Completed: Created the launch task');
    expect(serialized).toContain('[redacted]');
    expect(serialized).toContain('Technical input omitted because it was too large.');
    expect(serialized).toContain('Athena could not complete this step.');
    expect(serialized.length).toBeLessThan(12_000);
    expect(serialized).not.toContain('sk-private');
    expect(serialized).not.toContain('session-secret');
    expect(serialized).not.toContain('providerTrace');
    expect(serialized).not.toContain('private stack');
    expect(serialized).not.toContain('provider-internal-id');
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
          statusId: seed.statusA('project', 'active'),
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

  it('redacts canonical names when access is revoked between resolution and disclosure', async () => {
    const seed = await seedPeople();
    const projectId = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: seed.orgA,
          name: 'Private launch name',
          status: 'active',
          statusId: seed.statusA('project', 'active'),
          createdBy: seed.owner.actorIds[seed.orgA],
        })
        .returning({ id: schema.project.id }),
    ).id;
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    await seedActivity(sessionId, {
      type: 'response',
      body: {
        text: 'Review it',
        context: { workspaceId: seed.orgA, source: { type: 'project', id: projectId } },
      },
    });
    const originalCanActor = authz.canActor;
    const ownerActorId = seed.owner.actorIds[seed.orgA];
    if (!ownerActorId) throw new Error('owner actor was not seeded');
    let checks = 0;
    vi.spyOn(authz, 'canActor').mockImplementation(async (actorId, required, target, database) => {
      const result = await originalCanActor(actorId, required, target, database);
      checks += 1;
      if (checks === 1) {
        await db
          .update(schema.actor)
          .set({ status: 'suspended' })
          .where(eq(schema.actor.id, ownerActorId));
      }
      return result;
    });

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspace: { name: string } | null;
      context: { source?: { label: string } } | null;
    };
    expect(checks).toBe(1);
    expect(body.workspace).toBeNull();
    expect(body.context?.source?.label).toBe('Project');
    expect(JSON.stringify(body)).not.toContain('Private launch name');
    expect(JSON.stringify(body)).not.toContain('Alpha-');
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
          statusId: seed.statusA('project', 'active'),
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

    const overview = (await (await appFor(seed.owner).request('/')).json()) as {
      sessions: Record<'needsYou' | 'working' | 'finished', { id: string; context: unknown }[]>;
    };
    const overviewSession = [
      ...overview.sessions.needsYou,
      ...overview.sessions.working,
      ...overview.sessions.finished,
    ].find((session) => session.id === sessionId);
    expect(overviewSession).toMatchObject({
      context: { source: { type: 'project', id: projectId, label: 'Project' } },
    });
    expect(JSON.stringify(overviewSession)).not.toContain('Secret launch codename');
    expect(JSON.stringify(overviewSession)).not.toMatch(/Alpha-/);
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
          kind: 'capture',
          summary: 'Create draft work',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            toolUseId: 'toolu_edit',
            input: { orgId: seed.orgA, text: 'Draft' },
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
          input: { orgId: seed.orgA, text: 'Edited draft' },
        }),
      },
    );
    expect(edited.status).toBe(200);
    const rejected = await app.request(
      `/sessions/${proposalSession}/proposals/group_personal/decision`,
      { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ decision: 'rejected' }) },
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
          kind: 'capture',
          summary: 'Create retargeted work',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            toolUseId: 'toolu_retarget',
            input: { orgId: seed.orgA, text: 'Original target' },
          },
        },
      },
    });

    const edited = await app.request(`/sessions/${sessionId}/activity/${activityId}/proposal`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        input: { orgId: seed.orgB, text: 'Retargeted to Beta' },
      }),
    });
    expect(edited.status).toBe(200);
    const [stored] = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, activityId));
    expect(stored?.organizationId).toBe(seed.orgB);
    expect(stored?.body.action?.toolCall?.input).toMatchObject({ orgId: seed.orgB });

    const approved = await app.request(`/sessions/${sessionId}/activity/${activityId}/decision`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision: 'approved' }),
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
          kind: 'capture',
          summary: 'Keep original authority',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            toolUseId: 'toolu_denied_retarget',
            input: { orgId: seed.orgA, text: 'Original authority' },
          },
        },
      },
    });
    await db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(eq(schema.actor.id, assertDefined(seed.owner.actorIds[seed.orgB])));

    const missingTarget = await app.request(
      `/sessions/${sessionId}/activity/${activityId}/proposal`,
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ input: { text: 'No workspace' } }),
      },
    );
    expect(missingTarget.status).toBe(409);
    const inaccessible = await app.request(
      `/sessions/${sessionId}/activity/${activityId}/proposal`,
      {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          input: { orgId: seed.orgB, text: 'Inaccessible target' },
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
      text: 'Original authority',
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
              kind: 'capture',
              summary: `Mixed target ${String(index)}`,
              toolCall: {
                connection: 'docket',
                tool: 'capture',
                toolUseId: `toolu_group_${decision}_${String(index)}`,
                input: {
                  orgId: target.orgId,
                  text: `Mixed target ${String(index)}`,
                },
              },
            },
          },
        });
      }
      await db
        .update(schema.actor)
        .set({ status: 'suspended' })
        .where(eq(schema.actor.id, assertDefined(seed.owner.actorIds[seed.orgB])));

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
                kind: 'capture',
                summary: `Session target ${String(index)}`,
                toolCall: {
                  connection: 'docket',
                  tool: 'capture',
                  toolUseId: `toolu_session_${decision}_${String(index)}`,
                  input: {
                    orgId: target.orgId,
                    text: `Session target ${String(index)}`,
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
        .where(eq(schema.actor.id, assertDefined(seed.owner.actorIds[seed.orgB])));

      const response = await app.request(
        `/sessions/${sessionId}/activity/${assertDefined(activityIds[0])}/${decision}`,
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
            kind: 'capture',
            summary: `Audited target ${String(index)}`,
            toolCall: {
              connection: 'docket',
              tool: 'capture',
              toolUseId: `toolu_audit_${String(index)}`,
              input: {
                orgId: target.orgId,
                text: `Audited target ${String(index)}`,
              },
            },
          },
        },
      });
    }

    const response = await app.request(`/sessions/${sessionId}/proposals/${groupId}/decision`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision: 'approved' }),
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

  it('rejects canceled-session messages before mutating activity or transcript', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'canceled');
    const existingActivityId = await seedActivity(sessionId, {
      type: 'response',
      body: { text: 'Existing work', author: 'user' },
    });
    const existingMessages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'Existing work' }] },
    ];
    await db.insert(schema.agentSessionTranscript).values({
      sessionId,
      ownerUserId: seed.owner.userId,
      messages: existingMessages,
    });

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: 'This must not be persisted' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'conflict',
      title: 'That change conflicts with the current state.',
      status: 409,
    });
    const activities = await db
      .select({ id: schema.sessionActivity.id, body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, sessionId));
    expect(activities).toEqual([
      expect.objectContaining({
        id: existingActivityId,
        body: { text: 'Existing work', author: 'user' },
      }),
    ]);
    const [transcript] = await db
      .select({ messages: schema.agentSessionTranscript.messages })
      .from(schema.agentSessionTranscript)
      .where(eq(schema.agentSessionTranscript.sessionId, sessionId));
    expect(transcript?.messages).toEqual(existingMessages);
  });

  it('steers non-chat work directly, refocusing it onto the message’s new workspace', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'running');
    await db.insert(schema.agentSessionTranscript).values({
      sessionId,
      ownerUserId: seed.owner.userId,
      messages: [],
    });
    mockCompletion('Steered onto the new workspace');

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        body: 'Actually, work on this in the other workspace',
        context: { workspaceId: seed.orgB },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; context?: { workspaceId?: string } };
    expect(body.status).toBe('completed');
    expect(body.context?.workspaceId).toBe(seed.orgB);
    const [row] = await db
      .select({ contextOrganizationId: schema.agentSession.contextOrganizationId })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(row?.contextOrganizationId).toBe(seed.orgB);
  });

  it('synchronously runs pending or running personal work through /run', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'running');
    await db.insert(schema.agentSessionTranscript).values({
      sessionId,
      ownerUserId: seed.owner.userId,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Keep going' }] }],
    });
    mockCompletion('Ran to completion');

    const otherAttempt = await appFor(seed.other).request(`/sessions/${sessionId}/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    expect(otherAttempt.status).toBe(404);

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as { status: string }).toMatchObject({ status: 'completed' });
  });

  it('rejects Lattice assignment work before the personal runner can admit it', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'pending');
    await db
      .update(schema.agentSession)
      .set({ executionSurface: 'lattice' })
      .where(eq(schema.agentSession.id, sessionId));

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/run`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    });

    expect(response.status).toBe(409);
    expect(
      await db
        .select()
        .from(schema.agentSessionRun)
        .where(eq(schema.agentSessionRun.sessionId, sessionId)),
    ).toHaveLength(0);
  });

  it('rejects personal message, reply, and resume paths for Lattice sessions', async () => {
    const seed = await seedPeople();
    const ownerApp = appFor(seed.owner);
    const messageSession = await seedSession(seed, seed.owner, 'running');
    const replySession = await seedSession(seed, seed.owner, 'awaiting_input');
    const resumeSession = await seedSession(seed, seed.owner, 'awaiting_input');
    const elicitationId = await seedActivity(replySession, {
      type: 'elicitation',
      body: { text: 'Which task?', toolUseId: 'toolu_lattice_reply' },
    });
    await db
      .update(schema.agentSession)
      .set({ executionSurface: 'lattice' })
      .where(
        or(
          eq(schema.agentSession.id, messageSession),
          eq(schema.agentSession.id, replySession),
          eq(schema.agentSession.id, resumeSession),
        ),
      );
    const beforeMessage = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, messageSession));

    const messageResponse = await ownerApp.request(`/sessions/${messageSession}/messages`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: 'Do not enter the hosted runner' }),
    });
    const replyResponse = await ownerApp.request(
      `/sessions/${replySession}/activity/${elicitationId}/reply`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ body: 'Do not wake the hosted runner' }),
      },
    );
    const resumeResponse = await ownerApp.request(`/sessions/${resumeSession}/resume`, {
      method: 'POST',
    });

    expect(messageResponse.status).toBe(409);
    expect(replyResponse.status).toBe(409);
    expect(resumeResponse.status).toBe(409);
    expect(
      await db
        .select()
        .from(schema.sessionActivity)
        .where(eq(schema.sessionActivity.sessionId, messageSession)),
    ).toEqual(beforeMessage);
    expect(
      await db
        .select()
        .from(schema.agentSessionRun)
        .where(
          or(
            eq(schema.agentSessionRun.sessionId, messageSession),
            eq(schema.agentSessionRun.sessionId, replySession),
            eq(schema.agentSessionRun.sessionId, resumeSession),
          ),
        ),
    ).toHaveLength(0);
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

  it('paginates bounded activity windows that hand off exactly to SSE', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    const base = new Date('2026-07-15T12:00:00.000Z');
    await db.insert(schema.sessionActivity).values(
      Array.from({ length: 105 }, (_, index) => ({
        sessionId,
        organizationId: null,
        type: 'response' as const,
        body: { text: `Visible history ${String(index)}` },
        createdAt: new Date(base.getTime() + index * 1_000),
      })),
    );
    const app = appFor(seed.owner);

    const detailResponse = await app.request(`/sessions/${sessionId}?limit=10`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      activities: { id: string; body: { text?: string } }[];
      activityNextCursor?: string;
    };
    expect(detail.activities.map(({ body }) => body.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Visible history ${String(index + 95)}`),
    );
    expect(detail.activityNextCursor).toEqual(expect.any(String));

    const firstPage = (await (
      await app.request(`/sessions/${sessionId}/activity?limit=10`)
    ).json()) as {
      items: { id: string; body: { text?: string } }[];
      nextCursor?: string;
    };
    expect(firstPage.items).toEqual(detail.activities);
    expect(firstPage.nextCursor).toBe(detail.activityNextCursor);
    if (!firstPage.nextCursor) throw new Error('Activity page did not return a cursor');

    const olderResponse = await app.request(
      `/sessions/${sessionId}/activity?limit=10&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    expect(olderResponse.status).toBe(200);
    const older = (await olderResponse.json()) as {
      items: { id: string; body: { text?: string } }[];
    };
    expect(older.items.map(({ body }) => body.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Visible history ${String(index + 85)}`),
    );
    expect(
      (await app.request(`/sessions/${sessionId}/activity?limit=10&cursor=not-a-cursor`)).status,
    ).toBe(422);

    const liveId = await seedActivity(sessionId, {
      type: 'response',
      body: { text: 'Fresh incremental activity' },
      createdAt: new Date(base.getTime() + 105_000),
    });
    const stream = await app.request(`/sessions/${sessionId}/stream`, {
      headers: { 'last-event-id': assertDefined(detail.activities.at(-1)).id },
    });
    const streamBody = await stream.text();
    expect(streamBody).toContain(`id: ${liveId}`);
    expect(streamBody).not.toContain('Visible history 94');
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

  it('replays the full bounded window when a resumed Last-Event-ID matches no persisted activity', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    await seedActivity(sessionId, { type: 'response', body: { text: 'Only entry' } });

    const stream = await appFor(seed.owner).request(`/sessions/${sessionId}/stream`, {
      headers: { 'last-event-id': 'activity_never_persisted' },
    });

    expect(stream.status).toBe(200);
    const text = await stream.text();
    expect(text).toContain('Only entry');
  });

  it('bounds a stream opened without Last-Event-ID to the newest activity window', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'completed');
    const base = new Date('2026-07-15T12:00:00.000Z');
    await db.insert(schema.sessionActivity).values(
      Array.from({ length: 105 }, (_, index) => ({
        id: `initial_${String(index).padStart(3, '0')}`,
        sessionId,
        organizationId: null,
        type: 'response' as const,
        body: { text: `Initial history ${String(index)}` },
        createdAt: new Date(base.getTime() + index * 1_000),
      })),
    );

    const stream = await appFor(seed.owner).request(`/sessions/${sessionId}/stream`);
    const body = await stream.text();
    const replayedIds = [...body.matchAll(/^id: (initial_\d+)$/gm)].map((match) => match[1]);

    expect(replayedIds).toHaveLength(100);
    expect(replayedIds.at(0)).toBe('initial_005');
    expect(replayedIds.at(-1)).toBe('initial_104');
    expect(body).not.toContain('id: initial_000');
  });

  it('live-tails strictly after the persisted timestamp and id cursor', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'running');
    const createdAt = new Date('2026-07-15T12:00:00.000Z');
    await db.insert(schema.sessionActivity).values(
      Array.from({ length: 100 }, (_, index) => ({
        id: `history_${String(index).padStart(3, '0')}`,
        sessionId,
        organizationId: null,
        type: 'response' as const,
        body: { text: `Historical row ${String(index)}` },
        createdAt,
      })),
    );
    const client = Reflect.get(db, '$client') as {
      query: (...args: unknown[]) => Promise<unknown>;
    };
    const query = vi.spyOn(client, 'query');

    const stream = await appFor(seed.owner).request(`/sessions/${sessionId}/stream`, {
      headers: { 'last-event-id': 'history_099' },
    });
    const bodyPromise = stream.text();
    const freshId = await seedActivity(sessionId, {
      id: 'live_001',
      type: 'response',
      body: { text: 'New live row' },
      createdAt: new Date('2026-07-15T12:00:01.000Z'),
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
    await db
      .update(schema.agentSession)
      .set({ status: 'completed', endedAt: new Date() })
      .where(eq(schema.agentSession.id, sessionId));

    const body = await bodyPromise;
    expect(body).toContain(`id: ${freshId}`);
    expect(body).not.toContain('id: history_000');
    const orderedActivityReads = query.mock.calls
      .map(([statement]) => String(statement))
      .filter(
        (statement) =>
          statement.includes('session_activity') && statement.toLowerCase().includes('order by'),
      );
    expect(orderedActivityReads.length).toBeGreaterThan(0);
    expect(
      orderedActivityReads.every(
        (statement) => statement.includes('created_at') && statement.includes('>'),
      ),
    ).toBe(true);
  });

  it('stops polling once the client aborts a live-tailing stream', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'running');
    // Seeded so the initial replay has something to write immediately — otherwise the first
    // `read()` below would block on the (much later) heartbeat instead of proving the abort.
    await seedActivity(sessionId, { type: 'response', body: { text: 'Already in flight' } });
    const client = Reflect.get(db, '$client') as {
      query: (...args: unknown[]) => Promise<unknown>;
    };
    const controller = new AbortController();
    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = assertDefined(response.body).getReader();
    await reader.read();

    void reader.cancel();
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const queryCountAtAbort = vi.spyOn(client, 'query').mock.calls.length;
    // Give any still-in-flight poll iteration a moment to either exit or (if this regresses)
    // issue one more query; a strictly bounded count proves the loop actually stopped.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const queryCountAfterWait = vi.mocked(client.query).mock.calls.length;
    expect(queryCountAfterWait - queryCountAtAbort).toBeLessThanOrEqual(1);
  });

  it('writes a heartbeat comment when the poll loop goes quiet past the heartbeat interval', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'running');
    const originalNow = Date.now.bind(Date);
    const testStart = originalNow();
    // A global `Date.now` spy sees every call in the process, not just this route's — so it
    // can't key off "the Nth call". Keying off real elapsed time instead is robust to whatever
    // unrelated code (middleware, auth, drizzle) also reads the clock during setup: anything in
    // the first 200ms (request setup) sees the real clock, and everything after — including the
    // route's own `lastHeartbeat` init and its first poll's comparison — sees a jump 20s ahead,
    // so the very first poll iteration is already due for a heartbeat.
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      const real = originalNow();
      return real - testStart > 200 ? real + 20_000 : real;
    });

    const stream = await appFor(seed.owner).request(`/sessions/${sessionId}/stream`);
    const bodyPromise = stream.text();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await db
      .update(schema.agentSession)
      .set({ status: 'completed', endedAt: new Date() })
      .where(eq(schema.agentSession.id, sessionId));
    const body = await bodyPromise;

    nowSpy.mockRestore();
    expect(body).toContain(': heartbeat');
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
          kind: 'capture',
          summary: 'Create personal approved work',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            toolUseId: 'toolu_personal',
            input: {
              orgId: seed.orgB,
              text: 'Personal approved work',
            },
          },
        },
      },
    });

    const otherAttempt = await appFor(seed.other).request(
      `/sessions/${sessionId}/activity/${actionId}/decision`,
      { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ decision: 'approved' }) },
    );
    expect(otherAttempt.status).toBe(404);
    const approved = await appFor(seed.owner).request(
      `/sessions/${sessionId}/activity/${actionId}/decision`,
      { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ decision: 'approved' }) },
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
          kind: 'capture',
          summary: 'Create cross-workspace work',
          toolCall: {
            connection: 'docket',
            tool: 'capture',
            toolUseId: 'toolu_session_shortcut',
            input: {
              orgId: seed.orgB,
              text: 'Cross-workspace approved work',
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
                text: 'Cross-workspace approved work',
              },
            },
          ],
        },
      ],
    });
    mockCompletion('Cross-workspace work created', 1);

    const approved = await appFor(seed.owner).request(`/sessions/${sessionId}/decision`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision: 'approved' }),
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
      body: { action: { kind: 'capture', summary: 'Do not create this task' } },
    });

    const rejected = await appFor(seed.owner).request(`/sessions/${sessionId}/decision`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision: 'rejected' }),
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

  it('sends a fresh chat with no focus down the workspace-less fallback path', async () => {
    const seed = await seedPeople();
    const fresh = await appFor(seed.owner).request('/chat/new', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(fresh.status).toBe(200);
    expect((await fresh.json()) as { context: unknown }).toMatchObject({ context: null });
  });

  it('messages the current chat synchronously and reflects the settled reply', async () => {
    const seed = await seedPeople();
    const app = appFor(seed.owner);
    await app.request('/chat', { method: 'GET' });
    mockCompletion('Got it, on it now');

    const response = await app.request('/chat/messages', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: 'Please draft the agenda' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      activities: { body: { text?: string } }[];
    };
    expect(body.status).toBe('completed');
    expect(body.activities.some((activity) => activity.body.text === 'Got it, on it now')).toBe(
      true,
    );
  });

  it('defaults context-free personal work to the caller’s Personal workspace', async () => {
    const seed = await seedPeople();
    const personal = await seedPersonalWorkspace(seed.owner);
    mockCompletion('Appointment captured');

    const response = await appFor(seed.owner).request('/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ prompt: 'I need to create a dentist appointment' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      context: { workspaceId?: string } | null;
      activities: { body: { text?: string; author?: string } }[];
    };
    expect(body.context?.workspaceId).toBe(personal.organizationId);
    expect(body.activities.some((activity) => activity.body.text === 'Appointment captured')).toBe(
      true,
    );
    const [session] = await db
      .select({
        contextOrganizationId: schema.agentSession.contextOrganizationId,
        taskId: schema.agentSession.taskId,
      })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, body.id));
    expect(session?.contextOrganizationId).toBe(personal.organizationId);
    expect(session?.taskId).toBeTruthy();
    const [createdTask] = await db
      .select({ organizationId: schema.task.organizationId })
      .from(schema.task)
      .where(eq(schema.task.id, session?.taskId ?? ''));
    expect(createdTask?.organizationId).toBe(personal.organizationId);
  });

  it('keeps explicit workspace context authoritative over the Personal default', async () => {
    const seed = await seedPeople();
    mockCompletion('Shared work captured');

    const response = await appFor(seed.owner).request('/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: 'Prepare the team agenda',
        context: { workspaceId: seed.orgA },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      context: { workspaceId?: string } | null;
    };
    expect(body.context?.workspaceId).toBe(seed.orgA);
    const [session] = await db
      .select({
        contextOrganizationId: schema.agentSession.contextOrganizationId,
        taskId: schema.agentSession.taskId,
      })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, body.id));
    expect(session?.contextOrganizationId).toBe(seed.orgA);
    const [createdTask] = await db
      .select({ organizationId: schema.task.organizationId })
      .from(schema.task)
      .where(eq(schema.task.id, session?.taskId ?? ''));
    expect(createdTask?.organizationId).toBe(seed.orgA);
  });

  it('does not create tracked Athena work after a shared workspace loses Docket Pro', async () => {
    const seed = await seedPeople();
    await db
      .delete(schema.organizationProductEntitlement)
      .where(eq(schema.organizationProductEntitlement.organizationId, seed.orgA));
    const tasksBefore = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.organizationId, seed.orgA));

    const response = await appFor(seed.owner).request('/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: 'This must remain read only',
        context: { workspaceId: seed.orgA },
      }),
    });

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ code: 'product_required' });
    expect(
      await db
        .select({ id: schema.task.id })
        .from(schema.task)
        .where(eq(schema.task.organizationId, seed.orgA)),
    ).toEqual(tasksBefore);
  });

  it('returns a recoverable conflict when context-free work has no Personal workspace', async () => {
    const seed = await seedPeople();

    const response = await appFor(seed.owner).request('/sessions', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ prompt: 'I need to create a dentist appointment' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      status: 409,
      code: 'conflict',
      title: 'That change conflicts with the current state.',
    });
  });

  it('refuses to approve or reject the latest action when none is proposed', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'running');
    const approve = await appFor(seed.owner).request(`/sessions/${sessionId}/decision`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(approve.status).toBe(409);
    const reject = await appFor(seed.owner).request(`/sessions/${sessionId}/decision`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ decision: 'rejected' }),
    });
    expect(reject.status).toBe(409);
  });

  it('parks a message sent to work that is awaiting approval instead of resuming it', async () => {
    const seed = await seedPeople();
    const sessionId = await seedSession(seed, seed.owner, 'awaiting_approval');
    await seedActivity(sessionId, {
      type: 'action',
      organizationId: seed.orgA,
      approvalStatus: 'proposed',
      body: { action: { kind: 'capture', summary: 'Still pending your decision' } },
    });
    await db.insert(schema.agentSessionTranscript).values({
      sessionId,
      ownerUserId: seed.owner.userId,
      messages: [],
    });

    const response = await appFor(seed.owner).request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ body: 'Any update?' }),
    });

    expect(response.status).toBe(200);
    const [row] = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    // Still awaiting approval — a steering message never resumes gated work on its own.
    expect(row?.status).toBe('awaiting_approval');
  });

  describe('sessions with no workspace focus of their own (contextOrganizationId null)', () => {
    /** Insert a caller-owned session with no workspace focus of its own. */
    async function seedContextlessSession(
      seed: Seed,
      status: 'pending' | 'running' | 'awaiting_approval',
    ): Promise<string> {
      return one(
        await db
          .insert(schema.agentSession)
          .values({
            executorKind: 'athena',
            ownerUserId: seed.owner.userId,
            kind: 'job',
            trigger: 'delegation',
            status,
          })
          .returning({ id: schema.agentSession.id }),
      ).id;
    }

    /** Insert an owner-authored transcript turn plus a scripted completion for it to resume. */
    async function primeForResume(sessionId: string, seed: Seed): Promise<void> {
      await db.insert(schema.agentSessionTranscript).values({
        sessionId,
        ownerUserId: seed.owner.userId,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Keep going' }] }],
      });
      mockCompletion('Resumed with no workspace of its own');
    }

    it('runs contextless pending work through /run using the fallback workspace', async () => {
      const seed = await seedPeople();
      const sessionId = await seedContextlessSession(seed, 'running');
      await primeForResume(sessionId, seed);

      const response = await appFor(seed.owner).request(`/sessions/${sessionId}/run`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{}',
      });
      expect(response.status).toBe(200);
      expect((await response.json()) as { status: string }).toMatchObject({ status: 'completed' });
    });

    it('approves a single contextless proposed action through the fallback workspace', async () => {
      const seed = await seedPeople();
      const sessionId = await seedContextlessSession(seed, 'awaiting_approval');
      const actionId = await seedActivity(sessionId, {
        type: 'action',
        organizationId: seed.orgA,
        approvalStatus: 'proposed',
        body: { action: { kind: 'capture', summary: 'Contextless approve target' } },
      });

      const response = await appFor(seed.owner).request(
        `/sessions/${sessionId}/activity/${actionId}/decision`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ decision: 'approved' }) },
      );
      expect(response.status).toBe(200);
      expect((await loadApproval(actionId)).approvalStatus).toBe('applied');
    });

    it('rejects a single contextless proposed action through the fallback workspace', async () => {
      const seed = await seedPeople();
      const sessionId = await seedContextlessSession(seed, 'awaiting_approval');
      const actionId = await seedActivity(sessionId, {
        type: 'action',
        organizationId: seed.orgA,
        approvalStatus: 'proposed',
        body: { action: { kind: 'capture', summary: 'Contextless reject target' } },
      });

      const response = await appFor(seed.owner).request(
        `/sessions/${sessionId}/activity/${actionId}/decision`,
        { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ decision: 'rejected' }) },
      );
      expect(response.status).toBe(200);
      expect((await loadApproval(actionId)).approvalStatus).toBe('rejected');
    });

    it('approves a contextless proposal group through the fallback workspace', async () => {
      const seed = await seedPeople();
      const sessionId = await seedContextlessSession(seed, 'awaiting_approval');
      const groupId = 'group_contextless_approve';
      const actionId = await seedActivity(sessionId, {
        type: 'action',
        organizationId: seed.orgA,
        approvalStatus: 'proposed',
        proposalGroupId: groupId,
        body: { action: { kind: 'capture', summary: 'Contextless group approve target' } },
      });

      const response = await appFor(seed.owner).request(
        `/sessions/${sessionId}/proposals/${groupId}/decision`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ decision: 'approved' }),
        },
      );
      expect(response.status).toBe(200);
      expect((await loadApproval(actionId)).approvalStatus).toBe('applied');
    });

    it('rejects a contextless proposal group through the fallback workspace', async () => {
      const seed = await seedPeople();
      const sessionId = await seedContextlessSession(seed, 'awaiting_approval');
      const groupId = 'group_contextless_reject';
      const actionId = await seedActivity(sessionId, {
        type: 'action',
        organizationId: seed.orgA,
        approvalStatus: 'proposed',
        proposalGroupId: groupId,
        body: { action: { kind: 'capture', summary: 'Contextless group reject target' } },
      });

      const response = await appFor(seed.owner).request(
        `/sessions/${sessionId}/proposals/${groupId}/decision`,
        {
          method: 'PUT',
          headers: JSON_HEADERS,
          body: JSON.stringify({ decision: 'rejected' }),
        },
      );
      expect(response.status).toBe(200);
      expect((await loadApproval(actionId)).approvalStatus).toBe('rejected');
    });

    it('resumes contextless awaiting-input work through the fallback workspace', async () => {
      const seed = await seedPeople();
      const sessionId = await seedContextlessSession(seed, 'pending');
      await db
        .update(schema.agentSession)
        .set({ status: 'awaiting_input' })
        .where(eq(schema.agentSession.id, sessionId));
      await primeForResume(sessionId, seed);

      const response = await appFor(seed.owner).request(`/sessions/${sessionId}/resume`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      expect((await response.json()) as { status: string }).toMatchObject({ status: 'completed' });
    });

    it('approves the latest contextless action through the session-level shortcut', async () => {
      const seed = await seedPeople();
      const sessionId = await seedContextlessSession(seed, 'awaiting_approval');
      const actionId = await seedActivity(sessionId, {
        type: 'action',
        organizationId: seed.orgA,
        approvalStatus: 'proposed',
        body: { action: { kind: 'capture', summary: 'Contextless shortcut approve' } },
      });

      const response = await appFor(seed.owner).request(`/sessions/${sessionId}/decision`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ decision: 'approved' }),
      });
      expect(response.status).toBe(200);
      expect((await loadApproval(actionId)).approvalStatus).toBe('applied');
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
