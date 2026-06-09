/**
 * `@docket/api` — quick-capture route (`POST /v1/orgs/:orgId/capture`).
 *
 * @remarks
 * The hybrid Home prompt box's default path: freeform text → a task assigned to the
 * caller, attached to the current cycle when one covers today, in the default team's
 * first workflow state. Exercised against the real Hono router + an injected actor
 * context (mirroring agent-flows.test.ts).
 */
import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  db as DbType,
  organization as OrgTable,
  team as TeamTable,
  actor as ActorTable,
  cycle as CycleTable,
  task as TaskTable,
} from '@docket/db';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type captureRouter from '../../src/routes/capture';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let db!: typeof DbType;
let organization!: typeof OrgTable;
let team!: typeof TeamTable;
let actor!: typeof ActorTable;
let cycle!: typeof CycleTable;
let task!: typeof TaskTable;
let capture!: typeof captureRouter;

/** Mount the capture router behind an injected actor context with the given capabilities. */
function appFor(orgId: string, capabilities: readonly string[], actorId = 'actor_test') {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = { orgId, actorId, roleId: 'role_test', capabilities };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', capture);
  app.onError(onError);
  return app;
}

beforeAll(async () => {
  const dbmod = await import('@docket/db');
  db = dbmod.db;
  organization = dbmod.organization;
  team = dbmod.team;
  actor = dbmod.actor;
  cycle = dbmod.cycle;
  task = dbmod.task;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  capture = (await import('../../src/routes/capture')).default;
});

interface Seed {
  readonly orgId: string;
  readonly teamId: string;
  readonly humanActorId: string;
}

/** Seed an org with a default team and a human actor; returns their ids. */
async function seedOrg(): Promise<Seed> {
  const slug = `cap-${Math.random().toString(36).slice(2, 10)}`;
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

  return { orgId, teamId, humanActorId: human!.id };
}

/** Insert a cycle window for the team; returns its id. */
async function seedCycle(s: Seed, startsAt: Date, endsAt: Date, number = 1): Promise<string> {
  const [row] = await db
    .insert(cycle)
    .values({
      organizationId: s.orgId,
      teamId: s.teamId,
      number,
      startsAt,
      endsAt,
      createdBy: s.humanActorId,
    })
    .returning({ id: cycle.id });
  return row!.id;
}

describe('POST /capture', () => {
  it('requires contribute (403 for a view-only member)', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['view'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'plan outreach strategy' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects empty text', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('creates a task from text: title derived, assignee = caller, full text as description', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'plan outreach strategy' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      teamId: string;
      assigneeId: string | null;
      state: string;
    };
    expect(body.title).toBe('plan outreach strategy');
    expect(body.teamId).toBe(s.teamId);
    expect(body.assigneeId).toBe(s.humanActorId);
    // The default team's first workflow state (the seeded `backlog`).
    expect(body.state).toBe('backlog');

    const rows = await db.select().from(task).where(eq(task.id, body.id)).limit(1);
    expect(rows[0]?.description).toBe('plan outreach strategy');
    expect(rows[0]?.source).toBe('native');
    expect(rows[0]?.createdBy).toBe(s.humanActorId);
  });

  it('derives the title from the first non-empty line and caps long one-liners', async () => {
    const s = await seedOrg();
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);

    const multiline = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '\n  Draft the Q3 plan  \nwith all the details here' }),
    });
    const multilineBody = (await multiline.json()) as { id: string; title: string };
    expect(multilineBody.title).toBe('Draft the Q3 plan');
    // The full multi-line text is retained as the description.
    const mlRow = await db.select().from(task).where(eq(task.id, multilineBody.id)).limit(1);
    expect(mlRow[0]?.description).toContain('with all the details here');

    const longText = 'x'.repeat(300);
    const long = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: longText }),
    });
    const longBody = (await long.json()) as { title: string };
    expect(longBody.title.length).toBeLessThanOrEqual(120);
    expect(longBody.title.endsWith('…')).toBe(true);
  });

  it('attaches the current cycle when a window covers today', async () => {
    const s = await seedOrg();
    const now = Date.now();
    await seedCycle(s, new Date(now - 86_400_000), new Date(now + 86_400_000));
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'capture into the live cycle' }),
    });
    const body = (await res.json()) as { id: string };
    const rows = await db.select().from(task).where(eq(task.id, body.id)).limit(1);
    expect(rows[0]?.cycleId).not.toBeNull();
  });

  it('leaves cycleId null when no cycle window covers today', async () => {
    const s = await seedOrg();
    // A cycle entirely in the past — today is outside its window.
    await seedCycle(s, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-14T00:00:00.000Z'));
    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'no live cycle' }),
    });
    const body = (await res.json()) as { id: string };
    const rows = await db.select().from(task).where(eq(task.id, body.id)).limit(1);
    expect(rows[0]?.cycleId).toBeNull();
  });

  it('only resolves a cycle on the capture team (cross-team window does not attach)', async () => {
    const s = await seedOrg();
    // A second team with a covering cycle must NOT be attached to the default team's task.
    const [otherTeam] = await db
      .insert(team)
      .values({ organizationId: s.orgId, name: 'Other', key: 'OTHER' })
      .returning({ id: team.id });
    const now = Date.now();
    await db.insert(cycle).values({
      organizationId: s.orgId,
      teamId: otherTeam!.id,
      number: 1,
      startsAt: new Date(now - 86_400_000),
      endsAt: new Date(now + 86_400_000),
      createdBy: s.humanActorId,
    });

    const app = appFor(s.orgId, ['contribute'], s.humanActorId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'lands on the default team' }),
    });
    const body = (await res.json()) as { id: string; teamId: string };
    // It landed on the oldest (default) team, which has no covering cycle.
    expect(body.teamId).toBe(s.teamId);
    const rows = await db
      .select()
      .from(task)
      .where(and(eq(task.id, body.id), eq(task.organizationId, s.orgId)))
      .limit(1);
    expect(rows[0]?.cycleId).toBeNull();
  });
});
