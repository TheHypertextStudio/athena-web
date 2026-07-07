import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithSession, fakeSession, getDb } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/app')).adminRouter;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let counter = 0;
/** A unique suffix per call (keeps emails/slugs distinct across the shared PGlite db). */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
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

/** A lifecycle state literal accepted by {@link makeOrg}. */
type LifecycleStateLiteral =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'export_window'
  | 'pending_deletion'
  | 'deleted';

/** Insert an org in the given lifecycle state; returns its id. */
async function makeOrg(
  state: LifecycleStateLiteral = 'active',
  extra: Partial<typeof schema.organization.$inferInsert> = {},
): Promise<string> {
  const u = uniq();
  const rows = await db
    .insert(schema.organization)
    .values({ name: `Org ${u}`, slug: `org-${u}`, lifecycleState: state, ...extra })
    .returning({ id: schema.organization.id });
  return rows[0]!.id;
}

/** Read an org's lifecycle state. */
async function stateOf(id: string): Promise<string> {
  const rows = await db
    .select({ s: schema.organization.lifecycleState })
    .from(schema.organization)
    .where(eq(schema.organization.id, id))
    .limit(1);
  return rows[0]!.s;
}

/** Count audit events of a given type for a subject id. */
async function auditCount(type: string, subjectId: string): Promise<number> {
  const rows = await db.select().from(schema.operatorAuditEvent);
  return rows.filter((r) => r.type === type && r.subjectId === subjectId).length;
}

