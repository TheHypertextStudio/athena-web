import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { ActorCtx, AppEnv, AuthSession } from '../context';
import { onError } from '../error';

// The shared `db`/`env`/container build from process.env on first access, so the
// required vars (APP_MODE=test forces the mock boundary adapters) MUST be set BEFORE
// any module that touches them is imported.
process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

type Db = typeof DbModule.db;

let dbmod: typeof DbModule | undefined;

/** Load (once), migrate, and return the shared `@docket/db` module + in-memory PGlite. */
export async function getDb(): Promise<typeof DbModule> {
  if (!dbmod) {
    dbmod = await import('@docket/db');
    await migrate(dbmod.db as never, { migrationsFolder: MIGRATIONS });
  }
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
  } as unknown as AuthSession;
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
  const orgId = org!.id;

  const [t] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Core',
      key: `K${Math.random().toString(36).slice(2, 6)}`,
    })
    .returning({ id: schema.team.id });
  const teamId = t!.id;

  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: schema.actor.id });
  const humanActorId = human!.id;

  return { orgId, teamId, humanActorId };
}

// A no-op suite so vitest accepts this file as a valid (non-empty) module.
it('harness module loads', () => {
  expect(typeof getDb).toBe('function');
});
