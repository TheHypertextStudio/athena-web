import { Hono } from 'hono';

import type * as DbModule from '@docket/db';
import { CaptureMailer } from '@docket/mail';
import { and, eq } from 'drizzle-orm';

import type { ActorCtx, AppEnv, AuthSession } from '../../src/context';
import { onError } from '../../src/error';
import './auth-mock';
import { getMigratedDb } from './db';

type Db = typeof DbModule.db;

let dbmod: typeof DbModule | undefined;

/** Load (once), migrate, and return the shared `@docket/db` module + in-memory PGlite. */
export async function getDb(): Promise<typeof DbModule> {
  dbmod ??= await getMigratedDb();
  return dbmod;
}

/** Mount a router behind an injected actor context (and optional session). */
export function appWithActor(
  router: unknown,
  orgId: string,
  capabilities: readonly string[],
  actorId = 'actor_test',
  session: AuthSession = null,
) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    const ctx: ActorCtx = { orgId, actorId, roleId: 'role_test', capabilities };
    c.set('actorCtx', ctx);
    await next();
  });
  // The router default export is a Hono instance; route it under root.
  app.route('/', router as never);
  app.onError(onError);
  return app;
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
  return app;
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

/** Seed a base org with a team and a human actor; returns the relevant ids. */
export async function seedBaseOrg(
  db: Db,
  schema: typeof DbModule,
): Promise<{ orgId: string; teamId: string; humanActorId: string }> {
  const slug = `org-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  if (!org) throw new Error('seedBaseOrg failed to create an organization');
  const orgId = org.id;

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

  return { orgId, teamId, humanActorId };
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

/** Seed an organization (personal or shared); returns its id. */
export async function seedOrg(
  db: Db,
  schema: typeof DbModule,
  isPersonal = false,
): Promise<string> {
  const slug = `org-${Math.random().toString(36).slice(2, 10)}`;
  const o = one(
    await db
      .insert(schema.organization)
      .values({ name: slug, slug, isPersonal })
      .returning({ id: schema.organization.id }),
  );
  return o.id;
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