describe('staff guard', () => {
  it('401s when there is no session', async () => {
    const app = appWithSession(admin, null);
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('403s an authenticated non-staff user', async () => {
    const userId = await makeUser('Civilian');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('admits a staff user', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('403s a support user on a finance-only billing action', async () => {
    const { userId } = await makeStaff('support');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/reactivate`, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('admits a finance user on a finance-only action, and superadmin too', async () => {
    const orgA = await makeOrg('export_window');
    const orgB = await makeOrg('export_window');
    const fin = await makeStaff('finance');
    const sup = await makeStaff('superadmin');
    expect(
      (
        await appWithSession(admin, fakeSession(fin.userId)).request(`/orgs/${orgA}/reactivate`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await appWithSession(admin, fakeSession(sup.userId)).request(`/orgs/${orgB}/reactivate`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200);
  });
});

describe('users', () => {
  it('lists users (paginated) and supports search', async () => {
    const { userId } = await makeStaff('support');
    const named = await db
      .insert(schema.user)
      .values({ name: `Zephyrine ${uniq()}`, email: `zephyrine-${uniq()}@example.com` })
      .returning({ id: schema.user.id, email: schema.user.email });
    const app = appWithSession(admin, fakeSession(userId));

    // Unfiltered list (no search branch) with pagination.
    const all = await app.request('/users?limit=5&offset=0', { method: 'GET' });
    expect(all.status).toBe(200);
    const allBody = await json<{ items: unknown[]; total: number }>(all);
    expect(allBody.items.length).toBeGreaterThan(0);
    expect(allBody.total).toBeGreaterThanOrEqual(allBody.items.length);

    // Search branch (matches by name).
    const searched = await app.request('/users?search=Zephyrine', { method: 'GET' });
    const searchedBody = await json<{ items: { id: string }[]; total: number }>(searched);
    expect(searchedBody.items.some((i) => i.id === named[0]!.id)).toBe(true);
  });

  it('gets a user with their org memberships', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Member');
    const orgId = await makeOrg('active');
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Member', userId: target })
      .returning({ id: schema.actor.id });

    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/users/${target}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ user: { id: string }; memberships: { organizationId: string }[] }>(
      res,
    );
    expect(body.user.id).toBe(target);
    expect(body.memberships.some((m) => m.organizationId === orgId)).toBe(true);
  });

  it('404s an unknown user id', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/users/does-not-exist', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});

describe('orgs', () => {
  it('lists orgs unfiltered, by search, and by lifecycle state', async () => {
    const { userId } = await makeStaff('support');
    const pastDue = await makeOrg('past_due');
    const app = appWithSession(admin, fakeSession(userId));

    const unfiltered = await app.request('/orgs?limit=100', { method: 'GET' });
    expect((await json<{ total: number }>(unfiltered)).total).toBeGreaterThan(0);

    const slug = (
      await db
        .select()
        .from(schema.organization)
        .where(eq(schema.organization.id, pastDue))
        .limit(1)
    )[0]!.slug;
    const searched = await app.request(`/orgs?search=${slug}`, { method: 'GET' });
    expect(
      (await json<{ items: { id: string }[] }>(searched)).items.some((o) => o.id === pastDue),
    ).toBe(true);

    const filtered = await app.request('/orgs?lifecycleState=past_due', { method: 'GET' });
    const filteredBody = await json<{ items: { id: string; lifecycleState: string }[] }>(filtered);
    expect(filteredBody.items.every((o) => o.lifecycleState === 'past_due')).toBe(true);
    expect(filteredBody.items.some((o) => o.id === pastDue)).toBe(true);
  });

  it('gets an org by id (incl. export window timestamps) and 404s unknown', async () => {
    const { userId } = await makeStaff('support');
    const ew = await makeOrg('export_window', {
      exportReadyAt: new Date('2026-01-01T00:00:00.000Z'),
      deleteAfterAt: new Date('2026-01-15T00:00:00.000Z'),
    });
    const app = appWithSession(admin, fakeSession(userId));

    const res = await app.request(`/orgs/${ew}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ exportReadyAt: string | null; deleteAfterAt: string | null }>(res);
    expect(body.exportReadyAt).toBe('2026-01-01T00:00:00.000Z');
    expect(body.deleteAfterAt).toBe('2026-01-15T00:00:00.000Z');

    expect((await app.request('/orgs/nope', { method: 'GET' })).status).toBe(404);
  });
});

describe('lifecycle board', () => {
  it('groups orgs into one column per lifecycle state', async () => {
    const { userId } = await makeStaff('support');
    const active = await makeOrg('active');
    const ew = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));

    const res = await app.request('/lifecycle', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ columns: { lifecycleState: string; orgs: { id: string }[] }[] }>(res);
    const states = body.columns.map((c) => c.lifecycleState);
    expect(states).toEqual([
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted',
    ]);
    const activeCol = body.columns.find((c) => c.lifecycleState === 'active')!;
    const ewCol = body.columns.find((c) => c.lifecycleState === 'export_window')!;
    expect(activeCol.orgs.some((o) => o.id === active)).toBe(true);
    expect(ewCol.orgs.some((o) => o.id === ew)).toBe(true);
  });
});

describe('lifecycle holds', () => {
  it('places a hold (audited), then releases it (audited)', async () => {
    const { userId } = await makeStaff('support');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));

    const placed = await app.request(`/orgs/${orgId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'billing dispute' }),
    });
    expect(placed.status).toBe(200);
    const hold = await json<{ id: string; releasedAt: string | null }>(placed);
    expect(hold.releasedAt).toBeNull();
    expect(await auditCount('lifecycle_hold.placed', orgId)).toBe(1);

    const released = await app.request(`/orgs/${orgId}/holds/${hold.id}`, { method: 'DELETE' });
    expect(released.status).toBe(200);
    expect((await json<{ releasedAt: string | null }>(released)).releasedAt).not.toBeNull();
    expect(await auditCount('lifecycle_hold.released', orgId)).toBe(1);

    // Releasing again 404s (already released).
    expect(
      (await app.request(`/orgs/${orgId}/holds/${hold.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('404s placing a hold on an unknown org', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/orgs/missing/holds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('422s a hold with an empty reason', async () => {
    const { userId } = await makeStaff('support');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s releasing a hold that does not exist', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    expect((await app.request(`/orgs/${orgId}/holds/nope`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('billing actions', () => {
  it('extends a trial (resets to trialing + clears window, audited)', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('export_window', {
      exportReadyAt: new Date('2026-01-01T00:00:00.000Z'),
      deleteAfterAt: new Date('2026-01-15T00:00:00.000Z'),
    });
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/extend-trial`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ days: 14 }),
    });
    expect(res.status).toBe(200);
    const body = await json<{
      lifecycleState: string;
      exportReadyAt: string | null;
      deleteAfterAt: string | null;
    }>(res);
    expect(body.lifecycleState).toBe('trialing');
    expect(body.exportReadyAt).toBeNull();
    expect(body.deleteAfterAt).toBeNull();
    expect(await auditCount('billing.trial_extended', orgId)).toBe(1);
  });

  it('404s extend-trial on an unknown org and 422s a bad body', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    expect(
      (
        await app.request('/orgs/missing/extend-trial', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ days: 7 }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/orgs/${orgId}/extend-trial`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ days: 0 }),
        })
      ).status,
    ).toBe(422);
  });

  it('reactivates an org out of the export window (audited)', async () => {
    const { userId } = await makeStaff('finance');
    const orgId = await makeOrg('export_window', {
      deleteAfterAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/reactivate`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await json<{ lifecycleState: string }>(res)).lifecycleState).toBe('active');
    expect(await stateOf(orgId)).toBe('active');
    expect(await auditCount('billing.reactivated', orgId)).toBe(1);
  });

  it('404s reactivate on an unknown org', async () => {
    const { userId } = await makeStaff('finance');
    const app = appWithSession(admin, fakeSession(userId));
    expect((await app.request('/orgs/missing/reactivate', { method: 'POST' })).status).toBe(404);
  });

  it('sets lifecycle to active/trialing via the reactivate path', async () => {
    const { userId } = await makeStaff('superadmin');
    const app = appWithSession(admin, fakeSession(userId));

    const orgA = await makeOrg('export_window', {
      deleteAfterAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const toActive = await app.request(`/orgs/${orgA}/lifecycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycleState: 'active' }),
    });
    expect(toActive.status).toBe(200);
    expect(await stateOf(orgA)).toBe('active');

    const orgB = await makeOrg('export_window', {
      deleteAfterAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    const toTrialing = await app.request(`/orgs/${orgB}/lifecycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycleState: 'trialing' }),
    });
    expect(toTrialing.status).toBe(200);
    expect(await stateOf(orgB)).toBe('active'); // onReactivated normalizes to active
    expect(await auditCount('lifecycle.state_set', orgB)).toBe(1);
  });

  it('sets lifecycle to export_window via the terminal path', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/lifecycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycleState: 'export_window' }),
    });
    expect(res.status).toBe(200);
    expect(await stateOf(orgId)).toBe('export_window');
  });

  it('sets lifecycle to a raw state (pending_deletion) via the direct override', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request(`/orgs/${orgId}/lifecycle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lifecycleState: 'pending_deletion' }),
    });
    expect(res.status).toBe(200);
    expect(await stateOf(orgId)).toBe('pending_deletion');
  });

  it('404s set-lifecycle on an unknown org and 422s a bad state', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('active');
    const app = appWithSession(admin, fakeSession(userId));
    expect(
      (
        await app.request('/orgs/missing/lifecycle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lifecycleState: 'active' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/orgs/${orgId}/lifecycle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lifecycleState: 'nonsense' }),
        })
      ).status,
    ).toBe(422);
  });
});

