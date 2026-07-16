import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as AgentRuntimeModule from '@docket/agent-runtime';
import type { ProposalGroupOut } from '@docket/types';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import type { getContainer as GetContainer } from '../../src/container';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
process.env['AGENT_MAX_TURNS'] = '8';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let agentRuntime!: typeof AgentRuntimeModule;
let agentSessions!: typeof agentSessionsRouter;
let getContainer!: typeof GetContainer;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  agentRuntime = await import('@docket/agent-runtime');
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
  ({ getContainer } = await import('../../src/container'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const J = { 'content-type': 'application/json' };

interface Seed {
  orgId: string;
  teamId: string;
  humanActorId: string;
}

/** Seed an org + team + authorized human owner. */
async function seedOrg(): Promise<Seed> {
  const slug = `pr-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  const [role] = await db
    .insert(schema.role)
    .values({
      organizationId: org!.id,
      key: `owner-${slug}`,
      name: 'Owner',
      capabilities: ['view', 'contribute', 'assign'],
    })
    .returning({ id: schema.role.id });
  const [human] = await db
    .insert(schema.actor)
    .values({
      organizationId: org!.id,
      kind: 'human',
      displayName: 'Ada',
      userId: u!.id,
      roleId: role!.id,
    })
    .returning({ id: schema.actor.id });
  await db.insert(schema.grant).values({
    organizationId: org!.id,
    subjectKind: 'role',
    subjectId: role!.id,
    resourceKind: 'organization',
    resourceId: org!.id,
    capabilities: ['view', 'contribute', 'assign'],
    effect: 'allow',
  });
  const [team] = await db
    .insert(schema.team)
    .values({ organizationId: org!.id, name: 'Core', key: 'CORE' })
    .returning({ id: schema.team.id });
  return { orgId: org!.id, teamId: team!.id, humanActorId: human!.id };
}

/** Mount the sessions router behind an injected actor context. */
function appFor(orgId: string, actorId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = {
      orgId,
      actorId,
      roleId: 'role_test',
      capabilities: ['view', 'contribute', 'assign'],
    };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', agentSessions);
  app.onError(onError);
  return app;
}

/** Route the container's turn runtime at a scripted mock for the duration of a test. */
function scriptTurns(script: readonly AgentRuntimeModule.ScriptedTurn[]): void {
  const runtime = new agentRuntime.MockAgentTurnRuntime({ script });
  vi.spyOn(getContainer().agentTurn, 'streamTurn').mockImplementation((input) =>
    runtime.streamTurn(input),
  );
}

/** A batched three-create import script (the firehose-onboarding shape). */
function importScript(seed: Seed): readonly AgentRuntimeModule.ScriptedTurn[] {
  const create = (id: string, title: string) => ({
    type: 'tool_use' as const,
    id,
    name: 'create_task',
    input: { orgId: seed.orgId, teamId: seed.teamId, title },
  });
  return [
    {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I read 3 backlog items. Proposing them as one batch.' },
          create('toolu_im_1', 'Send the contractor agreement'),
          create('toolu_im_2', 'Book the venue for the offsite'),
          create('toolu_im_3', 'Reply to the partnership email'),
        ],
      },
      stopReason: 'tool_use',
    },
    {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Imported 3 tasks from your backlog.' }],
      },
      stopReason: 'end_turn',
    },
  ];
}

async function orgTasks(orgId: string): Promise<{ title: string }[]> {
  return db
    .select({ title: schema.task.title })
    .from(schema.task)
    .where(eq(schema.task.organizationId, orgId))
    .orderBy(asc(schema.task.createdAt));
}

describe('the batch proposal flow (import-shaped)', () => {
  it('proposes a batch, projects ghosts, honors edits + subset approval, and lands the rest', async () => {
    const seed = await seedOrg();
    scriptTurns(importScript(seed));
    const app = appFor(seed.orgId, seed.humanActorId);

    // 1) The prompt-door session pauses on the batched proposal.
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ prompt: 'Import my Sunsama backlog' }),
    });
    expect(created.status).toBe(200);
    const session = (await created.json()) as { id: string; status: string };
    expect(session.status).toBe('awaiting_approval');
    expect(await orgTasks(seed.orgId)).toHaveLength(0);

    // 2) The ghost projection: one group of three editable task ghosts.
    const listed = await app.request(`/${session.id}/proposals`, { method: 'GET' });
    expect(listed.status).toBe(200);
    const groups = (await listed.json()) as ProposalGroupOut[];
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.items).toHaveLength(3);
    expect(group.items.map((i) => i.ghost?.title)).toEqual([
      'Send the contractor agreement',
      'Book the venue for the offsite',
      'Reply to the partnership email',
    ]);

    // 3) Inline ghost edit: retitle the third proposal before blessing it.
    const third = group.items[2]!;
    const patched = await app.request(`/${session.id}/activity/${third.activityId}/proposal`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({
        input: { ...third.input, title: 'Reply to the partnership email (priority)' },
      }),
    });
    expect(patched.status).toBe(200);

    // 4) Approve a subset: two land, one stays proposed, the session stays parked.
    const subset = await app.request(`/${session.id}/proposals/${group.proposalGroupId}/approve`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        activityIds: [group.items[0]!.activityId, group.items[1]!.activityId],
      }),
    });
    expect(subset.status).toBe(200);
    expect(((await subset.json()) as { status: string }).status).toBe('awaiting_approval');
    expect((await orgTasks(seed.orgId)).map((t) => t.title)).toEqual([
      'Send the contractor agreement',
      'Book the venue for the offsite',
    ]);

    // 5) Approve the remainder: the EDITED input executes and the session completes.
    const rest = await app.request(`/${session.id}/proposals/${group.proposalGroupId}/approve`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({}),
    });
    expect(rest.status).toBe(200);
    expect(((await rest.json()) as { status: string }).status).toBe('completed');
    expect((await orgTasks(seed.orgId)).map((t) => t.title)).toContain(
      'Reply to the partnership email (priority)',
    );
  });

  it('rejecting the whole group lands nothing and the agent adapts to completion', async () => {
    const seed = await seedOrg();
    scriptTurns(importScript(seed));
    const app = appFor(seed.orgId, seed.humanActorId);

    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ prompt: 'Import my Sunsama backlog' }),
    });
    const session = (await created.json()) as { id: string };
    const listed = await app.request(`/${session.id}/proposals`, { method: 'GET' });
    const groups = (await listed.json()) as ProposalGroupOut[];

    const rejected = await app.request(
      `/${session.id}/proposals/${groups[0]!.proposalGroupId}/reject`,
      { method: 'POST', headers: J, body: JSON.stringify({}) },
    );
    expect(rejected.status).toBe(200);
    // Reject-and-continue: the agent hears three vetoes and finishes without retrying.
    expect(((await rejected.json()) as { status: string }).status).toBe('completed');
    expect(await orgTasks(seed.orgId)).toHaveLength(0);
  });

  it('404s a decision on a group with no proposed members', async () => {
    const seed = await seedOrg();
    scriptTurns(importScript(seed));
    const app = appFor(seed.orgId, seed.humanActorId);
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ prompt: 'Import my Sunsama backlog' }),
    });
    const session = (await created.json()) as { id: string };
    const res = await app.request(`/${session.id}/proposals/does-not-exist/approve`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('refuses to edit a proposal that is no longer pending', async () => {
    const seed = await seedOrg();
    scriptTurns(importScript(seed));
    const app = appFor(seed.orgId, seed.humanActorId);
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ prompt: 'Import my Sunsama backlog' }),
    });
    const session = (await created.json()) as { id: string };
    const groups = (await (
      await app.request(`/${session.id}/proposals`, { method: 'GET' })
    ).json()) as ProposalGroupOut[];
    const group = groups[0]!;
    await app.request(`/${session.id}/proposals/${group.proposalGroupId}/approve`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({}),
    });

    const res = await app.request(
      `/${session.id}/activity/${group.items[0]!.activityId}/proposal`,
      { method: 'PATCH', headers: J, body: JSON.stringify({ input: { title: 'x' } }) },
    );
    expect(res.status).toBe(409);
  });
});

describe('SSE live tail', () => {
  it('replays history, honors Last-Event-ID, and closes once the session is terminal', async () => {
    const seed = await seedOrg();
    scriptTurns(importScript(seed));
    const app = appFor(seed.orgId, seed.humanActorId);
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ prompt: 'Import my Sunsama backlog' }),
    });
    const session = (await created.json()) as { id: string };
    const groups = (await (
      await app.request(`/${session.id}/proposals`, { method: 'GET' })
    ).json()) as ProposalGroupOut[];
    await app.request(`/${session.id}/proposals/${groups[0]!.proposalGroupId}/approve`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({}),
    });

    // Terminal session: full replay, then the stream ends (no infinite tail).
    const stream = await app.request(`/${session.id}/stream`, { method: 'GET' });
    expect(stream.status).toBe(200);
    const text = await stream.text();
    expect(text).toContain('event: action');
    expect(text).toContain('event: response');

    // Last-Event-ID resume: replaying from the final activity id yields no duplicates.
    const activities = await db
      .select({ id: schema.sessionActivity.id })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, session.id))
      .orderBy(asc(schema.sessionActivity.id));
    const lastId = activities.at(-1)!.id;
    const resumed = await app.request(`/${session.id}/stream`, {
      method: 'GET',
      headers: { 'last-event-id': lastId },
    });
    const resumedText = await resumed.text();
    expect(resumedText).not.toContain(`id: ${lastId}`);
  });
});
