/**
 * `@docket/api` — agent-sessions review-surface tests (api-rpc-contract §3.11).
 *
 * @remarks
 * Covers the activity-scoped review API added on top of the run/replay surface:
 * `GET /:id/activity`, `POST /:id/activity/:activityId/{approve,reject,reply}`, and
 * the lifecycle transitions `POST /:id/{pause,resume,cancel}`. Exercises happy paths
 * plus edge cases: not-found, capability-denied, tenant isolation, illegal-state
 * conflicts, and invalid input. Runs against an in-memory pglite database with an
 * injected actor context (no Better Auth in the loop).
 */
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  db as DbType,
  organization as OrgTable,
  team as TeamTable,
  actor as ActorTable,
  agent as AgentTable,
  task as TaskTable,
  agentSession as AgentSessionTable,
  sessionActivity as SessionActivityTable,
  auditEvent as AuditEventTable,
} from '@docket/db';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import { getMigratedDb } from '../support/db';

let db!: typeof DbType;
let organization!: typeof OrgTable;
let team!: typeof TeamTable;
let actor!: typeof ActorTable;
let agent!: typeof AgentTable;
let task!: typeof TaskTable;
let agentSession!: typeof AgentSessionTable;
let sessionActivity!: typeof SessionActivityTable;
let auditEvent!: typeof AuditEventTable;
let agentSessions!: typeof agentSessionsRouter;

/** Mount the router behind an injected actor context with the given capabilities. */
function appFor(orgId: string, capabilities: readonly string[], actorId = 'actor_test') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = { orgId, actorId, roleId: 'role_test', capabilities };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', agentSessions);
  app.onError(onError);
  return app;
}

/** Convenience POST with an empty JSON body. */
function post(app: ReturnType<typeof appFor>, path: string, body: unknown = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const dbmod = await getMigratedDb();
  db = dbmod.db;
  organization = dbmod.organization;
  team = dbmod.team;
  actor = dbmod.actor;
  agent = dbmod.agent;
  task = dbmod.task;
  agentSession = dbmod.agentSession;
  sessionActivity = dbmod.sessionActivity;
  auditEvent = dbmod.auditEvent;
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
});

/** Seeded ids for a self-contained org fixture. */
interface Seed {
  readonly orgId: string;
  readonly teamId: string;
  readonly humanActorId: string;
  readonly agentId: string;
  readonly agentActorId: string;
  readonly taskId: string;
}

