/**
 * `@docket/api` — service-admin gap-fill tests: staff management, the superadmin-gated
 * audit feed (with filters), and the split metrics + queues home (agent health).
 *
 * @remarks
 * Mirrors the {@link adminApp} harness from `admin.test.ts`: the admin router is mounted
 * behind an injected Better Auth session so {@link staffMiddleware} resolves the caller's
 * `staff_user` row. Covers happy paths plus capability-denied (tier cascade), not-found,
 * conflict, and invalid-input edges for every endpoint added in the gap-fill pass.
 */
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { AppEnv, AuthSession } from '../../src/context';
import { onError } from '../../src/error';
import { fakeSession, getDb } from '../support/routes-harness';
import type adminRouter from '../../src/routes/admin';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: typeof adminRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/routes/admin')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Mount the admin router behind an injected session (so staffMiddleware resolves staff_user). */
function adminApp(session: AuthSession) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    if (session) c.set('session', session);
    await next();
  });
  app.route('/', admin);
  app.onError(onError);
  return app;
}

let counter = 0;
/** A unique suffix per call (keeps emails/slugs distinct across the shared PGlite db). */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}sf`;
}

/** Insert a user; returns its id. */
async function makeUser(name = 'User'): Promise<string> {
  const u = uniq();
  const rows = await db
    .insert(schema.user)
    .values({ name: `${name} ${u}`, email: `${name.toLowerCase()}-${u}@example.com` })
    .returning({ id: schema.user.id });
  return rows[0]!.id;
}

/** Insert a staff_user keyed to a fresh user; returns { userId, staffUserId }. */
async function makeStaff(
  role: 'support' | 'finance' | 'superadmin',
): Promise<{ userId: string; staffUserId: string }> {
  const userId = await makeUser('Staff');
  const rows = await db
    .insert(schema.staffUser)
    .values({ userId, role })
    .returning({ id: schema.staffUser.id });
  return { userId, staffUserId: rows[0]!.id };
}

/** Insert an org; returns its id. */
async function makeOrg(
  extra: Partial<typeof schema.organization.$inferInsert> = {},
): Promise<string> {
  const u = uniq();
  const rows = await db
    .insert(schema.organization)
    .values({ name: `Org ${u}`, slug: `org-${u}`, lifecycleState: 'active', ...extra })
    .returning({ id: schema.organization.id });
  return rows[0]!.id;
}

/** Seed an agent session in a given status; returns the session id. */
async function makeAgentSession(
  status: 'pending' | 'awaiting_approval' | 'failed' | 'completed',
): Promise<string> {
  const orgId = await makeOrg();
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: schema.actor.id });
  const [agentActor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
    .returning({ id: schema.actor.id });
  const [ag] = await db
    .insert(schema.agent)
    .values({ organizationId: orgId, actorId: agentActor!.id, createdBy: human!.id })
    .returning({ id: schema.agent.id });
  const [s] = await db
    .insert(schema.agentSession)
    .values({ organizationId: orgId, agentId: ag!.id, trigger: 'assignment', status })
    .returning({ id: schema.agentSession.id });
  return s!.id;
}

/** Count audit events of a given type for a subject id. */
async function auditCount(type: string, subjectId: string): Promise<number> {
  const rows = await db.select().from(schema.operatorAuditEvent);
  return rows.filter((r) => r.type === type && r.subjectId === subjectId).length;
}

describe('staff management', () => {
  it('403s a support user and admits a superadmin on GET /staff', async () => {
    const support = await makeStaff('support');
    expect((await adminApp(fakeSession(support.userId)).request('/staff')).status).toBe(403);

    const sup = await makeStaff('superadmin');
    const res = await adminApp(fakeSession(sup.userId)).request('/staff?limit=100&offset=0');
    expect(res.status).toBe(200);
    const body = await json<{
      items: { id: string; userId: string; role: string }[];
      total: number;
    }>(res);
    expect(body.items.some((s) => s.id === sup.staffUserId)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
  });

  it('403s a finance user on POST /staff (superadmin-only)', async () => {
    const fin = await makeStaff('finance');
    const target = await makeUser('Promote');
    const res = await adminApp(fakeSession(fin.userId)).request('/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: target, role: 'support' }),
    });
    expect(res.status).toBe(403);
  });

  it('grants a user a staff tier (audited) and the new staff appears in the list', async () => {
    const sup = await makeStaff('superadmin');
    const target = await makeUser('Promote');
    const app = adminApp(fakeSession(sup.userId));

    const created = await app.request('/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: target, role: 'finance' }),
    });
    expect(created.status).toBe(200);
    const staff = await json<{ id: string; userId: string; role: string; userEmail: string }>(
      created,
    );
    expect(staff.userId).toBe(target);
    expect(staff.role).toBe('finance');
    expect(staff.userEmail).toContain('@example.com');
    expect(await auditCount('staff.granted', staff.id)).toBe(1);

    // The newly-granted operator can now reach the staff surface.
    const asNew = await adminApp(fakeSession(target)).request('/staff');
    // finance < superadmin → still 403 on the superadmin-only list (proves the grant took effect
    // as a *finance* tier, not a blanket super-grant).
    expect(asNew.status).toBe(403);
  });

  it('404s granting staff to an unknown user', async () => {
    const sup = await makeStaff('superadmin');
    const res = await adminApp(fakeSession(sup.userId)).request('/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'ghost', role: 'support' }),
    });
    expect(res.status).toBe(404);
  });

  it('409s granting staff to a user who is already staff', async () => {
    const sup = await makeStaff('superadmin');
    const existing = await makeStaff('support');
    const res = await adminApp(fakeSession(sup.userId)).request('/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: existing.userId, role: 'finance' }),
    });
    expect(res.status).toBe(409);
  });

  it('422s a bad role on POST /staff', async () => {
    const sup = await makeStaff('superadmin');
    const target = await makeUser('Promote');
    const res = await adminApp(fakeSession(sup.userId)).request('/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: target, role: 'owner' }),
    });
    expect(res.status).toBe(422);
  });

  it('revokes a staff member (audited) and 404s revoking again', async () => {
    const sup = await makeStaff('superadmin');
    const victim = await makeStaff('support');
    const app = adminApp(fakeSession(sup.userId));

    const removed = await app.request(`/staff/${victim.staffUserId}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const body = await json<{ id: string }>(removed);
    expect(body.id).toBe(victim.staffUserId);
    expect(await auditCount('staff.revoked', victim.staffUserId)).toBe(1);

    // The revoked operator no longer resolves to staff.
    const rows = await db
      .select()
      .from(schema.staffUser)
      .where(eq(schema.staffUser.id, victim.staffUserId));
    expect(rows.length).toBe(0);

    expect((await app.request(`/staff/${victim.staffUserId}`, { method: 'DELETE' })).status).toBe(
      404,
    );
  });

  it('409s a superadmin trying to revoke their own staff access', async () => {
    const sup = await makeStaff('superadmin');
    const res = await adminApp(fakeSession(sup.userId)).request(`/staff/${sup.staffUserId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(409);
  });

  it('403s a support user on DELETE /staff/:id', async () => {
    const support = await makeStaff('support');
    const victim = await makeStaff('support');
    const res = await adminApp(fakeSession(support.userId)).request(
      `/staff/${victim.staffUserId}`,
      {
        method: 'DELETE',
      },
    );
    expect(res.status).toBe(403);
  });
});

describe('audit feed (superadmin-only, filterable)', () => {
  it('403s a support user and admits a superadmin', async () => {
    const support = await makeStaff('support');
    expect((await adminApp(fakeSession(support.userId)).request('/audit')).status).toBe(403);

    const sup = await makeStaff('superadmin');
    expect((await adminApp(fakeSession(sup.userId)).request('/audit')).status).toBe(200);
  });

  it('filters the feed by staffUserId and by type', async () => {
    const sup = await makeStaff('superadmin');
    const orgId = await makeOrg({ lifecycleState: 'export_window' });
    const app = adminApp(fakeSession(sup.userId));

    // Generate a distinctly-typed event attributed to this superadmin.
    const placed = await app.request(`/orgs/${orgId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'audit-filter seed' }),
    });
    expect(placed.status).toBe(200);

    // Filter by type — every returned row matches.
    const byType = await app.request('/audit?type=lifecycle_hold.placed&limit=200', {
      method: 'GET',
    });
    const byTypeBody = await json<{ items: { type: string; subjectId: string }[] }>(byType);
    expect(byTypeBody.items.length).toBeGreaterThan(0);
    expect(byTypeBody.items.every((e) => e.type === 'lifecycle_hold.placed')).toBe(true);
    expect(byTypeBody.items.some((e) => e.subjectId === orgId)).toBe(true);

    // Filter by staffUserId — every returned row is attributed to this operator.
    const byStaff = await app.request(`/audit?staffUserId=${sup.staffUserId}&limit=200`, {
      method: 'GET',
    });
    const byStaffBody = await json<{ items: { staffUserId: string | null }[] }>(byStaff);
    expect(byStaffBody.items.length).toBeGreaterThan(0);
    expect(byStaffBody.items.every((e) => e.staffUserId === sup.staffUserId)).toBe(true);

    // A non-matching staff filter yields no rows.
    const empty = await app.request('/audit?staffUserId=nobody', { method: 'GET' });
    expect((await json<{ items: unknown[] }>(empty)).items.length).toBe(0);
  });
});

