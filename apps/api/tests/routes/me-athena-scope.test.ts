import type * as DbModule from '@docket/db';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type meAthenaRouter from '../../src/routes/me-athena';
import { fakeSession, getDb, grantDocketPro, one } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let meAthena!: typeof meAthenaRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  meAthena = (await import('../../src/routes/me-athena')).default;
});

/** One person who belongs to two workspaces. */
interface TwoWorkspaces {
  readonly userId: string;
  readonly orgA: string;
  readonly orgB: string;
}

/** Create a workspace the person is a member of, with Docket Pro. */
async function seedMembership(userId: string, label: string, suffix: string): Promise<string> {
  const orgId = one(
    await db
      .insert(schema.organization)
      .values({ name: `${label}-${suffix}`, slug: `${label}-${suffix}`, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  ).id;
  await grantDocketPro(db, schema, orgId);
  const roleId = one(
    await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: `member-${suffix}`,
        name: 'Member',
        capabilities: ['view'],
      })
      .returning({ id: schema.role.id }),
  ).id;
  await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Owner', userId, roleId });
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'role',
    subjectId: roleId,
    resourceKind: 'organization',
    resourceId: orgId,
    capabilities: ['view'],
    effect: 'allow',
  });
  return orgId;
}

async function seedTwoWorkspaces(): Promise<TwoWorkspaces> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const userId = one(
    await db
      .insert(schema.user)
      .values({ name: 'Owner', email: `scope-${suffix}@example.com` })
      .returning({ id: schema.user.id }),
  ).id;
  await db.insert(schema.hub).values({ userId });
  return {
    userId,
    orgA: await seedMembership(userId, 'alpha', suffix),
    orgB: await seedMembership(userId, 'beta', suffix),
  };
}

/** Insert one piece of the person's delegated work, started in `orgId`. */
async function seedJob(
  userId: string,
  orgId: string,
  status: 'running' | 'awaiting_approval' | 'completed',
): Promise<string> {
  return one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId: userId,
        contextOrganizationId: orgId,
        kind: 'job',
        trigger: 'delegation',
        status,
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
}

function appFor(userId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    await next();
  });
  app.route('/', meAthena);
  app.onError(onError);
  return app;
}

/** The overview fields these tests read. */
interface OverviewBody {
  readonly counts: {
    readonly needsYou: number;
    readonly working: number;
    readonly finished: number;
  };
  readonly sessions: Record<
    'needsYou' | 'working' | 'finished',
    readonly { readonly id: string }[]
  >;
}

describe('personal Athena overview, scoped to a workspace', () => {
  it('lists and counts only the work started in the named workspace', async () => {
    const seed = await seedTwoWorkspaces();
    const waitingA = await seedJob(seed.userId, seed.orgA, 'awaiting_approval');
    const finishedA = await seedJob(seed.userId, seed.orgA, 'completed');
    await seedJob(seed.userId, seed.orgB, 'running');
    await seedJob(seed.userId, seed.orgB, 'awaiting_approval');

    const response = await appFor(seed.userId).request(`/?workspaceId=${seed.orgA}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as OverviewBody;
    expect(body.counts).toEqual({ needsYou: 1, working: 0, finished: 1 });
    expect(body.sessions.needsYou.map((row) => row.id)).toEqual([waitingA]);
    expect(body.sessions.working).toEqual([]);
    expect(body.sessions.finished.map((row) => row.id)).toEqual([finishedA]);
  });

  it('keeps every workspace in the overview when no workspace is named', async () => {
    const seed = await seedTwoWorkspaces();
    await seedJob(seed.userId, seed.orgA, 'awaiting_approval');
    await seedJob(seed.userId, seed.orgB, 'awaiting_approval');

    const response = await appFor(seed.userId).request('/sessions');

    expect(response.status).toBe(200);
    const body = (await response.json()) as OverviewBody;
    expect(body.counts.needsYou).toBe(2);
    expect(body.sessions.needsYou).toHaveLength(2);
  });
});
