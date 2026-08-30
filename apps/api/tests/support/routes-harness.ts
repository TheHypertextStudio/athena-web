import { Hono } from 'hono';

import type * as DbModule from '@docket/db';
import { CaptureMailer } from '@docket/mail';
import type { Capability } from '@docket/identity-access/capabilities';
import type { WorkStatusEntityType } from '@docket/types';
import { and, eq } from 'drizzle-orm';

import type { ActorCtx, AppEnv, AuthSession } from '../../src/context';
import { getContainer } from '../../src/container';
import { onError } from '../../src/error';
import { flushDeferredWork } from '../../src/lib/after-response';
import './auth-mock';
import { getMigratedDb } from './db';

type Db = typeof DbModule.db;

let dbmod: typeof DbModule | undefined;

/**
 * Load (once), migrate, and return the shared `@docket/db` module + in-memory PGlite.
 *
 * @remarks
 * Also touches {@link getContainer} once — building the container is what registers this
 * process's mailer/SMS/push transports with `@docket/notifications/dispatch`
 * (`configureNotificationTransports`), which every notification-dispatching test needs even if
 * it never otherwise reads from the container.
 */
export async function getDb(): Promise<typeof DbModule> {
  dbmod ??= await getMigratedDb();
  getContainer();
  return dbmod;
}

/**
 * Make `app.request(...)` settle only once the work the request deferred has finished.
 *
 * @param app - The harness app to wrap.
 * @returns The same instance, with `request` awaiting the deferred queue.
 *
 * @remarks
 * Handlers answer before their activity events, search indexing, and mention reconciliation run
 * (see `src/lib/after-response`) — that is the whole point of deferring them. In production the
 * gap is invisible; in a test it would be a race, with an assertion about an emitted event
 * running against a queue that has not drained yet. Draining here keeps every existing
 * "create then read the event" test meaningful without each one having to know the work moved.
 */
function drainingDeferredWork<T extends Hono<AppEnv>>(app: T): T {
  const request = app.request.bind(app);
  app.request = async (...args: Parameters<typeof request>) => {
    const res = await request(...args);
    await flushDeferredWork();
    return res;
  };
  return app;
}

/** Mount a router behind an injected actor context (and optional session). */
export function appWithActor(
  router: unknown,
  orgId: string,
  capabilities: readonly string[],
  actorId = 'actor_test',
  session: AuthSession = null,
  roleId: string | null = 'role_test',
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    const ctx: ActorCtx = { orgId, actorId, roleId, capabilities };
    c.set('actorCtx', ctx);
    await next();
  });
  // The router default export is a Hono instance; route it under root.
  app.route('/', router as never);
  app.onError(onError);
  return drainingDeferredWork(app);
}

/** Mount a router with a Better Auth session linked to the supplied human actor. */
export async function appWithAuthenticatedActor(
  db: Db,
  schema: typeof DbModule,
  router: unknown,
  orgId: string,
  capabilities: readonly string[],
  actorId: string,
  roleId: string | null = 'role_test',
): Promise<ReturnType<typeof appWithActor>> {
  const actor = one(
    await db
      .select({ userId: schema.actor.userId })
      .from(schema.actor)
      .where(and(eq(schema.actor.id, actorId), eq(schema.actor.organizationId, orgId)))
      .limit(1),
  );
  const userId = actor.userId ?? (await seedUserWithHub(db, schema, `Actor-${actorId}`));
  if (!actor.userId) {
    await db.update(schema.actor).set({ userId }).where(eq(schema.actor.id, actorId));
  }
  return appWithActor(router, orgId, capabilities, actorId, fakeSession(userId), roleId);
}

/** Mount a router behind an injected session only (top-level personal surfaces). */
export function appWithSession(router: unknown, session: AuthSession) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', session);
    await next();
  });
  app.route('/', router as never);
  app.onError(onError);
  return drainingDeferredWork(app);
}

