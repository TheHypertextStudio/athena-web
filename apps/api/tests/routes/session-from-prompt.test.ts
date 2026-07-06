/**
 * `@docket/api` — create-and-run-from-prompt session path
 * (`POST /v1/orgs/:orgId/sessions`) + the lazy default-agent helper.
 *
 * @remarks
 * The hybrid Home prompt box's "ask Athena to plan" escalation: a freeform prompt
 * becomes a session bound to the org's default agent (lazily created on first use) and
 * is run against the mock {@link import('@docket/agent-runtime').AgentRuntime}. Asserts the
 * default agent is materialized once (idempotent), the prompt is persisted as the
 * session's opening `response` activity, and the session runs through to the gate.
 */
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  db as DbType,
  organization as OrgTable,
  team as TeamTable,
  actor as ActorTable,
  agent as AgentTable,
  agentSession as AgentSessionTable,
  sessionActivity as SessionActivityTable,
} from '@docket/db';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type { getContainer as GetContainer } from '../../src/container';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import type { ensureDefaultAgent as EnsureDefaultAgent } from '../../src/lib/default-agent';
import { getMigratedDb } from '../support/db';

let db!: typeof DbType;
let organization!: typeof OrgTable;
let team!: typeof TeamTable;
let actor!: typeof ActorTable;
let agent!: typeof AgentTable;
let agentSession!: typeof AgentSessionTable;
let sessionActivity!: typeof SessionActivityTable;
let agentSessions!: typeof agentSessionsRouter;
let ensureDefaultAgent!: typeof EnsureDefaultAgent;
let DEFAULT_AGENT_NAME!: string;
let getContainer!: typeof GetContainer;

/** Mount the sessions router behind an injected actor context with the given capabilities. */
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

beforeAll(async () => {
  const dbmod = await getMigratedDb();
  db = dbmod.db;
  organization = dbmod.organization;
  team = dbmod.team;
  actor = dbmod.actor;
  agent = dbmod.agent;
  agentSession = dbmod.agentSession;
  sessionActivity = dbmod.sessionActivity;
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
  const helperMod = await import('../../src/lib/default-agent');
  ensureDefaultAgent = helperMod.ensureDefaultAgent;
  DEFAULT_AGENT_NAME = helperMod.DEFAULT_AGENT_NAME;
  getContainer = (await import('../../src/container')).getContainer;
});

interface Seed {
  readonly orgId: string;
  readonly humanActorId: string;
}

/** Seed an org with a team and a human actor (no agent — the default is created lazily). */
async function seedOrg(): Promise<Seed> {
  const slug = `sfp-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: organization.id });
  const orgId = org!.id;
  await db.insert(team).values({ organizationId: orgId, name: 'Core', key: 'CORE' });
  const [human] = await db
    .insert(actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: actor.id });
  return { orgId, humanActorId: human!.id };
}

describe('ensureDefaultAgent', () => {
  it('lazily materializes the default agent (actor + agent row) on first call', async () => {
    const s = await seedOrg();
    const before = await db.select().from(agent).where(eq(agent.organizationId, s.orgId));
    expect(before).toHaveLength(0);

    const resolved = await ensureDefaultAgent(s.orgId, s.humanActorId);
    expect(resolved.displayName).toBe(DEFAULT_AGENT_NAME);

    const agents = await db.select().from(agent).where(eq(agent.organizationId, s.orgId));
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(resolved.id);
    expect(agents[0]?.createdBy).toBe(s.humanActorId);

    const agentActor = await db
      .select()
      .from(actor)
      .where(and(eq(actor.organizationId, s.orgId), eq(actor.kind, 'agent')))
      .limit(1);
    expect(agentActor[0]?.displayName).toBe(DEFAULT_AGENT_NAME);
  });

  it('is idempotent: a second call returns the same agent without creating a duplicate', async () => {
    const s = await seedOrg();
    const first = await ensureDefaultAgent(s.orgId, s.humanActorId);
    const second = await ensureDefaultAgent(s.orgId, s.humanActorId);
    expect(second.id).toBe(first.id);
    const agents = await db.select().from(agent).where(eq(agent.organizationId, s.orgId));
    expect(agents).toHaveLength(1);
  });
});

describe('POST /sessions (create + run from a freeform prompt)', () => {
  it('requires contribute (403 for a view-only member)', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['view'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'plan outreach strategy' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects an empty prompt', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('binds to the lazily-created default agent, persists the prompt, and runs the session', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'plan outreach strategy' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; agentId: string };
    // The scripted mock session ends holding the approval gate.
    expect(body.status).toBe('awaiting_approval');

    // The default agent was materialized and the session is bound to it.
    const agents = await db.select().from(agent).where(eq(agent.organizationId, s.orgId));
    expect(agents).toHaveLength(1);
    expect(body.agentId).toBe(agents[0]?.id);

    // The prompt is the session's opening `response` activity, followed by the scripted
    // stream (thought → action → elicitation → response).
    const activities = await db
      .select()
      .from(sessionActivity)
      .where(eq(sessionActivity.sessionId, body.id))
      .orderBy(asc(sessionActivity.createdAt));
    expect(activities[0]?.type).toBe('response');
    expect(activities[0]?.body).toMatchObject({ text: 'plan outreach strategy' });
    expect(activities.slice(1).map((a) => a.type)).toEqual([
      'thought',
      'action',
      'elicitation',
      'response',
    ]);

    // The session is task-less; the prompt is its brief.
    const session = await db
      .select()
      .from(agentSession)
      .where(eq(agentSession.id, body.id))
      .limit(1);
    expect(session[0]?.taskId).toBeNull();
    expect(session[0]?.initiatorId).toBe(s.humanActorId);
  });

  it('threads the freeform prompt through to the runtime as the task brief', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    // Spy on the boundary runtime to capture the brief the wiring passes to startSession.
    const spy = vi.spyOn(getContainer().agentRuntime, 'startSession');
    try {
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'plan the launch roadmap' }),
      });
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      // The prompt — not the session id — is the runtime task brief (the threading fix).
      expect(spy.mock.calls[0]?.[0]?.task).toBe('plan the launch roadmap');
      expect(spy.mock.calls[0]?.[0]?.agent).toBe(DEFAULT_AGENT_NAME);
    } finally {
      spy.mockRestore();
    }
  });

  it('binds to an explicit agentId when supplied', async () => {
    const s = await seedOrg();
    const [agentActor] = await db
      .insert(actor)
      .values({ organizationId: s.orgId, kind: 'agent', displayName: 'Custom' })
      .returning({ id: actor.id });
    const [ag] = await db
      .insert(agent)
      .values({ organizationId: s.orgId, actorId: agentActor!.id, createdBy: s.humanActorId })
      .returning({ id: agent.id });

    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'do the thing', agentId: ag!.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agentId: string };
    expect(body.agentId).toBe(ag!.id);
    // No default agent was created — the explicit one was used.
    const named = await db
      .select()
      .from(actor)
      .where(and(eq(actor.organizationId, s.orgId), eq(actor.displayName, DEFAULT_AGENT_NAME)));
    expect(named).toHaveLength(0);
  });

  it('404s when the supplied agentId is not a registered agent in the org', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'x', agentId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
    });
    expect(res.status).toBe(404);
  });
});