/** Seed an org with a team, a human actor, an agent (actor + agent row), and a task. */
async function seedOrg(): Promise<Seed> {
  const slug = `rev-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: organization.id });
  const orgId = org!.id;

  const [t] = await db
    .insert(team)
    .values({ organizationId: orgId, name: 'Core', key: 'CORE' })
    .returning({ id: team.id });
  const teamId = t!.id;

  const [human] = await db
    .insert(actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: actor.id });
  const humanActorId = human!.id;

  const [agentActor] = await db
    .insert(actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
    .returning({ id: actor.id });
  const agentActorId = agentActor!.id;

  const [ag] = await db
    .insert(agent)
    .values({ organizationId: orgId, actorId: agentActorId, createdBy: humanActorId })
    .returning({ id: agent.id });
  const agentId = ag!.id;

  const [tk] = await db
    .insert(task)
    .values({
      organizationId: orgId,
      title: 'Ship the Hub',
      teamId,
      state: 'todo',
      createdBy: humanActorId,
    })
    .returning({ id: task.id });
  const taskId = tk!.id;

  return { orgId, teamId, humanActorId, agentId, agentActorId, taskId };
}

/** Insert an agent session in the given status for the seeded fixture. */
async function seedSession(
  s: Seed,
  status: 'pending' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'completed' = 'pending',
): Promise<string> {
  const [row] = await db
    .insert(agentSession)
    .values({
      organizationId: s.orgId,
      agentId: s.agentId,
      taskId: s.taskId,
      trigger: 'assignment',
      status,
      initiatorId: s.humanActorId,
    })
    .returning({ id: agentSession.id });
  return row!.id;
}

/** Insert one activity row and return its id. */
async function seedActivity(
  sessionId: string,
  orgId: string,
  values: {
    type: 'thought' | 'action' | 'response' | 'elicitation' | 'error';
    body: Record<string, unknown>;
    approvalStatus?: 'proposed' | 'approved' | 'rejected' | 'applied';
  },
): Promise<string> {
  const [row] = await db
    .insert(sessionActivity)
    .values({
      sessionId,
      organizationId: orgId,
      type: values.type,
      body: values.body,
      ...(values.approvalStatus ? { approvalStatus: values.approvalStatus } : {}),
    })
    .returning({ id: sessionActivity.id });
  return row!.id;
}

describe('GET /:id/activity', () => {
  it('returns the ordered activity stream for a session', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s);
    await seedActivity(sessionId, s.orgId, { type: 'thought', body: { text: 'first' } });
    await seedActivity(sessionId, s.orgId, {
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'move' } },
      approvalStatus: 'proposed',
    });

    const app = appFor(s.orgId, ['view']);
    const res = await app.request(`/${sessionId}/activity`, { method: 'GET' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: { type: string; approvalStatus: unknown }[] };
    expect(json.items.map((a) => a.type)).toEqual(['thought', 'action']);
    expect(json.items[1]?.approvalStatus).toBe('proposed');
  });

  it('404s for an unknown session', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['view']);
    const res = await app.request('/sess_missing/activity', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it("hides another org's session (tenant isolation)", async () => {
    const owner = await seedOrg();
    const intruder = await seedOrg();
    const sessionId = await seedSession(owner);
    const app = appFor(intruder.orgId, ['view']);
    const res = await app.request(`/${sessionId}/activity`, { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/activity/:activityId/approve', () => {
  it('requires assign (403 for a contribute-only member)', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_approval');
    const activityId = await seedActivity(sessionId, s.orgId, {
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'move' } },
      approvalStatus: 'proposed',
    });
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/activity/${activityId}/approve`);
    expect(res.status).toBe(403);
  });

  it('applies the action, writes an approved audit event, and advances the session to running', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_approval');
    const activityId = await seedActivity(sessionId, s.orgId, {
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'move' } },
      approvalStatus: 'proposed',
    });
    const app = appFor(s.orgId, ['assign'], s.humanActorId);

    const res = await post(app, `/${sessionId}/activity/${activityId}/approve`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; approvalStatus: string };
    expect(json.approvalStatus).toBe('applied');

    const sessionRows = await db
      .select({ status: agentSession.status })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    expect(sessionRows[0]?.status).toBe('running');

    const audits = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.subjectId, sessionId), eq(auditEvent.organizationId, s.orgId)));
    const approvedAudit = audits.find((audit) => audit.type === 'approved');
    expect(approvedAudit).toBeDefined();
    expect(approvedAudit?.actorId).toBe(s.agentActorId);
    expect(approvedAudit?.initiatorId).toBe(s.humanActorId);
    expect(approvedAudit?.metadata).toMatchObject({
      activityId,
      approverActorId: s.humanActorId,
    });
  });

  it('with scope=all_in_session applies every proposed action in one call', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_approval');
    const first = await seedActivity(sessionId, s.orgId, {
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'a' } },
      approvalStatus: 'proposed',
    });
    await seedActivity(sessionId, s.orgId, {
      type: 'action',
      body: { action: { kind: 'comment', summary: 'b' } },
      approvalStatus: 'proposed',
    });
    const app = appFor(s.orgId, ['assign'], s.humanActorId);

    const res = await post(app, `/${sessionId}/activity/${first}/approve`, {
      scope: 'all_in_session',
    });
    expect(res.status).toBe(200);

    const actions = await db
      .select()
      .from(sessionActivity)
      .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'action')))
      .orderBy(asc(sessionActivity.createdAt));
    expect(actions.map((a) => a.approvalStatus)).toEqual(['applied', 'applied']);

    const sessionRows = await db
      .select({ status: agentSession.status })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    expect(sessionRows[0]?.status).toBe('running');
  });

  it('409s when the targeted activity is not a proposed action', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_approval');
    const thoughtId = await seedActivity(sessionId, s.orgId, {
      type: 'thought',
      body: { text: 'just thinking' },
    });
    const app = appFor(s.orgId, ['assign']);
    const res = await post(app, `/${sessionId}/activity/${thoughtId}/approve`);
    expect(res.status).toBe(409);
  });

  it('404s when the activity belongs to a different session', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_approval');
    const other = await seedSession(s, 'awaiting_approval');
    const otherActivity = await seedActivity(other, s.orgId, {
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'x' } },
      approvalStatus: 'proposed',
    });
    const app = appFor(s.orgId, ['assign']);
    const res = await post(app, `/${sessionId}/activity/${otherActivity}/approve`);
    expect(res.status).toBe(404);
  });

  it('404s for an unknown session', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['assign']);
    const res = await post(app, `/sess_missing/activity/act_missing/approve`);
    expect(res.status).toBe(404);
  });
});

