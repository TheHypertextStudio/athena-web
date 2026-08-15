/**
 * `agent-sessions` router branch-coverage top-up.
 *
 * @remarks
 * `tests/routes/agent-sessions-review.test.ts` covers the activity-review surface; this file
 * closes three narrower gaps it (and the rest of the suite) never reaches: refocusing an existing
 * chat session onto a different workspace, editing a proposal on a REGISTERED (non-Athena)
 * session, and rejecting an entire proposal batch (`scope: 'all_in_session'`) through the
 * activity-scoped decision route.
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import { fakeSession, getDb, one, seedStatuses, seedUserWithHub } from '../support/routes-harness';

let db!: typeof DbModule.db;
let schema!: typeof DbModule;
let agentSessions!: typeof agentSessionsRouter;

function appFor(orgId: string, capabilities: readonly string[], actorId: string, userId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    const ctx: ActorCtx = { orgId, actorId, roleId: 'role_test', capabilities };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', agentSessions);
  app.onError(onError);
  return app;
}

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
});

interface Seed {
  readonly orgId: string;
  readonly teamId: string;
  readonly humanActorId: string;
  readonly agentId: string;
  readonly taskId: string;
}

async function seedOrg(): Promise<Seed> {
  const slug = `sess-branch-${Math.random().toString(36).slice(2, 10)}`;
  const orgId = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  ).id;
  const statusId = await seedStatuses(db, schema, orgId);
  const teamId = one(
    await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Core', key: `C${slug.slice(-4).toUpperCase()}` })
      .returning({ id: schema.team.id }),
  ).id;
  const humanActorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentActorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Runner' })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentId = one(
    await db
      .insert(schema.agent)
      .values({ organizationId: orgId, actorId: agentActorId, createdBy: humanActorId })
      .returning({ id: schema.agent.id }),
  ).id;
  const taskId = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Ship the Hub',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
      })
      .returning({ id: schema.task.id }),
  ).id;
  return { orgId, teamId, humanActorId, agentId, taskId };
}

async function seedRegisteredSession(
  s: Seed,
  status: 'awaiting_approval' = 'awaiting_approval',
): Promise<string> {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        organizationId: s.orgId,
        agentId: s.agentId,
        taskId: s.taskId,
        trigger: 'assignment',
        status,
        initiatorId: s.humanActorId,
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
}

async function seedProposedAction(
  sessionId: string,
  orgId: string,
  summary: string,
  toolCall?: {
    readonly connection: string;
    readonly tool: string;
    readonly input: unknown;
    readonly toolUseId: string;
  },
): Promise<string> {
  return one(
    await db
      .insert(schema.sessionActivity)
      .values({
        sessionId,
        organizationId: orgId,
        type: 'action',
        body: {
          action: {
            kind: 'update_task',
            summary,
            ...(toolCall ? { toolCall } : {}),
          },
        },
        approvalStatus: 'proposed',
      })
      .returning({ id: schema.sessionActivity.id }),
  ).id;
}

describe('GET /chat — refocusing an existing thread onto a new workspace', () => {
  it('updates contextOrganizationId when the caller switches workspace between calls', async () => {
    const userId = await seedUserWithHub(db, schema, 'ChatRefocus');
    const first = await seedOrg();
    const second = await seedOrg();
    const firstActorId = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: first.orgId, kind: 'human', displayName: 'Caller' })
        .returning({ id: schema.actor.id }),
    ).id;
    const secondActorId = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: second.orgId, kind: 'human', displayName: 'Caller' })
        .returning({ id: schema.actor.id }),
    ).id;
    const app = appFor(first.orgId, ['view'], firstActorId, userId);

    const firstRes = await app.request('/chat');
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as { id: string };

    const secondApp = appFor(second.orgId, ['view'], secondActorId, userId);
    const secondRes = await secondApp.request('/chat');
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as { id: string };

    // Same persistent chat thread, refocused onto the new workspace.
    expect(secondBody.id).toBe(firstBody.id);
    const rows = await db
      .select({ contextOrganizationId: schema.agentSession.contextOrganizationId })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, firstBody.id));
    expect(rows[0]?.contextOrganizationId).toBe(second.orgId);
  });
});

describe('PATCH /:id/activity/:activityId/proposal — registered-agent path', () => {
  it('edits a pending proposal on a registered (non-Athena) session', async () => {
    const s = await seedOrg();
    const sessionId = await seedRegisteredSession(s);
    const activityId = await seedProposedAction(sessionId, s.orgId, 'original', {
      connection: 'docket',
      tool: 'update_task',
      toolUseId: 'tool-use-1',
      input: { title: 'Original title' },
    });
    const app = appFor(s.orgId, ['assign'], s.humanActorId, `user_${s.humanActorId}`);

    const res = await app.request(`/${sessionId}/activity/${activityId}/proposal`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { title: 'Edited title' } }),
    });

    expect(res.status).toBe(200);
    const rows = await db
      .select({ body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, activityId));
    const body = rows[0]?.body as { action: { toolCall?: { input?: { title?: string } } } };
    expect(body.action.toolCall?.input?.title).toBe('Edited title');
  });
});

describe('PUT /:id/activity/:activityId/decision — rejecting with scope=all_in_session', () => {
  it('rejects every still-proposed action in the session, not just the named one', async () => {
    const s = await seedOrg();
    const sessionId = await seedRegisteredSession(s);
    const named = await seedProposedAction(sessionId, s.orgId, 'first');
    const other = await seedProposedAction(sessionId, s.orgId, 'second');
    const app = appFor(s.orgId, ['assign'], s.humanActorId, `user_${s.humanActorId}`);

    const res = await app.request(`/${sessionId}/activity/${named}/decision`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected', scope: 'all_in_session' }),
    });
    expect(res.status).toBe(200);

    const rows = await db
      .select({ id: schema.sessionActivity.id, status: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'action'),
        ),
      );
    expect(rows.map((row) => row.status).sort()).toEqual(['rejected', 'rejected']);
    expect(rows.map((row) => row.id).sort()).toEqual([named, other].sort());

    // Activity-scoped rejection is "reject-and-continue": the session resumes to `running` so
    // the agent hears the veto as an error result and adapts, unlike the session-level
    // `/:id/reject` shortcut which ends the run.
    const sessionRow = await db
      .select({ status: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, sessionId));
    expect(sessionRow[0]?.status).toBe('running');
  });
});
