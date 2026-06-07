import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, fakeSession, getDb } from './harness.test';
import type grantsRouter from './grants';
import type membersRouter from './members';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let grants!: typeof grantsRouter;
let members!: typeof membersRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  grants = (await import('./grants')).default;
  members = (await import('./members')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Seed a non-personal org with an owner role + actor; returns ids. */
async function seedOrgWithOwner(opts: { personal?: boolean } = {}) {
  const slug = `c-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active', isPersonal: opts.personal ?? false })
    .returning({ id: schema.organization.id });
  const orgId = org!.id;
  const [ownerRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'owner',
      name: 'Owner',
      isSystem: true,
      capabilities: ['manage'],
    })
    .returning({ id: schema.role.id });
  const [memberRole] = await db
    .insert(schema.role)
    .values({
      organizationId: orgId,
      key: 'member',
      name: 'Member',
      isSystem: true,
      capabilities: ['view'],
    })
    .returning({ id: schema.role.id });
  const [owner] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Owner', roleId: ownerRole!.id })
    .returning({ id: schema.actor.id });
  return {
    orgId,
    ownerRoleId: ownerRole!.id,
    memberRoleId: memberRole!.id,
    ownerActorId: owner!.id,
  };
}

describe('grants router', () => {
  it('list + upsert (allow-only) + update-on-conflict + delete + 403/404', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();
    const w = appWithActor(grants, orgId, ['manage'], ownerActorId);

    expect((await body<{ items: unknown[] }>(await w.request('/'))).items).toHaveLength(0);

    const upsert = await w.request('/', {
      method: 'PUT',
      headers: J,
      body: JSON.stringify({
        subjectKind: 'actor',
        subjectId: ownerActorId,
        resourceKind: 'project',
        resourceId: MISSING,
        capabilities: ['view', 'contribute'],
        cascades: true,
        visibilityOverride: 'private',
        visibility: 'private',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    });
    expect(upsert.status).toBe(200);

    // Upsert again with the same unique key → onConflictDoUpdate branch.
    const upsert2 = await w.request('/', {
      method: 'PUT',
      headers: J,
      body: JSON.stringify({
        subjectKind: 'actor',
        subjectId: ownerActorId,
        resourceKind: 'project',
        resourceId: MISSING,
        capabilities: ['view'],
      }),
    });
    expect(upsert2.status).toBe(200);
    const grantId = (await body<{ id: string }>(upsert2)).id;

    expect((await body<{ items: unknown[] }>(await w.request('/'))).items).toHaveLength(1);

    expect((await w.request(`/${grantId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);

    const v = appWithActor(grants, orgId, ['view']);
    expect((await v.request('/', { method: 'PUT', headers: J, body: '{}' })).status).toBe(403);
    expect((await v.request(`/${grantId}`, { method: 'DELETE' })).status).toBe(403);
  });

  it('403s on the capability guard for a contribute-only writer', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();
    // Writer holds only `contribute` but the PUT requires `manage` → 403 at the guard.
    const w = appWithActor(grants, orgId, ['contribute'], ownerActorId);
    const res = await w.request('/', {
      method: 'PUT',
      headers: J,
      body: JSON.stringify({
        subjectKind: 'actor',
        subjectId: ownerActorId,
        resourceKind: 'project',
        resourceId: MISSING,
        capabilities: ['view'],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('upserts an empty-capability grant (maxCapability defaults to view)', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();
    const w = appWithActor(grants, orgId, ['manage'], ownerActorId);
    const res = await w.request('/', {
      method: 'PUT',
      headers: J,
      body: JSON.stringify({
        subjectKind: 'role',
        subjectId: ownerActorId,
        resourceKind: 'organization',
        resourceId: orgId,
        capabilities: [],
      }),
    });
    expect(res.status).toBe(200);
  });
});

describe('members router', () => {
  it('lists human members', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();
    const w = appWithActor(members, orgId, ['view'], ownerActorId);
    const res = await w.request('/');
    expect(res.status).toBe(200);
    expect((await body<{ items: unknown[] }>(res)).items.length).toBeGreaterThanOrEqual(1);
  });

  it('invite: success + 403 + org-not-found + personal-org conflict + role-not-found + 422', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const w = appWithActor(members, orgId, ['manage'], ownerActorId);

    const invited = await w.request('/invite', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ email: 'new@e.com', roleId: memberRoleId }),
    });
    expect(invited.status).toBe(200);

    // 403 for a view-only member.
    const v = appWithActor(members, orgId, ['view'], ownerActorId);
    expect((await v.request('/invite', { method: 'POST', headers: J, body: '{}' })).status).toBe(
      403,
    );

    // Org not found (the actorCtx orgId points at a non-existent org).
    const ghost = appWithActor(members, MISSING, ['manage'], ownerActorId);
    expect(
      (
        await ghost.request('/invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'a@e.com', roleId: memberRoleId }),
        })
      ).status,
    ).toBe(404);

    // Role not found.
    expect(
      (
        await w.request('/invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'b@e.com', roleId: MISSING }),
        })
      ).status,
    ).toBe(404);

    // 422 invalid body.
    expect(
      (
        await w.request('/invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'not-an-email', roleId: memberRoleId }),
        })
      ).status,
    ).toBe(422);

    // Personal org conflict.
    const personal = await seedOrgWithOwner({ personal: true });
    const pw = appWithActor(members, personal.orgId, ['manage'], personal.ownerActorId);
    expect(
      (
        await pw.request('/invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'c@e.com', roleId: personal.memberRoleId }),
        })
      ).status,
    ).toBe(409);
  });

  it('accept-invite: success + 401 + not-found + not-pending + expired + already-member', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();

    // Seed a user that will accept.
    const [user] = await db
      .insert(schema.user)
      .values({ name: 'New', email: `new-${Math.random()}@e.com` })
      .returning({ id: schema.user.id });
    const userId = user!.id;

    /** Insert an invitation row with a known token + unique email; returns the token. */
    async function makeInvite(status: 'pending' | 'accepted', expiresAt: Date): Promise<string> {
      const token = `tok-${Math.random().toString(36).slice(2)}`;
      await db.insert(schema.invitation).values({
        organizationId: orgId,
        email: `inv-${Math.random().toString(36).slice(2)}@e.com`,
        roleId: memberRoleId,
        token,
        invitedBy: ownerActorId,
        status,
        expiresAt,
      });
      return token;
    }

    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);

    // 401: no session.
    const noSession = appWithActor(members, orgId, ['view'], ownerActorId);
    expect(
      (
        await noSession.request('/accept-invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ token: 'x' }),
        })
      ).status,
    ).toBe(401);

    const withSession = appWithActor(
      members,
      orgId,
      ['view'],
      ownerActorId,
      fakeSession(userId, 'New', 'new@e.com'),
    );

    // Not found.
    expect(
      (
        await withSession.request('/accept-invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ token: 'nope' }),
        })
      ).status,
    ).toBe(404);

    // Not pending.
    const acceptedToken = await makeInvite('accepted', future);
    expect(
      (
        await withSession.request('/accept-invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ token: acceptedToken }),
        })
      ).status,
    ).toBe(409);

    // Expired.
    const expiredToken = await makeInvite('pending', past);
    expect(
      (
        await withSession.request('/accept-invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ token: expiredToken }),
        })
      ).status,
    ).toBe(409);

    // Success.
    const goodToken = await makeInvite('pending', future);
    const ok = await withSession.request('/accept-invite', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ token: goodToken }),
    });
    expect(ok.status).toBe(200);

    // Already a member (the same user accepts a second invite).
    const secondToken = await makeInvite('pending', future);
    expect(
      (
        await withSession.request('/accept-invite', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ token: secondToken }),
        })
      ).status,
    ).toBe(409);
  });

  it('accept-invite: success when the user has no name falls back to email', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const [user] = await db
      .insert(schema.user)
      .values({ name: '', email: `noname-${Math.random()}@e.com` })
      .returning({ id: schema.user.id, email: schema.user.email });
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    await db.insert(schema.invitation).values({
      organizationId: orgId,
      email: user!.email,
      roleId: memberRoleId,
      token,
      invitedBy: ownerActorId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const session = fakeSession(user!.id, '', user!.email);
    const w = appWithActor(members, orgId, ['view'], ownerActorId, session);
    const res = await w.request('/accept-invite', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    expect((await body<{ displayName: string }>(res)).displayName).toBe(user!.email);
  });

  it('patch: plain update + target-not-found + last-owner-guard conflict + downgrade allowed', async () => {
    const { orgId, ownerRoleId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const w = appWithActor(members, orgId, ['manage'], ownerActorId);

    // A plain (non-owner) member to update.
    const [m] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'M', roleId: memberRoleId })
      .returning({ id: schema.actor.id });
    const memberActorId = m!.id;

    const patched = await w.request(`/${memberActorId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(patched.status).toBe(200);

    // Target not found.
    expect(
      (
        await w.request(`/${MISSING}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ status: 'active' }),
        })
      ).status,
    ).toBe(404);

    // Last-owner guard: suspending the only owner → 409.
    expect(
      (
        await w.request(`/${ownerActorId}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ status: 'suspended' }),
        })
      ).status,
    ).toBe(409);

    // Downgrade the only owner's role → also 409.
    expect(
      (
        await w.request(`/${ownerActorId}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ roleId: memberRoleId }),
        })
      ).status,
    ).toBe(409);

    // With a SECOND active owner, downgrading the first owner is allowed.
    await db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'Owner2',
        roleId: ownerRoleId,
        status: 'active',
      });
    const ok = await w.request(`/${ownerActorId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ roleId: memberRoleId }),
    });
    expect(ok.status).toBe(200);
  });

  it('patch: when the org has no owner role, the guard is skipped', async () => {
    // Seed an org without an owner role so ownerRoleId resolves to null.
    const slug = `noowner-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const orgId = org!.id;
    const [actorRow] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'X' })
      .returning({ id: schema.actor.id });
    const w = appWithActor(members, orgId, ['manage'], actorRow!.id);
    const res = await w.request(`/${actorRow!.id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(res.status).toBe(200);
    const updated = await db
      .select({ status: schema.actor.status })
      .from(schema.actor)
      .where(eq(schema.actor.id, actorRow!.id))
      .limit(1);
    expect(updated[0]?.status).toBe('suspended');
  });
});
