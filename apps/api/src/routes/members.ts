/**
 * `@docket/api` — members router (mounted at `/v1/orgs/:orgId/members`).
 *
 * @remarks
 * Members are human {@link actor}s carrying a role. New membership flows through
 * invitations (create a row, then accept by token, which materializes the human
 * Actor for the accepting User). Role/status patches run the {@link lastOwnerGuard}
 * so an org always retains an active Owner; inviting into a personal org is blocked.
 * `manage` is required to mutate.
 */
import { actor, db, genId, invitation, organization, role } from '@docket/db';
import { lastOwnerGuard, LastOwnerError } from '@docket/authz';
import {
  InvitationAccept,
  InvitationOut,
  MemberInvite,
  MemberOut,
  MemberUpdate,
  pageOf,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type ActorRow = typeof actor.$inferSelect;
type InvitationRow = typeof invitation.$inferSelect;

/** Days an invitation stays valid before expiring. */
const INVITATION_TTL_DAYS = 7;

function toMemberOut(a: ActorRow): z.input<typeof MemberOut> {
  return {
    actorId: a.id,
    organizationId: a.organizationId,
    displayName: a.displayName,
    avatar: a.avatar,
    status: a.status,
    roleId: a.roleId,
    userId: a.userId,
    createdAt: a.createdAt.toISOString(),
  };
}

function toInvitationOut(i: InvitationRow): z.input<typeof InvitationOut> {
  return {
    id: i.id,
    organizationId: i.organizationId,
    email: i.email,
    roleId: i.roleId,
    asGuest: i.asGuest,
    status: i.status,
    invitedBy: i.invitedBy,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
  };
}

const actorIdParam = z.object({ actorId: z.string() });

/** Members router: list members, invite + accept-invite, and role/status patches. */
const members = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(actor)
      .where(and(eq(actor.organizationId, orgId), eq(actor.kind, 'human')));
    return ok(c, pageOf(MemberOut), { items: rows.map(toMemberOut) });
  })
  .post('/invite', capabilityGuard('manage'), zJson(MemberInvite), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    const orgRows = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
    const org = orgRows[0];
    if (!org) throw new NotFoundError('Organization not found');
    if (org.isPersonal)
      throw new ConflictError('Cannot invite members into a personal organization');

    const roleRows = await db
      .select()
      .from(role)
      .where(and(eq(role.id, body.roleId), eq(role.organizationId, orgId)))
      .limit(1);
    if (!roleRows[0]) throw new NotFoundError('Role not found');

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const inserted = await db
      .insert(invitation)
      .values({
        organizationId: orgId,
        email: body.email,
        roleId: body.roleId,
        asGuest: body.asGuest ?? false,
        token: genId(),
        invitedBy: actorId,
        expiresAt,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('invitation insert returned no row');
    return ok(c, InvitationOut, toInvitationOut(row));
  })
  .post('/accept-invite', zJson(InvitationAccept), async (c) => {
    const { orgId } = c.get('actorCtx');
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const body = c.req.valid('json');

    const invitedActor = await db.transaction(async (tx) => {
      const invRows = await tx
        .select()
        .from(invitation)
        .where(and(eq(invitation.token, body.token), eq(invitation.organizationId, orgId)))
        .limit(1);
      const inv = invRows[0];
      if (!inv) throw new NotFoundError('Invitation not found');
      if (inv.status !== 'pending') throw new ConflictError('Invitation is no longer pending');
      if (inv.expiresAt.getTime() < Date.now()) throw new ConflictError('Invitation has expired');

      const existing = await tx
        .select({ id: actor.id })
        .from(actor)
        .where(and(eq(actor.organizationId, orgId), eq(actor.userId, session.user.id)))
        .limit(1);
      if (existing[0]) throw new ConflictError('Already a member of this organization');

      const [created] = await tx
        .insert(actor)
        .values({
          organizationId: orgId,
          kind: 'human',
          displayName: session.user.name || session.user.email,
          userId: session.user.id,
          roleId: inv.roleId,
        })
        .returning();
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!created) throw new Error('member actor insert returned no row');

      await tx
        .update(invitation)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(invitation.id, inv.id));

      return created;
    });

    return ok(c, MemberOut, toMemberOut(invitedActor));
  })
  .patch(
    '/:actorId',
    capabilityGuard('manage'),
    zParam(actorIdParam),
    zJson(MemberUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { actorId } = c.req.valid('param');
      const body = c.req.valid('json');

      const targetRows = await db
        .select()
        .from(actor)
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')))
        .limit(1);
      const target = targetRows[0];
      if (!target) throw new NotFoundError('Member not found');

      // If the target is currently an Owner and this patch downgrades or suspends
      // them, ensure another active Owner remains.
      const ownerRoleRows = await db
        .select({ id: role.id })
        .from(role)
        .where(and(eq(role.organizationId, orgId), eq(role.key, 'owner')))
        .limit(1);
      const ownerRoleId = ownerRoleRows[0]?.id ?? null;
      const targetIsOwner = ownerRoleId !== null && target.roleId === ownerRoleId;
      const downgradesRole = body.roleId !== undefined && body.roleId !== ownerRoleId;
      const suspends = body.status === 'suspended';
      if (targetIsOwner && (downgradesRole || suspends)) {
        try {
          await lastOwnerGuard(db, orgId, actorId);
          /* v8 ignore start -- @preserve lastOwnerGuard only ever throws LastOwnerError, so the non-LastOwnerError rethrow is unreachable */
        } catch (err) {
          if (err instanceof LastOwnerError) throw new ConflictError(err.message);
          throw err;
        }
        /* v8 ignore stop */
      }

      const updated = await db
        .update(actor)
        .set({
          ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
        })
        .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the target member was verified to exist above */
      if (!row) throw new NotFoundError('Member not found');
      return ok(c, MemberOut, toMemberOut(row));
    },
  );

export default members;
