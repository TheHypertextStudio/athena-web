import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, fakeSession, getDb } from './harness.test';
import type membersRouter from '../../src/routes/members';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let members!: typeof membersRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  members = (await import('../../src/routes/members')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/**
 * Seed a non-personal org with an owner role + owner actor and a plain member role.
 *
 * @param opts.personal - When true, marks the org `is_personal` (blocks invites).
 * @returns the org id plus the seeded owner/member role ids and owner actor id.
 */
async function seedOrgWithOwner(opts: { personal?: boolean } = {}) {
  const slug = `mi-${Math.random().toString(36).slice(2, 10)}`;
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

/** Insert a fresh global user; returns its id + email. */
async function seedUser(name = 'New'): Promise<{ id: string; email: string }> {
  const email = `mi-${Math.random().toString(36).slice(2)}@e.com`;
  const [user] = await db
    .insert(schema.user)
    .values({ name, email })
    .returning({ id: schema.user.id, email: schema.user.email });
  return { id: user!.id, email: user!.email };
}

/** Insert an invitation row; returns the row id + token. */
async function makeInvite(
  orgId: string,
  roleId: string,
  invitedBy: string,
  opts: { status?: 'pending' | 'accepted'; expiresAt?: Date; email?: string } = {},
): Promise<{ id: string; token: string }> {
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  const [row] = await db
    .insert(schema.invitation)
    .values({
      organizationId: orgId,
      email: opts.email ?? `inv-${Math.random().toString(36).slice(2)}@e.com`,
      roleId,
      token,
      invitedBy,
      status: opts.status ?? 'pending',
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
    })
    .returning({ id: schema.invitation.id });
  return { id: row!.id, token };
}

describe('members router — invitation flow', () => {
  it('POST /invitations creates a pending invite; GET /invitations lists only pending ones', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const w = appWithActor(members, orgId, ['manage'], ownerActorId);

    const created = await w.request('/invitations', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ email: 'new@e.com', roleId: memberRoleId, asGuest: true }),
    });
    expect(created.status).toBe(200);
    const inv = await body<{ id: string; status: string; asGuest: boolean }>(created);
    expect(inv.status).toBe('pending');
    expect(inv.asGuest).toBe(true);

    // Seed an already-accepted invite that must NOT appear in the pending list.
    await makeInvite(orgId, memberRoleId, ownerActorId, { status: 'accepted' });

    const listed = await w.request('/invitations');
    expect(listed.status).toBe(200);
    const page = await body<{ items: { id: string; status: string }[] }>(listed);
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.items.every((i) => i.status === 'pending')).toBe(true);
    expect(page.items.some((i) => i.id === inv.id)).toBe(true);
  });

  it('POST /invitations enforces capability, personal-org, role, and email validation', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();

    // 403: view-only caller lacks `manage`.
    const v = appWithActor(members, orgId, ['view'], ownerActorId);
    expect(
      (await v.request('/invitations', { method: 'POST', headers: J, body: '{}' })).status,
    ).toBe(403);

    const w = appWithActor(members, orgId, ['manage'], ownerActorId);

    // 404: org context points at a missing org.
    const ghost = appWithActor(members, MISSING, ['manage'], ownerActorId);
    expect(
      (
        await ghost.request('/invitations', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'a@e.com', roleId: memberRoleId }),
        })
      ).status,
    ).toBe(404);

    // 404: role not found.
    expect(
      (
        await w.request('/invitations', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'b@e.com', roleId: MISSING }),
        })
      ).status,
    ).toBe(404);

    // 422: invalid email.
    expect(
      (
        await w.request('/invitations', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'nope', roleId: memberRoleId }),
        })
      ).status,
    ).toBe(422);

    // 409: cannot invite into a personal org.
    const personal = await seedOrgWithOwner({ personal: true });
    const pw = appWithActor(members, personal.orgId, ['manage'], personal.ownerActorId);
    expect(
      (
        await pw.request('/invitations', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ email: 'c@e.com', roleId: personal.memberRoleId }),
        })
      ).status,
    ).toBe(409);
  });

  it('POST /invitations/:token/accept creates the human actor and flips the invite to accepted', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const user = await seedUser();
    const { id: invId, token } = await makeInvite(orgId, memberRoleId, ownerActorId);

    const session = fakeSession(user.id, 'New', user.email);
    const w = appWithActor(members, orgId, ['view'], ownerActorId, session);

    const res = await w.request(`/invitations/${token}/accept`, { method: 'POST' });
    expect(res.status).toBe(200);
    const member = await body<{ actorId: string; userId: string; roleId: string }>(res);
    expect(member.userId).toBe(user.id);
    expect(member.roleId).toBe(memberRoleId);

    // The actor row now exists and the invitation is accepted.
    const actorRows = await db
      .select({ id: schema.actor.id })
      .from(schema.actor)
      .where(and(eq(schema.actor.organizationId, orgId), eq(schema.actor.userId, user.id)));
    expect(actorRows).toHaveLength(1);
    const invRows = await db
      .select({ status: schema.invitation.status })
      .from(schema.invitation)
      .where(eq(schema.invitation.id, invId));
    expect(invRows[0]!.status).toBe('accepted');
  });

  it('POST /invitations/:token/accept rejects unauthenticated, missing, non-pending, expired, and duplicate accepts', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const user = await seedUser();

    // 401: no session.
    const anon = appWithActor(members, orgId, ['view'], ownerActorId);
    expect((await anon.request('/invitations/whatever/accept', { method: 'POST' })).status).toBe(
      401,
    );

    const session = fakeSession(user.id, 'New', user.email);
    const w = appWithActor(members, orgId, ['view'], ownerActorId, session);

    // 404: no invitation for the token.
    expect((await w.request('/invitations/nope/accept', { method: 'POST' })).status).toBe(404);

    // 409: invitation not pending.
    const accepted = await makeInvite(orgId, memberRoleId, ownerActorId, { status: 'accepted' });
    expect(
      (await w.request(`/invitations/${accepted.token}/accept`, { method: 'POST' })).status,
    ).toBe(409);

    // 409: invitation expired.
    const expired = await makeInvite(orgId, memberRoleId, ownerActorId, {
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    expect(
      (await w.request(`/invitations/${expired.token}/accept`, { method: 'POST' })).status,
    ).toBe(409);

    // Success, then 409 when the same user accepts a second invite (already a member).
    const first = await makeInvite(orgId, memberRoleId, ownerActorId);
    expect((await w.request(`/invitations/${first.token}/accept`, { method: 'POST' })).status).toBe(
      200,
    );
    const second = await makeInvite(orgId, memberRoleId, ownerActorId);
    expect(
      (await w.request(`/invitations/${second.token}/accept`, { method: 'POST' })).status,
    ).toBe(409);
  });

  it('DELETE /invitations/:id revokes a pending invite; guards capability and missing/non-pending rows', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const { id } = await makeInvite(orgId, memberRoleId, ownerActorId);

    // 403: view-only caller.
    const v = appWithActor(members, orgId, ['view'], ownerActorId);
    expect((await v.request(`/invitations/${id}`, { method: 'DELETE' })).status).toBe(403);

    const w = appWithActor(members, orgId, ['manage'], ownerActorId);

    // Success.
    const res = await w.request(`/invitations/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await body<{ id: string; revoked: boolean }>(res)).revoked).toBe(true);
    const rows = await db
      .select({ status: schema.invitation.status })
      .from(schema.invitation)
      .where(eq(schema.invitation.id, id));
    expect(rows[0]!.status).toBe('revoked');

    // 404: already revoked (no longer pending).
    expect((await w.request(`/invitations/${id}`, { method: 'DELETE' })).status).toBe(404);

    // 404: unknown id.
    expect((await w.request(`/invitations/${MISSING}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('DELETE /invitations/:id is tenant-isolated (cannot revoke another org invite)', async () => {
    const a = await seedOrgWithOwner();
    const b = await seedOrgWithOwner();
    const { id } = await makeInvite(a.orgId, a.memberRoleId, a.ownerActorId);

    // Org B's manager cannot see/revoke org A's invitation.
    const w = appWithActor(members, b.orgId, ['manage'], b.ownerActorId);
    expect((await w.request(`/invitations/${id}`, { method: 'DELETE' })).status).toBe(404);

    // It is still pending in org A.
    const rows = await db
      .select({ status: schema.invitation.status })
      .from(schema.invitation)
      .where(eq(schema.invitation.id, id));
    expect(rows[0]!.status).toBe('pending');
  });
});

describe('members router — member removal', () => {
  it('DELETE /:actorId removes a non-owner member', async () => {
    const { orgId, memberRoleId, ownerActorId } = await seedOrgWithOwner();
    const [member] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Bob', roleId: memberRoleId })
      .returning({ id: schema.actor.id });
    const memberId = member!.id;

    const w = appWithActor(members, orgId, ['manage'], ownerActorId);
    const res = await w.request(`/${memberId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const out = await body<{ id: string; removed: boolean }>(res);
    expect(out.id).toBe(memberId);
    expect(out.removed).toBe(true);

    const rows = await db
      .select({ id: schema.actor.id })
      .from(schema.actor)
      .where(eq(schema.actor.id, memberId));
    expect(rows).toHaveLength(0);
  });

  it('DELETE /:actorId 403 without manage and 404 for unknown/non-human/cross-tenant actors', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();

    // 403: view-only caller.
    const v = appWithActor(members, orgId, ['view'], ownerActorId);
    expect((await v.request(`/${ownerActorId}`, { method: 'DELETE' })).status).toBe(403);

    const w = appWithActor(members, orgId, ['manage'], ownerActorId);

    // 404: unknown actor.
    expect((await w.request(`/${MISSING}`, { method: 'DELETE' })).status).toBe(404);

    // 404: a team (non-human) actor is not a member.
    const [teamActor] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'team', displayName: 'Squad' })
      .returning({ id: schema.actor.id });
    expect((await w.request(`/${teamActor!.id}`, { method: 'DELETE' })).status).toBe(404);

    // 404: a member of another org (tenant isolation).
    const other = await seedOrgWithOwner();
    const [foreign] = await db
      .insert(schema.actor)
      .values({
        organizationId: other.orgId,
        kind: 'human',
        displayName: 'Foreign',
        roleId: other.memberRoleId,
      })
      .returning({ id: schema.actor.id });
    expect((await w.request(`/${foreign!.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('DELETE /:actorId removes a member in an org that has no owner role (guard is skipped)', async () => {
    // An org with no `owner` role at all: the last-owner guard short-circuits and
    // the member is removed regardless of role.
    const slug = `noowner-${Math.random().toString(36).slice(2, 10)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name: slug, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    const orgId = org!.id;
    const [member] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Solo' })
      .returning({ id: schema.actor.id });

    const w = appWithActor(members, orgId, ['manage'], member!.id);
    const res = await w.request(`/${member!.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await body<{ removed: boolean }>(res)).removed).toBe(true);
  });

  it('DELETE /:actorId 409 when removing the last active owner, but succeeds when another owner remains', async () => {
    const { orgId, ownerRoleId, ownerActorId } = await seedOrgWithOwner();

    // Sole owner: removal must be blocked.
    const w = appWithActor(members, orgId, ['manage'], ownerActorId);
    expect((await w.request(`/${ownerActorId}`, { method: 'DELETE' })).status).toBe(409);

    // Add a second active owner; now removing the first owner is allowed.
    const [secondOwner] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Owner2', roleId: ownerRoleId })
      .returning({ id: schema.actor.id });
    const ok = await w.request(`/${ownerActorId}`, { method: 'DELETE' });
    expect(ok.status).toBe(200);
    expect((await body<{ removed: boolean }>(ok)).removed).toBe(true);

    // The second owner still satisfies the invariant.
    const remaining = await db
      .select({ id: schema.actor.id })
      .from(schema.actor)
      .where(and(eq(schema.actor.organizationId, orgId), eq(schema.actor.roleId, ownerRoleId)));
    expect(remaining.map((r) => r.id)).toContain(secondOwner!.id);
  });
});