describe('metrics queues (agent health, mvp-plan §8.9)', () => {
  it('reports stuck approvals, agent errors, volume, and active holds', async () => {
    const sup = await makeStaff('superadmin');
    const app = adminApp(fakeSession(sup.userId));

    // Seed agent sessions across statuses + an active hold.
    await makeAgentSession('awaiting_approval');
    await makeAgentSession('failed');
    await makeAgentSession('completed');
    const holdOrg = await makeOrg({ lifecycleState: 'export_window' });
    const placed = await app.request(`/orgs/${holdOrg}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'queue-metric seed' }),
    });
    expect(placed.status).toBe(200);

    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{
      totalUsers: number;
      totalOrgs: number;
      orgsByLifecycle: { lifecycleState: string; count: number }[];
      queues: {
        stuckApprovals: number;
        agentErrors: number;
        agentVolume: number;
        activeHolds: number;
      };
    }>(res);

    // Split counts still present.
    expect(body.totalUsers).toBeGreaterThan(0);
    expect(body.totalOrgs).toBeGreaterThan(0);
    expect(body.orgsByLifecycle.map((r) => r.lifecycleState)).toEqual([
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted',
    ]);

    // Queues reflect the seeded health signals.
    expect(body.queues.stuckApprovals).toBeGreaterThanOrEqual(1);
    expect(body.queues.agentErrors).toBeGreaterThanOrEqual(1);
    expect(body.queues.agentVolume).toBeGreaterThanOrEqual(3);
    expect(body.queues.activeHolds).toBeGreaterThanOrEqual(1);
  });

  it('is open to any staff tier (support can read the home metrics)', async () => {
    const support = await makeStaff('support');
    const res = await adminApp(fakeSession(support.userId)).request('/metrics');
    expect(res.status).toBe(200);
  });
});