/** Build a minimal fake Better Auth session for a user id. */
export function fakeSession(userId: string, name = 'Ada', email = 'ada@example.com'): AuthSession {
  return {
    session: {
      id: `sess_${userId}`,
      token: 'tok',
      userId,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: userId,
      name,
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

/**
 * Look up the id of one status in a workspace's set.
 *
 * @remarks
 * Every piece of work stores both its status key (`task.state`, `project.status`, …) and the
 * `status_id` of the workspace status carrying that key, and the composite foreign key over
 * `(status_id, key, organization_id)` refuses a row where the two disagree. So a test that
 * inserts work directly needs the id of the status matching the key it is setting, and this is
 * how it gets one. Missing keys throw by name rather than producing `undefined`, so a typo in a
 * test fails as a typo instead of as a foreign-key violation.
 */
export type StatusIdLookup = (entityType: WorkStatusEntityType, key: string) => string;

/** Build a {@link StatusIdLookup} over an already-seeded status set. */
function statusIdLookup(
  statuses: DbModule.SeededStatuses,
  schema: typeof DbModule,
): StatusIdLookup {
  return (entityType, key) => {
    const id = statuses.get(schema.statusLookupKey(entityType, key));
    if (id === undefined) throw new Error(`no seeded ${entityType} status ${key}`);
    return id;
  };
}

/**
 * Give a workspace its default status set (if it has none yet) and return a lookup over it.
 *
 * @remarks
 * Idempotent, because `seedWorkspaceStatuses` returns a workspace's existing set untouched. That
 * makes this safe for a workspace an API route already created and seeded, as well as for one a
 * test inserted straight into the table.
 *
 * @param db - The database client.
 * @param schema - The `@docket/db` module.
 * @param orgId - The workspace to seed.
 * @returns a lookup from `(entityType, key)` to the status id to store alongside that key.
 *
 * @example
 * ```typescript
 * const statusId = await seedStatuses(db, schema, orgId);
 * await db.insert(schema.task).values({
 *   organizationId: orgId,
 *   teamId,
 *   title: 'T',
 *   state: 'todo',
 *   statusId: statusId('task', 'todo'),
 * });
 * ```
 */
export async function seedStatuses(
  db: Db,
  schema: typeof DbModule,
  orgId: string,
): Promise<StatusIdLookup> {
  const statuses = await schema.seedWorkspaceStatuses(db, orgId);
  return statusIdLookup(statuses, schema);
}

/** Grant an organization active complimentary Docket Pro for product-surface tests. */
export async function grantDocketPro(
  db: Db,
  schema: typeof DbModule,
  organizationId: string,
): Promise<void> {
  await db
    .insert(schema.organizationProductEntitlement)
    .values({
      organizationId,
      productKey: 'docket_pro',
      status: 'active',
      source: 'complimentary',
    })
    .onConflictDoUpdate({
      target: [
        schema.organizationProductEntitlement.organizationId,
        schema.organizationProductEntitlement.productKey,
      ],
      set: { status: 'active', source: 'complimentary' },
    });
}

/** Remove the test fixture's complimentary product so a test can exercise baseline Docket. */
export async function clearDocketPro(
  db: Db,
  schema: typeof DbModule,
  organizationId: string,
): Promise<void> {
  await db
    .delete(schema.organizationProductEntitlement)
    .where(eq(schema.organizationProductEntitlement.organizationId, organizationId));
}

/** Seed a base org, optionally with Docket Pro, plus a team, human actor, and default statuses. */
export async function seedBaseOrg(
  db: Db,
  schema: typeof DbModule,
  withDocketPro = true,
): Promise<{
  orgId: string;
  teamId: string;
  humanActorId: string;
  statuses: DbModule.SeededStatuses;
  statusId: StatusIdLookup;
}> {
  const slug = `org-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  if (!org) throw new Error('seedBaseOrg failed to create an organization');
  const orgId = org.id;
  if (withDocketPro) await grantDocketPro(db, schema, orgId);
  else await clearDocketPro(db, schema, orgId);

  // Statuses come before any work: a Task, Project, Program, or Initiative points at one, and
  // the database refuses the row without it.
  const statuses = await schema.seedWorkspaceStatuses(db, orgId);

  const [t] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `K${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  if (!t) throw new Error('seedBaseOrg failed to create a team');
  const teamId = t.id;

  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: schema.actor.id });
  if (!human) throw new Error('seedBaseOrg failed to create a human actor');
  const humanActorId = human.id;

  return {
    orgId,
    teamId,
    humanActorId,
    statuses,
    statusId: statusIdLookup(statuses, schema),
  };
}

/**
 * Return the single row a query/insert was expected to produce, throwing if there is none.
 *
 * @remarks
 * The clean alternative to `const [row] = await ...; row!.id` — keeps tests free of non-null
 * assertions while still failing loudly on an unexpected empty result.
 *
 * @param rows - The query/insert result array.
 * @returns the first row.
 */
/** Seed a base organization with a persisted org-root task capability. */
export async function seedTaskAccessOrg(
  db: Db,
  schema: typeof DbModule,
  capability: Capability = 'contribute',
): Promise<Awaited<ReturnType<typeof seedBaseOrg>>> {
  const base = await seedBaseOrg(db, schema);
  await db.insert(schema.grant).values({
    organizationId: base.orgId,
    subjectKind: 'actor',
    subjectId: base.humanActorId,
    resourceKind: 'organization',
    resourceId: base.orgId,
    capabilities: [capability],
    effect: 'allow',
    cascades: true,
  });
  return base;
}

export function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error('expected at least one row, got none');
  return row;
}

/**
 * Seed a user + their 1:1 hub; returns the user id.
 *
 * @param db - The database client.
 * @param schema - The `@docket/db` module (for table references).
 * @param name - The user's display name (also seeds a unique email).
 */
export async function seedUserWithHub(
  db: Db,
  schema: typeof DbModule,
  name = 'User',
): Promise<string> {
  const u = one(
    await db
      .insert(schema.user)
      .values({ name, email: `${name}-${Math.random().toString(36).slice(2)}@x.test` })
      .returning({ id: schema.user.id }),
  );
  await db.insert(schema.hub).values({ userId: u.id });
  return u.id;
}

/** Seed the linked Google account required by provider-backed calendar connections. */
export async function seedGoogleAccount(
  db: Db,
  schema: typeof DbModule,
  userId: string,
  accountId: string,
  scope = 'calendar',
): Promise<void> {
  await db.insert(schema.account).values({ userId, providerId: 'google', accountId, scope });
}

/** Seed a staff operator user for admin-route and announcement tests. */
export async function seedStaffUser(
  db: Db,
  schema: typeof DbModule,
  role: NonNullable<(typeof DbModule.staffUser)['$inferInsert']['role']> = 'support',
  label: string = role,
): Promise<{ readonly userId: string; readonly staffUserId: string }> {
  const userId = await seedUserWithHub(
    db,
    schema,
    `Staff${label}-${Math.random().toString(36).slice(2)}`,
  );
  const staff = one(
    await db
      .insert(schema.staffUser)
      .values({ userId, role })
      .returning({ id: schema.staffUser.id }),
  );
  return { userId, staffUserId: staff.id };
}

/** Seed an organization (personal or shared) with its default status sets; returns its id. */
export async function seedOrg(
  db: Db,
  schema: typeof DbModule,
  isPersonal = false,
  withDocketPro = true,
): Promise<string> {
  const slug = `org-${Math.random().toString(36).slice(2, 10)}`;
  const o = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, isPersonal })
      .returning({ id: schema.organization.id }),
  );
  if (withDocketPro) await grantDocketPro(db, schema, o.id);
  else await clearDocketPro(db, schema, o.id);
  await schema.seedWorkspaceStatuses(db, o.id);
  return o.id;
}

