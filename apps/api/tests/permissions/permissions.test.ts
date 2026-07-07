import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { AppEnv, AuthSession } from '../../src/context';
import { onError } from '../../src/error';
import { fakeSession, getDb } from '../support/routes-harness';
import { capabilityGuard } from '../../src/permissions/capability-guard';
import { orgContextMiddleware } from '../../src/permissions/org-context-middleware';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** Mount the org-context middleware on `/:orgId` with an injectable session. */
function ctxApp(session: AuthSession) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', session);
    await next();
  });
  app.use('/:orgId/*', orgContextMiddleware);
  app.get('/:orgId/probe', (c) => c.json(c.get('actorCtx')));
  app.onError(onError);
  return app;
}

describe('orgContextMiddleware', () => {
  it('401s when there is no session', async () => {
    const res = await ctxApp(null).request('/org_x/probe');
    expect(res.status).toBe(401);
  });

  it('resolves the actor context for a member (role capabilities flow through)', async () => {
    const slug = `mw-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const orgId = org!.id;

    const [user] = await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `${slug}@e.com` })
      .returning({ id: schema.user.id });
    const userId = user!.id;

    const [r] = await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: 'member',
        name: 'Member',
        isSystem: true,
        capabilities: ['view', 'contribute'],
      })
      .returning({ id: schema.role.id });
    const roleId = r!.id;

    const [a] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId, roleId })
      .returning({ id: schema.actor.id });

    const res = await ctxApp(fakeSession(userId)).request(`/${orgId}/probe`);
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as {
      orgId: string;
      actorId: string;
      roleId: string | null;
      capabilities: string[];
    };
    expect(ctx.orgId).toBe(orgId);
    expect(ctx.actorId).toBe(a!.id);
    expect(ctx.roleId).toBe(roleId);
    expect(ctx.capabilities).toEqual(['view', 'contribute']);
  });

  it('falls back to empty capabilities when the actor has no role', async () => {
    const slug = `mw2-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const orgId = org!.id;
    const [user] = await db
      .insert(schema.user)
      .values({ name: 'Bo', email: `${slug}@e.com` })
      .returning({ id: schema.user.id });
    const userId = user!.id;
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Bo', userId });

    const res = await ctxApp(fakeSession(userId)).request(`/${orgId}/probe`);
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as { roleId: string | null; capabilities: string[] };
    expect(ctx.roleId).toBeNull();
    expect(ctx.capabilities).toEqual([]);
  });

  it('does NOT confer capabilities from a role belonging to another org (org-scoped join)', async () => {
    // Defense-in-depth behind the members PATCH in-org role validation: even if an actor's
    // roleId somehow points at ANOTHER org's role (the FK is a bare global PK), the
    // org-scoped role join must resolve no row → empty capabilities, never that other
    // org's capabilities.
    const slugA = `mwx-${Math.random().toString(36).slice(2, 10)}`;
    const [orgA] = await db
      .insert(schema.organization)
      .values({ name: slugA, slug: slugA, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const slugB = `mwy-${Math.random().toString(36).slice(2, 10)}`;
    const [orgB] = await db
      .insert(schema.organization)
      .values({ name: slugB, slug: slugB, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });

    // A privileged role in org B (NOT org A).
    const [roleB] = await db
      .insert(schema.role)
      .values({
        organizationId: orgB!.id,
        key: 'owner',
        name: 'Owner',
        isSystem: true,
        capabilities: ['manage'],
      })
      .returning({ id: schema.role.id });

    const [user] = await db
      .insert(schema.user)
      .values({ name: 'Eve', email: `${slugA}@e.com` })
      .returning({ id: schema.user.id });
    const userId = user!.id;

    // The org-A actor carries org B's roleId (the cross-org confusion vector).
    await db.insert(schema.actor).values({
      organizationId: orgA!.id,
      kind: 'human',
      displayName: 'Eve',
      userId,
      roleId: roleB!.id,
    });

    const res = await ctxApp(fakeSession(userId)).request(`/${orgA!.id}/probe`);
    expect(res.status).toBe(200);
    const ctx = (await res.json()) as { roleId: string | null; capabilities: string[] };
    // The actor's roleId field is still surfaced, but the join confers NO capabilities.
    expect(ctx.roleId).toBe(roleB!.id);
    expect(ctx.capabilities).toEqual([]);
  });

  it('404s when the session user is not a member of the org (existence-hiding)', async () => {
    const slug = `mw3-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const res = await ctxApp(fakeSession('user_not_a_member')).request(`/${org!.id}/probe`);
    expect(res.status).toBe(404);
  });

  it('404s when no orgId param is present', async () => {
    // Mount the middleware on a wildcard with no `:orgId` segment so the param is absent.
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('session', fakeSession('u1'));
      await next();
    });
    app.use('*', orgContextMiddleware);
    app.get('/probe', (c) => c.json(c.get('actorCtx')));
    app.onError(onError);
    const res = await app.request('/probe');
    expect(res.status).toBe(404);
  });
});

describe('capabilityGuard', () => {
  /** Mount the guard with an injected actorCtx carrying the given capabilities. */
  function guardApp(capabilities: readonly string[], required: 'view' | 'contribute' | 'manage') {
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('actorCtx', { orgId: 'o', actorId: 'a', roleId: null, capabilities });
      await next();
    });
    app.get('/', capabilityGuard(required), (c) => c.json({ ok: true }));
    app.onError(onError);
    return app;
  }

  it('allows when the held capability satisfies the required one (rank cascade)', async () => {
    const res = await guardApp(['manage'], 'contribute').request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('403s when the held capabilities do not satisfy the required one', async () => {
    const res = await guardApp(['view'], 'manage').request('/');
    expect(res.status).toBe(403);
  });
});