describe('POST /:id/activity/:activityId/reject', () => {
  it('rejects the action, writes a rejected audit event, and returns the session to running', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_approval');
    const activityId = await seedActivity(sessionId, s.orgId, {
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'move' } },
      approvalStatus: 'proposed',
    });
    const app = appFor(s.orgId, ['assign'], s.humanActorId);

    const res = await post(app, `/${sessionId}/activity/${activityId}/reject`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { approvalStatus: string }).approvalStatus).toBe('rejected');

    const sessionRows = await db
      .select({ status: agentSession.status, endedAt: agentSession.endedAt })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    expect(sessionRows[0]?.status).toBe('running');
    expect(sessionRows[0]?.endedAt).toBeNull();

    const audits = await db
      .select({ type: auditEvent.type })
      .from(auditEvent)
      .where(eq(auditEvent.subjectId, sessionId));
    expect(audits[0]?.type).toBe('rejected');
  });

  it('requires assign (403 for a view-only member)', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_approval');
    const activityId = await seedActivity(sessionId, s.orgId, {
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'move' } },
      approvalStatus: 'proposed',
    });
    const app = appFor(s.orgId, ['view']);
    const res = await post(app, `/${sessionId}/activity/${activityId}/reject`);
    expect(res.status).toBe(403);
  });
});

describe('POST /:id/activity/:activityId/reply', () => {
  it('appends a response and resumes an awaiting_input session', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_input');
    const elicitId = await seedActivity(sessionId, s.orgId, {
      type: 'elicitation',
      body: { text: 'Which milestone?' },
    });
    const app = appFor(s.orgId, ['contribute']);

    const res = await post(app, `/${sessionId}/activity/${elicitId}/reply`, {
      body: 'The Q3 launch milestone',
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { type: string; body: { text: string } };
    expect(json.type).toBe('response');
    expect(json.body.text).toBe('The Q3 launch milestone');

    const sessionRows = await db
      .select({ status: agentSession.status })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    expect(sessionRows[0]?.status).toBe('running');

    const responses = await db
      .select()
      .from(sessionActivity)
      .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'response')));
    expect(responses).toHaveLength(1);
  });

  it('does not change status when the session is not awaiting input', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'running');
    const elicitId = await seedActivity(sessionId, s.orgId, {
      type: 'elicitation',
      body: { text: 'still?' },
    });
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/activity/${elicitId}/reply`, { body: 'yes' });
    expect(res.status).toBe(200);

    const sessionRows = await db
      .select({ status: agentSession.status })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    expect(sessionRows[0]?.status).toBe('running');
  });

  it('409s when replying to a non-elicitation activity', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'running');
    const thoughtId = await seedActivity(sessionId, s.orgId, {
      type: 'thought',
      body: { text: 'hm' },
    });
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/activity/${thoughtId}/reply`, { body: 'x' });
    expect(res.status).toBe(409);
  });

  it('requires contribute (403 for a view-only member)', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_input');
    const elicitId = await seedActivity(sessionId, s.orgId, {
      type: 'elicitation',
      body: { text: '?' },
    });
    const app = appFor(s.orgId, ['view']);
    const res = await post(app, `/${sessionId}/activity/${elicitId}/reply`, { body: 'x' });
    expect(res.status).toBe(403);
  });

  it('422s on an empty reply body', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_input');
    const elicitId = await seedActivity(sessionId, s.orgId, {
      type: 'elicitation',
      body: { text: '?' },
    });
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/activity/${elicitId}/reply`, { body: '' });
    expect(res.status).toBe(422);
  });

  it('404s when the elicitation is not found', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_input');
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/activity/act_missing/reply`, { body: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('lifecycle transitions', () => {
  it('pause moves a running session to awaiting_input', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'running');
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/pause`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('awaiting_input');
  });

  it('pause 409s when the session is not running', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'pending');
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/pause`);
    expect(res.status).toBe(409);
  });

  it('resume moves an awaiting_input session to running', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'awaiting_input');
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/resume`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('running');
  });

  it('resume 409s when the session is not awaiting input', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'running');
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/resume`);
    expect(res.status).toBe(409);
  });

  it('cancel moves a non-terminal session to canceled and stamps endedAt', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'running');
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/cancel`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string; endedAt: string | null }).status).toBe(
      'canceled',
    );

    const sessionRows = await db
      .select({ endedAt: agentSession.endedAt })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId));
    expect(sessionRows[0]?.endedAt).not.toBeNull();
  });

  it('cancel 409s when the session is already terminal', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'completed');
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/${sessionId}/cancel`);
    expect(res.status).toBe(409);
  });

  it('requires contribute (403 for a view-only member)', async () => {
    const s = await seedOrg();
    const sessionId = await seedSession(s, 'running');
    const app = appFor(s.orgId, ['view']);
    const res = await post(app, `/${sessionId}/cancel`);
    expect(res.status).toBe(403);
  });

  it('404s for an unknown session', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute']);
    const res = await post(app, `/sess_missing/cancel`);
    expect(res.status).toBe(404);
  });
});
