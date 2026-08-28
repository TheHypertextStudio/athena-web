import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type { AppEnv, AuthSession } from '../../src/context';
import { onError } from '../../src/error';
import {
  appWithActor as mountActorApp,
  appWithSession,
  clearDocketPro,
  fakeSession,
  getDb,
  grantDocketPro,
  one,
  seedBaseOrg,
  seedStatuses,
} from '../support/routes-harness';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import type dailyPlanRouter from '../../src/routes/daily-plan';
import type hubRouter from '../../src/routes/hub';
import type orgsRouter from '../../src/routes/orgs';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let orgs!: typeof orgsRouter;
let notifications!: unknown;
let dailyPlan!: typeof dailyPlanRouter;
let hub!: typeof hubRouter;
let agentSessions!: typeof agentSessionsRouter;

/** Preserve anonymous harness cases while authenticating the session compatibility router. */
function appWithActor(
  router: unknown,
  orgId: string,
  capabilities: readonly string[],
  actorId = 'actor_test',
  session?: AuthSession,
) {
  const resolvedSession =
    session === undefined && router === agentSessions
      ? fakeSession(`user_${actorId}`)
      : (session ?? null);
  return mountActorApp(router, orgId, capabilities, actorId, resolvedSession);
}

beforeAll(async () => {
  const { env } = await import('../../src/env');
  Reflect.set(env, 'BILLING_ENABLED', false);
  schema = await getDb();
  db = schema.db;
  orgs = (await import('../../src/routes/orgs')).default;
  const { NotificationInboxService } = await import('../../src/services/notifications/inbox');
  const { NotificationIntentService } =
    await import('../../src/services/notifications/intent-service');
  const { createNotificationsRoutes } = await import('../../src/routes/notifications');
  notifications = createNotificationsRoutes(
    new NotificationInboxService(db),
    new NotificationIntentService(db),
  );
  dailyPlan = (await import('../../src/routes/daily-plan')).default;
  hub = (await import('../../src/routes/hub')).default;
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Mount the orgs router with an injectable session (its inner middleware reads it). */
function orgsApp(session: AuthSession) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', session);
    await next();
  });
  app.route('/', orgs);
  app.onError(onError);
  return app;
}

/** Mount the organization router at its production API path. */
function orgsApiApp(session: AuthSession) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', session);
    await next();
  });
  app.route('/v1/orgs', orgs);
  app.onError(onError);
  return app;
}

/** Insert a user + its hub; returns ids. */
async function seedUserWithHub(): Promise<{ userId: string; hubId: string }> {
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `u-${Math.random().toString(36).slice(2)}@e.com` })
    .returning({ id: schema.user.id });
  const [h] = await db
    .insert(schema.hub)
    .values({ userId: assertDefined(user).id })
    .returning({ id: schema.hub.id });
  return { userId: assertDefined(user).id, hubId: assertDefined(h).id };
}

interface DailyPlanAccessFixtureOptions {
  readonly actorStatus?: 'active' | 'suspended';
  readonly archived?: boolean;
  readonly guest?: boolean;
  readonly taskVisibility?: 'public' | 'private';
  readonly grantTaskView?: boolean;
}

/** Seed a task reference candidate and the session actor that will try to plan it. */
async function seedDailyPlanAccessFixture(options: DailyPlanAccessFixtureOptions = {}) {
  const { userId, hubId } = await seedUserWithHub();
  const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
  const role = one(
    await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: options.guest ? 'guest' : 'member',
        name: options.guest ? 'Guest' : 'Member',
      })
      .returning({ id: schema.role.id }),
  );
  await db
    .update(schema.actor)
    .set({
      userId,
      roleId: role.id,
      status: options.actorStatus ?? 'active',
      archivedAt: options.archived ? new Date('2026-08-14T00:00:00.000Z') : null,
    })
    .where(eq(schema.actor.id, humanActorId));
  const taskRow = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Daily-plan access task',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        priority: 'high',
        visibility: options.taskVisibility ?? 'public',
      })
      .returning({ id: schema.task.id }),
  );
  if (options.grantTaskView) {
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: humanActorId,
      resourceKind: 'task',
      resourceId: taskRow.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: false,
    });
  }

  return {
    app: appWithSession(dailyPlan, fakeSession(userId)),
    hubId,
    orgId,
    taskId: taskRow.id,
  };
}