describe('impersonation', () => {
  it('starts a time-boxed session (audited) then ends it (audited)', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Target');
    const app = appWithSession(admin, fakeSession(userId));

    const started = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: target, reason: 'support ticket #42', ttlMinutes: 30 }),
    });
    expect(started.status).toBe(200);
    const sess = await json<{
      id: string;
      targetUserId: string;
      endedAt: string | null;
      expiresAt: string;
    }>(started);
    expect(sess.targetUserId).toBe(target);
    expect(sess.endedAt).toBeNull();
    expect(new Date(sess.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await auditCount('impersonation.started', target)).toBe(1);

    const ended = await app.request(`/impersonations/${sess.id}/end`, { method: 'POST' });
    expect(ended.status).toBe(200);
    expect((await json<{ endedAt: string | null }>(ended)).endedAt).not.toBeNull();
    expect(await auditCount('impersonation.ended', target)).toBe(1);

    // Ending again 404s.
    expect((await app.request(`/impersonations/${sess.id}/end`, { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('uses the default ttl when omitted', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Target');
    const app = appWithSession(admin, fakeSession(userId));
    const started = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: target, reason: 'default ttl' }),
    });
    expect(started.status).toBe(200);
    const sess = await json<{ expiresAt: string }>(started);
    expect(new Date(sess.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('404s impersonating an unknown target user', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: 'ghost', reason: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('422s a missing reason', async () => {
    const { userId } = await makeStaff('support');
    const target = await makeUser('Target');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/impersonations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: target }),
    });
    expect(res.status).toBe(422);
  });

  it('404s ending an unknown impersonation session', async () => {
    const { userId } = await makeStaff('support');
    const app = appWithSession(admin, fakeSession(userId));
    expect((await app.request('/impersonations/ghost/end', { method: 'POST' })).status).toBe(404);
  });
});

describe('audit feed and metrics', () => {
  it('returns the operator audit feed (paginated)', async () => {
    const { userId } = await makeStaff('superadmin');
    const orgId = await makeOrg('export_window');
    const app = appWithSession(admin, fakeSession(userId));
    // Generate an audit event.
    await app.request(`/orgs/${orgId}/holds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'feed seed' }),
    });
    const res = await app.request('/audit?limit=10&offset=0', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{ items: { type: string; subjectId: string }[] }>(res);
    expect(
      body.items.some((e) => e.type === 'lifecycle_hold.placed' && e.subjectId === orgId),
    ).toBe(true);
  });

  it('returns counts: users, orgs, and orgs grouped by lifecycle state', async () => {
    const { userId } = await makeStaff('support');
    await makeOrg('trialing');
    await makeOrg('deleted');
    const app = appWithSession(admin, fakeSession(userId));
    const res = await app.request('/metrics', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await json<{
      totalUsers: number;
      totalOrgs: number;
      orgsByLifecycle: { lifecycleState: string; count: number }[];
    }>(res);
    expect(body.totalUsers).toBeGreaterThan(0);
    expect(body.totalOrgs).toBeGreaterThan(0);
    const states = body.orgsByLifecycle.map((r) => r.lifecycleState);
    expect(states).toEqual([
      'trialing',
      'active',
      'past_due',
      'export_window',
      'pending_deletion',
      'deleted',
    ]);
    expect(
      body.orgsByLifecycle.find((r) => r.lifecycleState === 'trialing')!.count,
    ).toBeGreaterThan(0);
    expect(body.orgsByLifecycle.find((r) => r.lifecycleState === 'deleted')!.count).toBeGreaterThan(
      0,
    );
  });
});