/**
 * Add one status to a workspace's set, beyond the seeded defaults.
 *
 * @remarks
 * For a test that needs work in a status the defaults do not name — a renamed set, a team's own
 * Task statuses, a key a connector mapping produces. The row it creates is what makes the key
 * storable at all, since the composite foreign key only accepts keys the workspace defines.
 *
 * @param db - The database client.
 * @param schema - The `@docket/db` module.
 * @param values - The status columns; `isDefault` defaults to `false`.
 * @returns the new status's id.
 */
export async function seedStatus(
  db: Db,
  schema: typeof DbModule,
  values: typeof DbModule.workStatus.$inferInsert,
): Promise<string> {
  const row = one(
    await db
      .insert(schema.workStatus)
      .values({ isDefault: false, ...values })
      .returning({ id: schema.workStatus.id }),
  );
  return row.id;
}

/** The columns a work insert supplies for itself; the harness fills in `statusId`. */
type WorkValues<T extends { statusId: string }> = Omit<T, 'statusId'>;

/**
 * Insert a Task, filling in the `status_id` matching the `state` it stores.
 *
 * @param db - The database client.
 * @param schema - The `@docket/db` module.
 * @param statusId - The workspace's status lookup, from {@link seedBaseOrg} or {@link seedStatuses}.
 * @param values - The Task's columns, minus `statusId`.
 * @returns the inserted row.
 *
 * @example
 * ```typescript
 * const { orgId, teamId, statusId } = await seedBaseOrg(db, schema);
 * const task = await seedTask(db, schema, statusId, {
 *   organizationId: orgId,
 *   teamId,
 *   title: 'Ship it',
 *   state: 'in_progress',
 * });
 * ```
 */