describe('orgs router', () => {
  it('GET / 401 without session', async () => {
    expect((await orgsApp(null).request('/')).status).toBe(401);
  });

  it('POST / 401 without session', async () => {
    expect(
      (
        await orgsApp(null).request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ name: 'X' }),
        })
      ).status,
    ).toBe(401);
  });

  it('POST / creates an org (transaction seeds roles/owner/team/grants), then GET / lists it, GET /:orgId reads it', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId, 'Ada', 'ada@e.com'));

    // With explicit slug + vocabulary.
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Acme Inc', slug: 'acme-inc', vocabulary: 'startup' }),
    });
    expect(created.status).toBe(201);
    const result = await body<{
      organization: { id: string };
      defaultTeam: { id: string };
      ownerActorId: string;
    }>(created);
    const orgId = result.organization.id;

    // GET / lists the org for this user.
    const listed = await app.request('/');
    expect(listed.status).toBe(200);
    expect(
      (await body<{ items: { id: string }[] }>(listed)).items.some((o) => o.id === orgId),
    ).toBe(true);

    // GET /:orgId reads the org via orgContextMiddleware (the owner is a member).
    const read = await app.request(`/${orgId}`);
    expect(read.status).toBe(200);
    expect((await body<{ id: string }>(read)).id).toBe(orgId);
  });

  it('reads and updates Work structure settings without invalidating existing hierarchy', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId));
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Settings workspace' }),
    });
    const result = await body<{ organization: { id: string }; ownerActorId: string }>(created);
    const orgId = result.organization.id;

    const initial = await app.request(`/${orgId}/settings/work-structure`);
    expect(initial.status).toBe(200);
    expect(await body(initial)).toEqual({
      initiativeMaxDepth: 2,
      autoCompleteParentTasks: true,
      estimationScale: 'fibonacci',
      fiscalYearStartMonth: 0,
    });

    const raised = await app.request(`/${orgId}/settings/work-structure`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ initiativeMaxDepth: 3 }),
    });
    expect(raised.status).toBe(200);
    expect(await body(raised)).toEqual({
      initiativeMaxDepth: 3,
      autoCompleteParentTasks: true,
      estimationScale: 'fibonacci',
      fiscalYearStartMonth: 0,
    });

    const rescaled = await app.request(`/${orgId}/settings/work-structure`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ estimationScale: 't_shirt' }),
    });
    expect(rescaled.status).toBe(200);
    expect(await body(rescaled)).toEqual({
      initiativeMaxDepth: 3,
      autoCompleteParentTasks: true,
      estimationScale: 't_shirt',
      fiscalYearStartMonth: 0,
    });

    const fiscal = await app.request(`/${orgId}/settings/work-structure`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ fiscalYearStartMonth: 6 }),
    });
    expect(fiscal.status).toBe(200);
    expect(await body(fiscal)).toEqual({
      initiativeMaxDepth: 3,
      autoCompleteParentTasks: true,
      estimationScale: 't_shirt',
      fiscalYearStartMonth: 6,
    });

    const statusId = await seedStatuses(db, schema, orgId);
    const activeInitiative = statusId('initiative', 'active');
    const [root, child] = await db
      .insert(schema.initiative)
      .values([
        {
          organizationId: orgId,
          name: 'Root',
          createdBy: result.ownerActorId,
          status: 'active',
          statusId: activeInitiative,
        },
        {
          organizationId: orgId,
          name: 'Child',
          createdBy: result.ownerActorId,
          status: 'active',
          statusId: activeInitiative,
        },
      ])
      .returning({ id: schema.initiative.id });
    await db.insert(schema.initiativeHierarchyLink).values({
      contextOrganizationId: orgId,
      parentInitiativeId: assertDefined(root).id,
      childInitiativeId: assertDefined(child).id,
      createdBy: result.ownerActorId,
    });

    const conflict = await app.request(`/${orgId}/settings/work-structure`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ initiativeMaxDepth: 1 }),
    });
    expect(conflict.status).toBe(409);
    const unchanged = await app.request(`/${orgId}/settings/work-structure`);
    expect(await body(unchanged)).toEqual({
      initiativeMaxDepth: 3,
      autoCompleteParentTasks: true,
      estimationScale: 't_shirt',
      fiscalYearStartMonth: 6,
    });
  });

  it('POST / without slug derives one via slugify (incl. fallback for symbol-only names)', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId));
    const a = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'My Cool Org!', vocabulary: 'startup' }),
    });
    expect(a.status).toBe(201);
    // A name with no alphanumerics falls back to the literal 'org' slug.
    const b = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: '!!!', vocabulary: 'startup' }),
    });
    expect(b.status).toBe(201);
  });

  it('POST / isPersonal:true creates a personal space (org-of-one) with no name, defaulting to "Personal"', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId, 'Ada', 'ada@e.com'));

    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ isPersonal: true }),
    });
    expect(created.status).toBe(201);
    const result = await body<{
      organization: { id: string; name: string; isPersonal: boolean };
      defaultTeam: { id: string };
      ownerActorId: string;
    }>(created);
    expect(result.organization.name).toBe('Personal');
    expect(result.organization.isPersonal).toBe(true);

    // It is seeded with the same machinery: a default team + an owning human actor.
    const rows = await db
      .select({ isPersonal: schema.organization.isPersonal })
      .from(schema.organization)
      .where(eq(schema.organization.id, result.organization.id))
      .limit(1);
    expect(rows[0]?.isPersonal).toBe(true);
    expect(result.defaultTeam.id).toBeTruthy();
    expect(result.ownerActorId).toBeTruthy();
  });

  it('keeps personal task planning available without a paid product', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId));
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ isPersonal: true }),
    });
    const { organization } = await body<{ organization: { id: string } }>(created);

    const tasks = await app.request(`/${organization.id}/tasks`);
    expect(tasks.status).toBe(200);
  });

  it('creates and reopens an Initiative in a shared workspace without Docket Pro', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApiApp(fakeSession(userId));
    const created = await app.request('/v1/orgs', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Shared work' }),
    });
    expect(created.status).toBe(201);
    const { organization } = await body<{ organization: { id: string } }>(created);
    await clearDocketPro(db, schema, organization.id);

    const initiativeResponse = await app.request(`/v1/orgs/${organization.id}/initiatives`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Baseline initiative' }),
    });
    expect(initiativeResponse.status).toBe(201);
    const initiative = await body<{ id: string; name: string }>(initiativeResponse);

    const reopened = await app.request(`/v1/orgs/${organization.id}/initiatives/${initiative.id}`);
    expect(reopened.status).toBe(200);
    expect(
      await body<{ id: string; name: string; organizationId: string }>(reopened),
    ).toMatchObject({
      id: initiative.id,
      name: 'Baseline initiative',
      organizationId: organization.id,
    });
  });

  it('keeps the separately mounted Notion mirror behind Docket Pro', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApiApp(fakeSession(userId));
    const created = await app.request('/v1/orgs', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Paid Notion surface' }),
    });
    expect(created.status).toBe(201);
    const { organization } = await body<{ organization: { id: string } }>(created);
    await clearDocketPro(db, schema, organization.id);
    const path = `/v1/orgs/${organization.id}/integrations/missing/notion/databases`;

    expect((await app.request(path)).status).toBe(402);

    await grantDocketPro(db, schema, organization.id);
    expect((await app.request(path)).status).toBe(404);
  });

  it('POST / isPersonal:true is idempotent per user: a second call returns the existing personal space', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId));

    const first = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ isPersonal: true }),
    });
    expect(first.status).toBe(201);
    const firstId = (await body<{ organization: { id: string } }>(first)).organization.id;

    const second = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ isPersonal: true, name: 'Ignored' }),
    });
    expect(second.status).toBe(201);
    const secondResult = await body<{
      organization: { id: string };
      defaultTeam: { id: string };
      ownerActorId: string;
    }>(second);
    // Same org returned; no duplicate personal space was seeded.
    expect(secondResult.organization.id).toBe(firstId);
    expect(secondResult.defaultTeam.id).toBeTruthy();
    expect(secondResult.ownerActorId).toBeTruthy();

    const personalOrgs = await db
      .select({ id: schema.organization.id })
      .from(schema.actor)
      .innerJoin(schema.organization, eq(schema.actor.organizationId, schema.organization.id))
      .where(
        and(
          eq(schema.actor.userId, userId),
          eq(schema.actor.kind, 'human'),
          eq(schema.organization.isPersonal, true),
        ),
      );
    expect(personalOrgs).toHaveLength(1);
  });

  it('POST / isPersonal:true does not block creating a separate team org for the same user', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId));
    expect(
      (
        await app.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ isPersonal: true }),
        })
      ).status,
    ).toBe(201);
    const team = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Team Org' }),
    });
    expect(team.status).toBe(201);
    expect(
      (await body<{ organization: { isPersonal: boolean } }>(team)).organization.isPersonal,
    ).toBe(false);
  });

  it('POST / rejects a team org with no name (422)', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId));
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ vocabulary: 'startup' }),
    });
    expect(res.status).toBe(422);
  });

  it('POST / disambiguates a colliding auto-derived slug instead of 500ing (regression)', async () => {
    // Two different users naming their workspace the same derive the same slug; the second
    // would otherwise violate the unique org-slug index and abort the seed transaction as an
    // opaque 500. The handler must instead suffix the slug so the second create still succeeds.
    const a = await seedUserWithHub();
    const b = await seedUserWithHub();
    const first = await orgsApp(fakeSession(a.userId)).request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Acme Robotics' }),
    });
    expect(first.status).toBe(201);
    const firstSlug = (await body<{ organization: { slug: string } }>(first)).organization.slug;
    expect(firstSlug).toBe('acme-robotics');

    const second = await orgsApp(fakeSession(b.userId)).request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Acme Robotics' }),
    });
    expect(second.status).toBe(201);
    const secondSlug = (await body<{ organization: { slug: string } }>(second)).organization.slug;
    // Same readable base, but disambiguated (a suffix appended) so it is globally unique.
    expect(secondSlug).not.toBe(firstSlug);
    expect(secondSlug.startsWith('acme-robotics-')).toBe(true);
  });

  it('POST / 409s when an EXPLICIT slug is already taken (never silently mutated)', async () => {
    const a = await seedUserWithHub();
    const b = await seedUserWithHub();
    const first = await orgsApp(fakeSession(a.userId)).request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Beta Org', slug: 'beta-team' }),
    });
    expect(first.status).toBe(201);

    const second = await orgsApp(fakeSession(b.userId)).request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Beta Org', slug: 'beta-team' }),
    });
    expect(second.status).toBe(409);
    expect((await body<{ code: string }>(second)).code).toBe('conflict');
  });

  it('GET /:orgId 404s for a non-member (existence-hiding)', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const app = orgsApp(fakeSession('user_outsider'));
    expect((await app.request(`/${orgId}`)).status).toBe(404);
  });

  it('POST / disambiguates an auto-derived slug that collides with a reserved system name', async () => {
    // A workspace named "API" or "Settings" must not silently end up on the one path segment the
    // product itself owns — the org's slug is now also its default public brief address.
    const { userId } = await seedUserWithHub();
    const created = await orgsApp(fakeSession(userId)).request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'API' }),
    });
    expect(created.status).toBe(201);
    const slug = (await body<{ organization: { slug: string } }>(created)).organization.slug;
    expect(slug).not.toBe('api');
    expect(slug.startsWith('api-')).toBe(true);
  });

  it('PATCH /:orgId rejects an explicit reserved slug (422), never silently accepted', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId));
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Reserved-slug workspace' }),
    });
    const orgId = (await body<{ organization: { id: string } }>(created)).organization.id;

    const res = await app.request(`/${orgId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ slug: 'settings' }),
    });
    expect(res.status).toBe(422);
  });

  it('POST / uses the email as displayName when the user has no name', async () => {
    const { userId } = await seedUserWithHub();
    const app = orgsApp(fakeSession(userId, '', 'noname@e.com'));
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'NoName Org', vocabulary: 'startup' }),
    });
    expect(created.status).toBe(201);
    const result = await body<{ ownerActorId: string }>(created);
    const rows = await db
      .select({ displayName: schema.actor.displayName })
      .from(schema.actor)
      .where(eq(schema.actor.id, result.ownerActorId))
      .limit(1);
    expect(rows[0]?.displayName).toBe('noname@e.com');
  });
});

describe('notifications router', () => {
  it('401 without session; list + mark-read + not-found', async () => {
    const { userId } = await seedUserWithHub();
    const { orgId } = await seedBaseOrg(db, schema);

    const noSession = appWithSession(notifications, null);
    expect((await noSession.request('/')).status).toBe(401);
    expect((await noSession.request(`/${MISSING}/read`, { method: 'POST' })).status).toBe(401);

    const app = appWithSession(notifications, fakeSession(userId));

    const [n] = await db
      .insert(schema.notification)
      .values({ userId, organizationId: orgId, type: 'mention', body: { title: 'hi' } })
      .returning({ id: schema.notification.id });

    const listed = await app.request('/');
    expect(listed.status).toBe(200);
    expect((await body<{ items: unknown[] }>(listed)).items).toHaveLength(1);

    const read = await app.request(`/${assertDefined(n).id}/read`, { method: 'POST' });
    expect(read.status).toBe(200);

    // Not found (a different user's / missing notification).
    expect((await app.request(`/${MISSING}/read`, { method: 'POST' })).status).toBe(404);
  });
});

describe('daily-plan router', () => {
  it('401 without session on every verb', async () => {
    const noSession = appWithSession(dailyPlan, null);
    expect((await noSession.request('/?date=2026-01-01')).status).toBe(401);
    const validCreate = JSON.stringify({
      refOrganizationId: MISSING,
      refTaskId: MISSING,
      date: '2026-01-01',
    });
    expect(
      (await noSession.request('/', { method: 'POST', headers: J, body: validCreate })).status,
    ).toBe(401);
    expect(
      (await noSession.request(`/${MISSING}`, { method: 'PATCH', headers: J, body: '{}' })).status,
    ).toBe(401);
    expect((await noSession.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(401);
  });

  it('404 hub-not-found when the user has no hub', async () => {
    const app = appWithSession(dailyPlan, fakeSession('user_nohub'));
    expect((await app.request('/?date=2026-01-01')).status).toBe(404);
  });

  it('full lifecycle: list, create (with timeboxes), patch, delete', async () => {
    const { userId } = await seedUserWithHub();
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    // The session user must be a human actor in the org for the cross-org scope check.
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId });
    const [t] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Task',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id });
    const taskId = assertDefined(t).id;

    const app = appWithSession(dailyPlan, fakeSession(userId));

    // Empty list.
    const empty = await app.request('/?date=2026-02-01');
    expect((await body<{ items: unknown[] }>(empty)).items).toHaveLength(0);

    // Create with timeboxes + explicit sort.
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        refOrganizationId: orgId,
        refTaskId: taskId,
        date: '2026-02-01',
        sort: 1,
        timeboxStartsAt: '2026-02-01T09:00:00.000Z',
        timeboxEndsAt: '2026-02-01T10:00:00.000Z',
      }),
    });
    expect(created.status).toBe(201);
    const itemId = (await body<{ id: string }>(created)).id;

    // List now has it.
    const listed = await app.request('/?date=2026-02-01');
    expect((await body<{ items: unknown[] }>(listed)).items).toHaveLength(1);

    // Patch (status/sort/timeboxes incl. null).
    const patched = await app.request(`/${itemId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ status: 'done', sort: 2, timeboxStartsAt: null, timeboxEndsAt: null }),
    });
    expect(patched.status).toBe(200);

    // Delete.
    expect((await app.request(`/${itemId}`, { method: 'DELETE' })).status).toBe(200);
  });

  it.each([
    ['an active Guest without a task grant', { guest: true }],
    ['a suspended human member', { actorStatus: 'suspended' }],
    ['an archived human member', { archived: true }],
    ['an active member without a private-task grant', { taskVisibility: 'private' }],
  ] as const)('does not create a daily-plan pointer for %s', async (_label, options) => {
    const fixture = await seedDailyPlanAccessFixture(options);

    const response = await fixture.app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        refOrganizationId: fixture.orgId,
        refTaskId: fixture.taskId,
        date: '2026-08-14',
      }),
    });

    expect(response.status).toBe(404);
    const artifacts = await db
      .select({ id: schema.dailyPlanItem.id })
      .from(schema.dailyPlanItem)
      .where(
        and(
          eq(schema.dailyPlanItem.hubId, fixture.hubId),
          eq(schema.dailyPlanItem.refTaskId, fixture.taskId),
        ),
      );
    expect(artifacts).toEqual([]);
  });

  it('creates a daily-plan pointer for an active member with a private-task view grant', async () => {
    const fixture = await seedDailyPlanAccessFixture({
      taskVisibility: 'private',
      grantTaskView: true,
    });

    const response = await fixture.app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        refOrganizationId: fixture.orgId,
        refTaskId: fixture.taskId,
        date: '2026-08-14',
      }),
    });

    expect(response.status).toBe(201);
    const artifacts = await db
      .select({ id: schema.dailyPlanItem.id })
      .from(schema.dailyPlanItem)
      .where(
        and(
          eq(schema.dailyPlanItem.hubId, fixture.hubId),
          eq(schema.dailyPlanItem.refTaskId, fixture.taskId),
        ),
      );
    expect(artifacts).toHaveLength(1);
  });

  it('create: 404 when the org is not in the caller scope, and when the task is missing', async () => {
    const { userId } = await seedUserWithHub();
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId });
    const app = appWithSession(dailyPlan, fakeSession(userId));

    // Org not in caller scope.
    expect(
      (
        await app.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({
            refOrganizationId: MISSING,
            refTaskId: MISSING,
            date: '2026-02-01',
          }),
        })
      ).status,
    ).toBe(404);

    // Task missing in the scoped org.
    expect(
      (
        await app.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({
            refOrganizationId: orgId,
            refTaskId: MISSING,
            date: '2026-02-01',
          }),
        })
      ).status,
    ).toBe(404);

    // Create without timeboxes (the undefined branch), then patch a missing item → 404.
    const [t] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'T2',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id });
    const made = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        refOrganizationId: orgId,
        refTaskId: assertDefined(t).id,
        date: '2026-03-01',
      }),
    });
    expect(made.status).toBe(201);

    expect(
      (
        await app.request(`/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ status: 'done' }),
        })
      ).status,
    ).toBe(404);
    expect((await app.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('hub router', () => {
  it('401 without session on every route', async () => {
    const noSession = appWithSession(hub, null);
    expect((await noSession.request('/today?date=2026-01-01')).status).toBe(401);
    expect((await noSession.request('/inbox')).status).toBe(401);
    expect((await noSession.request('/portfolio')).status).toBe(401);
    expect((await noSession.request('/search?q=x')).status).toBe(401);
  });

  it('empty-org-set aggregations return empty', async () => {
    const app = appWithSession(hub, fakeSession('user_no_orgs'));
    const today = await body<{ plan: unknown[]; needsAttention: { inbox: number } }>(
      await app.request('/today?date=2026-01-01'),
    );
    expect(today.plan).toHaveLength(0);
    expect(today.needsAttention.inbox).toBe(0);
    expect(
      (await body<{ swimlanes: unknown[] }>(await app.request('/portfolio'))).swimlanes,
    ).toHaveLength(0);
    expect((await body<{ items: unknown[] }>(await app.request('/search?q=x'))).items).toHaveLength(
      0,
    );
    expect((await body<{ items: unknown[] }>(await app.request('/activity'))).items).toHaveLength(
      0,
    );
    // Inbox is filtered by user, not org, so it is allowed even with no orgs.
    expect((await body<{ items: unknown[] }>(await app.request('/inbox'))).items).toHaveLength(0);
  });

  it('today: accepted plan stays distinct from due work that needs attention', async () => {
    const { userId, hubId } = await seedUserWithHub();
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId });

    const date = '2026-04-01';
    // A task due that date.
    const [due] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Due',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        dueDate: new Date(date),
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id });
    // A planned task referenced by a daily-plan item.
    const [planned] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Planned',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id });
    await db
      .insert(schema.dailyPlanItem)
      .values({ hubId, refOrganizationId: orgId, refTaskId: assertDefined(planned).id, date });

    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{
      plan: { id: string }[];
      needsAttention: { dueToday: { id: string }[] };
    }>(await app.request(`/today?date=${date}`));
    const ids = today.plan.map((t) => t.id);
    expect(ids).toEqual([assertDefined(planned).id]);
    expect(today.needsAttention.dueToday.map((task) => task.id)).toContain(assertDefined(due).id);
  });

  it('today: due work alone leaves the day unplanned and appears under attention', async () => {
    const { userId } = await seedUserWithHub();
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId });
    const date = '2026-05-01';
    await db.insert(schema.task).values({
      organizationId: orgId,
      title: 'DueOnly',
      teamId,
      state: 'todo',
      statusId: statusId('task', 'todo'),
      dueDate: new Date(date),
      createdBy: humanActorId,
    });
    const app = appWithSession(hub, fakeSession(userId));
    const today = await body<{
      planState: string;
      plan: unknown[];
      needsAttention: { dueToday: unknown[] };
    }>(await app.request(`/today?date=${date}`));
    expect(today.planState).toBe('unplanned');
    expect(today.plan).toEqual([]);
    expect(today.needsAttention.dueToday).toHaveLength(1);
  });

  it('today: user with org membership but no hub row uses the empty-planned branch', async () => {
    // A user that is a member of an org but has NO hub row.
    const [user] = await db
      .insert(schema.user)
      .values({ name: 'NoHub', email: `nh-${Math.random().toString(36).slice(2)}@e.com` })
      .returning({ id: schema.user.id });
    const { orgId } = await seedBaseOrg(db, schema);
    await db.insert(schema.actor).values({
      organizationId: orgId,
      kind: 'human',
      displayName: 'NoHub',
      userId: assertDefined(user).id,
    });
    const app = appWithSession(hub, fakeSession(assertDefined(user).id));
    const today = await body<{ plan: unknown[] }>(await app.request('/today?date=2026-06-01'));
    expect(today.plan).toHaveLength(0);
  });

  it('inbox, portfolio, and search return scoped items', async () => {
    const { userId } = await seedUserWithHub();
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId });

    await db
      .insert(schema.notification)
      .values({ userId, organizationId: orgId, type: 'mention', body: { title: 'hi' } });
    const [project] = await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Searchable Project',
        teamId,
        status: 'active',
        statusId: statusId('project', 'active'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.project.id });
    const [task] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Searchable Task',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id });
    const { enqueueSearchIndexJobs } = await import('../../src/search/enqueue');
    const { processSearchIndexJobs } = await import('../../src/search/process-jobs');
    await enqueueSearchIndexJobs([
      {
        organizationId: orgId,
        sourceTable: 'project',
        entityId: assertDefined(project).id,
        operation: 'upsert',
        reason: 'manual',
      },
      {
        organizationId: orgId,
        sourceTable: 'task',
        entityId: assertDefined(task).id,
        operation: 'upsert',
        reason: 'manual',
      },
    ]);
    await processSearchIndexJobs({ limit: 100 });

    const app = appWithSession(hub, fakeSession(userId));
    expect(
      (await body<{ items: unknown[] }>(await app.request('/inbox'))).items.length,
    ).toBeGreaterThanOrEqual(1);
    const portfolio = await body<{ swimlanes: { organization: { id: string } }[] }>(
      await app.request('/portfolio'),
    );
    expect(portfolio.swimlanes.length).toBeGreaterThanOrEqual(1);
    const search = await body<{ items: { kind: string }[] }>(
      await app.request('/search?q=Searchable'),
    );
    expect(search.items.some((r) => r.kind === 'task')).toBe(true);
    expect(search.items.some((r) => r.kind === 'project')).toBe(true);
  });
});

describe('agent-sessions router (list/get + approve/reject conflict paths)', () => {
  /** Seed an org with an agent + a session in a given status. */
  async function seedSession(status: 'pending' | 'awaiting_approval' | 'completed') {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id });
    const [ag] = await db
      .insert(schema.agent)
      .values({
        organizationId: orgId,
        actorId: assertDefined(agentActor).id,
        createdBy: humanActorId,
      })
      .returning({ id: schema.agent.id });
    const [tk] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'T',
        teamId,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id });
    const [s] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: orgId,
        agentId: assertDefined(ag).id,
        taskId: assertDefined(tk).id,
        trigger: 'assignment',
        status,
        initiatorId: humanActorId,
      })
      .returning({ id: schema.agentSession.id });
    return { orgId, actorId: humanActorId, sessionId: assertDefined(s).id };
  }

  it('lists (with + without status filter), gets with activities, 404s', async () => {
    const { orgId, actorId, sessionId } = await seedSession('pending');
    const w = appWithActor(agentSessions, orgId, ['contribute'], actorId);

    expect(
      (await body<{ items: unknown[] }>(await w.request('/'))).items.length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await body<{ items: unknown[] }>(await w.request('/?status=pending'))).items.length,
    ).toBeGreaterThanOrEqual(1);

    const got = await w.request(`/${sessionId}`);
    expect(got.status).toBe(200);
    expect((await body<{ activities: unknown[] }>(got)).activities).toHaveLength(0);

    expect((await w.request(`/${MISSING}`)).status).toBe(404);
    expect((await w.request(`/${MISSING}/stream`)).status).toBe(404);
  });

  it('run: 404 for missing session, 409 for non-runnable status', async () => {
    const { orgId } = await seedSession('completed');
    const completed = await seedSession('completed');
    const w = appWithActor(agentSessions, orgId, ['contribute']);
    expect(
      (await w.request(`/${MISSING}/run`, { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(404);
    const wc = appWithActor(agentSessions, completed.orgId, ['contribute']);
    expect(
      (await wc.request(`/${completed.sessionId}/run`, { method: 'POST', headers: J, body: '{}' }))
        .status,
    ).toBe(409);
  });

  it('run: 404 when the agent is not in the session org', async () => {
    // Org A holds the session; the referenced agent belongs to a DIFFERENT org B, so the
    // org-scoped agent lookup in `runSession` finds nothing → 404.
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const [agentActorB] = await db
      .insert(schema.actor)
      .values({ organizationId: b.orgId, kind: 'agent', displayName: 'BotB' })
      .returning({ id: schema.actor.id });
    const [agB] = await db
      .insert(schema.agent)
      .values({
        organizationId: b.orgId,
        actorId: assertDefined(agentActorB).id,
        createdBy: b.humanActorId,
      })
      .returning({ id: schema.agent.id });
    const [s] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: a.orgId,
        agentId: assertDefined(agB).id,
        taskId: null,
        trigger: 'assignment',
        status: 'pending',
        initiatorId: a.humanActorId,
      })
      .returning({ id: schema.agentSession.id });
    const w = appWithActor(agentSessions, a.orgId, ['contribute']);
    expect(
      (await w.request(`/${assertDefined(s).id}/run`, { method: 'POST', headers: J, body: '{}' }))
        .status,
    ).toBe(404);
  });

  it('approve/reject: 404 missing, 409 not-awaiting, 409 no-proposed-action', async () => {
    const pending = await seedSession('pending');
    // Approving/rejecting is an `assign`-level act (permissions §9.3), so the actor here
    // holds `assign` to reach the conflict paths below.
    const w = appWithActor(agentSessions, pending.orgId, ['assign']);
    expect(
      (
        await w.request(`/${MISSING}/decision`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ decision: 'approved' }),
        })
      ).status,
    ).toBe(404);
    // Session not awaiting approval (pending) → 409.
    expect(
      (
        await w.request(`/${pending.sessionId}/decision`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ decision: 'approved' }),
        })
      ).status,
    ).toBe(409);

    // Awaiting approval but no proposed action row → 409.
    const awaiting = await seedSession('awaiting_approval');
    const wa = appWithActor(agentSessions, awaiting.orgId, ['assign']);
    expect(
      (
        await wa.request(`/${awaiting.sessionId}/decision`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ decision: 'rejected' }),
        })
      ).status,
    ).toBe(409);

    // 403 for a view-only member on approve/reject/run.
    const v = appWithActor(agentSessions, pending.orgId, ['view']);
    expect(
      (await v.request(`/${pending.sessionId}/run`, { method: 'POST', headers: J, body: '{}' }))
        .status,
    ).toBe(403);
    expect(
      (
        await v.request(`/${pending.sessionId}/decision`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ decision: 'approved' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await v.request(`/${pending.sessionId}/decision`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ decision: 'rejected' }),
        })
      ).status,
    ).toBe(403);

    // 403 for a contribute-only member: approve/reject sit above `contribute` at `assign`
    // (the legacy session-level shortcut must not undercut the activity-scoped gate).
    const cont = appWithActor(agentSessions, pending.orgId, ['contribute']);
    expect(
      (
        await cont.request(`/${pending.sessionId}/decision`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ decision: 'approved' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await cont.request(`/${pending.sessionId}/decision`, {
          method: 'PUT',
          headers: J,
          body: JSON.stringify({ decision: 'rejected' }),
        })
      ).status,
    ).toBe(403);
  });

  it('reject: flips a proposed action to rejected and cancels the session', async () => {
    const awaiting = await seedSession('awaiting_approval');
    // Insert a proposed action activity to resolve.
    await db.insert(schema.sessionActivity).values({
      sessionId: awaiting.sessionId,
      organizationId: awaiting.orgId,
      type: 'action',
      body: { action: { kind: 'update_task', summary: 'x' } },
      approvalStatus: 'proposed',
    });
    // Rejecting is an `assign`-level act (permissions §9.3).
    const w = appWithActor(agentSessions, awaiting.orgId, ['assign']);
    const res = await w.request(`/${awaiting.sessionId}/decision`, {
      method: 'PUT',
      headers: J,
      body: JSON.stringify({ decision: 'rejected' }),
    });
    expect(res.status).toBe(200);
    expect((await body<{ status: string }>(res)).status).toBe('canceled');
    const rows = await db
      .select({ s: schema.agentSession.status })
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, awaiting.sessionId))
      .limit(1);
    expect(rows[0]?.s).toBe('canceled');
  });

  /** Seed a runnable session with a valid agent; `withTask` controls the task ref. */
  async function seedRunnable(withTask: boolean) {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id });
    const [ag] = await db
      .insert(schema.agent)
      .values({
        organizationId: orgId,
        actorId: assertDefined(agentActor).id,
        createdBy: humanActorId,
      })
      .returning({ id: schema.agent.id });
    let taskId: string | null = null;
    if (withTask) {
      const [tk] = await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Run T',
          teamId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id });
      taskId = assertDefined(tk).id;
    }
    const [s] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: orgId,
        agentId: assertDefined(ag).id,
        taskId,
        trigger: 'assignment',
        status: 'pending',
        initiatorId: humanActorId,
      })
      .returning({ id: schema.agentSession.id });
    return { orgId, sessionId: assertDefined(s).id };
  }

  it('run: a task-less session streams the scripted activities and ends awaiting_approval', async () => {
    const { orgId, sessionId } = await seedRunnable(false);
    const w = appWithActor(agentSessions, orgId, ['contribute']);
    const res = await w.request(`/${sessionId}/run`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(200);
    expect((await body<{ status: string }>(res)).status).toBe('awaiting_approval');

    // Replaying via SSE covers the stream branch + each activity event. The stream
    // live-tails non-terminal sessions, so cancel first to make the replay close
    // (the tail behavior itself is covered in agent-proposals.test.ts).
    await w.request(`/${sessionId}/cancel`, { method: 'POST', headers: J, body: '{}' });
    const stream = await w.request(`/${sessionId}/stream`, { method: 'GET' });
    expect(stream.status).toBe(200);
    const text = await stream.text();
    expect(text).toContain('event: thought');
    expect(text).toContain('event: action');
  });

  it('run: a session with a task resolves the task brief', async () => {
    const { orgId, sessionId } = await seedRunnable(true);
    const w = appWithActor(agentSessions, orgId, ['contribute']);
    const res = await w.request(`/${sessionId}/run`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(200);
  });

  it('run: a turn with no tool calls settles the session to completed', async () => {
    const { orgId, sessionId } = await seedRunnable(true);
    const { getContainer } = await import('../../src/container');
    // A single text-only turn covers the loop's completed settle branch.
    const spy = vi
      .spyOn(getContainer().agentTurn, 'streamTurn')
      .mockImplementation(async function* () {
        yield { type: 'text', text: 'All done.' } as never;
        yield {
          type: 'turn_end',
          stopReason: 'end_turn',
          message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] },
        } as never;
      });
    const w = appWithActor(agentSessions, orgId, ['contribute']);
    const res = await w.request(`/${sessionId}/run`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(200);
    expect((await body<{ status: string; endedAt: string | null }>(res)).status).toBe('completed');
    spy.mockRestore();
  });

  it('run: a session whose task is in another org keeps the session-id brief (task lookup empty)', async () => {
    // Org A holds the session + agent; the session.taskId points at a task in org B, so
    // the org-scoped task lookup returns nothing → taskBrief stays the session id.
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const [agentActor] = await db
      .insert(schema.actor)
      .values({ organizationId: a.orgId, kind: 'agent', displayName: 'Ath' })
      .returning({ id: schema.actor.id });
    const [ag] = await db
      .insert(schema.agent)
      .values({
        organizationId: a.orgId,
        actorId: assertDefined(agentActor).id,
        createdBy: a.humanActorId,
      })
      .returning({ id: schema.agent.id });
    const [otherTask] = await db
      .insert(schema.task)
      .values({
        organizationId: b.orgId,
        title: 'Other',
        teamId: b.teamId,
        state: 'todo',
        statusId: b.statusId('task', 'todo'),
        createdBy: b.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [s] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: a.orgId,
        agentId: assertDefined(ag).id,
        taskId: assertDefined(otherTask).id,
        trigger: 'assignment',
        status: 'pending',
        initiatorId: a.humanActorId,
      })
      .returning({ id: schema.agentSession.id });
    const w = appWithActor(agentSessions, a.orgId, ['contribute']);
    const res = await w.request(`/${assertDefined(s).id}/run`, {
      method: 'POST',
      headers: J,
      body: '{}',
    });
    expect(res.status).toBe(200);
  });

  it('run: an already-running session re-runs (covers the running-status startedAt branch)', async () => {
    const { orgId, sessionId } = await seedRunnable(true);
    // Pre-set the session to running with an existing startedAt so the `?? new Date()`
    // keeps the prior timestamp.
    await db
      .update(schema.agentSession)
      .set({ status: 'running', startedAt: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(schema.agentSession.id, sessionId));
    const w = appWithActor(agentSessions, orgId, ['contribute']);
    const res = await w.request(`/${sessionId}/run`, { method: 'POST', headers: J, body: '{}' });
    expect(res.status).toBe(200);
  });
});