export async function seedTask(
  db: Db,
  schema: typeof DbModule,
  statusId: StatusIdLookup,
  values: WorkValues<typeof DbModule.task.$inferInsert>,
): Promise<typeof DbModule.task.$inferSelect> {
  return one(
    await db
      .insert(schema.task)
      .values({ ...values, statusId: statusId('task', values.state) })
      .returning(),
  );
}

/** Insert a Project, filling in the `status_id` matching the `status` it stores. */
export async function seedProject(
  db: Db,
  schema: typeof DbModule,
  statusId: StatusIdLookup,
  values: WorkValues<typeof DbModule.project.$inferInsert>,
): Promise<typeof DbModule.project.$inferSelect> {
  const status = values.status ?? 'planned';
  return one(
    await db
      .insert(schema.project)
      .values({ ...values, status, statusId: statusId('project', status) })
      .returning(),
  );
}

/** Insert a Program, filling in the `status_id` matching the `status` it stores. */
export async function seedProgram(
  db: Db,
  schema: typeof DbModule,
  statusId: StatusIdLookup,
  values: WorkValues<typeof DbModule.program.$inferInsert>,
): Promise<typeof DbModule.program.$inferSelect> {
  const status = values.status ?? 'active';
  return one(
    await db
      .insert(schema.program)
      .values({ ...values, status, statusId: statusId('program', status) })
      .returning(),
  );
}

/** Insert an Initiative, filling in the `status_id` matching the `status` it stores. */
export async function seedInitiative(
  db: Db,
  schema: typeof DbModule,
  statusId: StatusIdLookup,
  values: WorkValues<typeof DbModule.initiative.$inferInsert>,
): Promise<typeof DbModule.initiative.$inferSelect> {
  const status = values.status ?? 'active';
  return one(
    await db
      .insert(schema.initiative)
      .values({ ...values, status, statusId: statusId('initiative', status) })
      .returning(),
  );
}

/**
 * Add a human member to an org with the given role, reusing the org's role of that key (or
 * creating it). Returns the new actor id.
 */
export async function addMember(
  db: Db,
  schema: typeof DbModule,
  orgId: string,
  userId: string,
  roleKey: 'owner' | 'member' = 'member',
  status: 'active' | 'suspended' = 'active',
): Promise<string> {
  const existing = await db
    .select({ id: schema.role.id })
    .from(schema.role)
    .where(and(eq(schema.role.organizationId, orgId), eq(schema.role.key, roleKey)))
    .limit(1);
  const roleId =
    existing[0]?.id ??
    one(
      await db
        .insert(schema.role)
        .values({
          organizationId: orgId,
          key: roleKey,
          name: roleKey === 'owner' ? 'Owner' : 'Member',
          isSystem: roleKey === 'owner',
        })
        .returning({ id: schema.role.id }),
    ).id;
  const a = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'M', userId, roleId, status })
      .returning({ id: schema.actor.id }),
  );
  return a.id;
}

/** Seed a verified notification contact point. */
export async function seedContactPoint(
  db: Db,
  schema: typeof DbModule,
  userId: string,
  overrides: Partial<typeof DbModule.contactPoint.$inferInsert>,
): Promise<{ readonly id: string }> {
  const value = overrides.value ?? 'user@example.test';
  return one(
    await db
      .insert(schema.contactPoint)
      .values({
        userId,
        type: 'email',
        value,
        valueNormalized: value,
        valueMasked: 'u***@example.test',
        status: 'active',
        primary: true,
        verifiedAt: new Date('2026-07-07T17:00:00.000Z'),
        ...overrides,
      })
      .returning({ id: schema.contactPoint.id }),
  );
}

/** A fake session whose `createdAt` is `ageMs` in the past (for the freshness step-up gate). */
export function agedSession(userId: string, ageMs: number): AuthSession {
  const base = fakeSession(userId);
  if (!base) throw new Error('fakeSession returned null');
  return { ...base, session: { ...base.session, createdAt: new Date(Date.now() - ageMs) } };
}

/** The in-memory capture-mailer outbox (asserts the test container wired the mock mailer). */
export async function captureOutbox(): Promise<CaptureMailer['outbox']> {
  const { getContainer } = await import('../../src/container');
  const mailer = getContainer().mailer;
  if (!(mailer instanceof CaptureMailer)) throw new Error('expected the capture mailer in tests');
  return mailer.outbox;
}
