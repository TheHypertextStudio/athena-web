/**
 * `@docket/api` — members router (mounted at `/v1/orgs/:orgId/members`).
 *
 * @remarks
 * Members are human {@link actor}s carrying a role. New membership flows through
 * invitations: create a pending row (`POST /invitations` or the legacy `POST /invite`),
 * list the pending ones (`GET /invitations`), accept by token (`POST /invitations/:token/accept`
 * or the legacy `POST /accept-invite`) which materializes the human Actor for the
 * accepting User, or revoke a pending one (`DELETE /invitations/:id`). Role/status
 * patches and member removal (`DELETE /:actorId`) run the {@link lastOwnerGuard} so an
 * org always retains an active Owner; inviting into a personal org is blocked.
 * `manage` is required to mutate.
 */
import { actor, db, genId, invitation, organization, role } from '@docket/db';
import { lastOwnerGuard, LastOwnerError } from '@docket/authz';
import {
  InvitationAccept,
  InvitationOut,
  InvitationRevokeOut,
  MemberInvite,
  MemberOut,
  MemberRemoveOut,
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
const invitationIdParam = z.object({ id: z.string() });
const tokenParam = z.object({ token: z.string().min(1) });

/**
 * Materialize the accepting User's human Actor from a pending invitation token.
 *
 * @remarks
 * Shared by `POST /accept-invite` (token in body) and `POST /invitations/:token/accept`
 * (token in path). Runs in one transaction: validates the invitation is pending and
 * unexpired, refuses a duplicate membership, inserts the human Actor carrying the
 * invitation's role, and flips the invitation to `accepted`.
 *
 * @param orgId - The active organization id (from the verified actor context).
 * @param token - The invitation's opaque token.
 * @param session - The authenticated Better Auth session of the accepting user.
 * @returns the newly created human Actor row.
 * @throws {NotFoundError} when no invitation matches the token in this org.
 * @throws {ConflictError} when the invitation is non-pending, expired, or the user
 *   is already a member of the org.
 */
async function acceptInvitation(
  orgId: string,
  token: string,
  session: NonNullable<AppEnv['Variables']['session']>,
): Promise<ActorRow> {
  return db.transaction(async (tx) => {
    const invRows = await tx
      .select()
      .from(invitation)
      .where(and(eq(invitation.token, token), eq(invitation.organizationId, orgId)))
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
}

/**
 * Create a pending invitation row for `email`/`roleId` in the active org.
 *
 * @remarks
 * Shared by `POST /invite` and `POST /invitations`. Refuses personal orgs and
 * validates the role belongs to the org. The `organization_id`/`invited_by` come
 * from the verified actor context, never the body.
 *
 * @param orgId - The active organization id (from the verified actor context).
 * @param actorId - The inviting actor's id (recorded as `invited_by`).
 * @param body - The validated invite body (`email`, `roleId`, optional `asGuest`).
 * @returns the inserted invitation row.
 * @throws {NotFoundError} when the org or the target role does not exist.
 * @throws {ConflictError} when inviting into a personal organization.
 */
async function createInvitation(
  orgId: string,
  actorId: string,
  body: z.infer<typeof MemberInvite>,
): Promise<InvitationRow> {
  const orgRows = await db.select().from(organization).where(eq(organization.id, orgId)).limit(1);
  const org = orgRows[0];
  if (!org) throw new NotFoundError('Organization not found');
  if (org.isPersonal) throw new ConflictError('Cannot invite members into a personal organization');

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
  return row;
}

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
    const row = await createInvitation(orgId, actorId, c.req.valid('json'));
    return ok(c, InvitationOut, toInvitationOut(row));
  })
  .post('/accept-invite', zJson(InvitationAccept), async (c) => {
    const { orgId } = c.get('actorCtx');
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const invitedActor = await acceptInvitation(orgId, c.req.valid('json').token, session);
    return ok(c, MemberOut, toMemberOut(invitedActor));
  })
  .get('/invitations', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending')));
    return ok(c, pageOf(InvitationOut), { items: rows.map(toInvitationOut) });
  })
  .post('/invitations', capabilityGuard('manage'), zJson(MemberInvite), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const row = await createInvitation(orgId, actorId, c.req.valid('json'));
    return ok(c, InvitationOut, toInvitationOut(row));
  })
  .post('/invitations/:token/accept', zParam(tokenParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const invitedActor = await acceptInvitation(orgId, c.req.valid('param').token, session);
    return ok(c, MemberOut, toMemberOut(invitedActor));
  })
  .delete('/invitations/:id', capabilityGuard('manage'), zParam(invitationIdParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const updated = await db
      .update(invitation)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(invitation.id, id),
          eq(invitation.organizationId, orgId),
          eq(invitation.status, 'pending'),
        ),
      )
      .returning({ id: invitation.id });
    const row = updated[0];
    if (!row) throw new NotFoundError('Pending invitation not found');
    return ok(c, InvitationRevokeOut, { id: row.id, revoked: true });
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

      // Tenant isolation + capability-source integrity: a re-pointed roleId must belong to
      // this org. `actor.roleId → role.id` is a bare global FK (identity.ts: role carries no
      // org constraint in the FK), and org-context resolves capabilities by joining
      // `actor.roleId → role` — so a cross-org roleId would silently confer ANOTHER org's
      // role capabilities (a tenant break + privilege-escalation / capability-source
      // confusion vector, permissions §4.5). Validate it in-org before the set; 404
      // (existence-hiding) when absent. Mirrors createInvitation's in-org role check.
      if (body.roleId !== undefined) {
        const roleRows = await db
          .select({ id: role.id })
          .from(role)
          .where(and(eq(role.id, body.roleId), eq(role.organizationId, orgId)))
          .limit(1);
        if (!roleRows[0]) throw new NotFoundError('Role not found');
      }

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
  )
  .delete('/:actorId', capabilityGuard('manage'), zParam(actorIdParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { actorId } = c.req.valid('param');

    const targetRows = await db
      .select()
      .from(actor)
      .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId), eq(actor.kind, 'human')))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new NotFoundError('Member not found');

    // Removing the org's last active Owner would orphan it; the guard ensures
    // another active Owner remains before the row is deleted.
    const ownerRoleRows = await db
      .select({ id: role.id })
      .from(role)
      .where(and(eq(role.organizationId, orgId), eq(role.key, 'owner')))
      .limit(1);
    const ownerRoleId = ownerRoleRows[0]?.id ?? null;
    if (ownerRoleId !== null && target.roleId === ownerRoleId) {
      try {
        await lastOwnerGuard(db, orgId, actorId);
        /* v8 ignore start -- @preserve lastOwnerGuard only ever throws LastOwnerError, so the non-LastOwnerError rethrow is unreachable */
      } catch (err) {
        if (err instanceof LastOwnerError) throw new ConflictError(err.message);
        throw err;
      }
      /* v8 ignore stop */
    }

    const deleted = await db
      .delete(actor)
      .where(and(eq(actor.id, actorId), eq(actor.organizationId, orgId)))
      .returning({ id: actor.id });
    const row = deleted[0];
    /* v8 ignore next -- @preserve defensive: the target member was verified to exist above */
    if (!row) throw new NotFoundError('Member not found');
    return ok(c, MemberRemoveOut, { id: row.id, removed: true });
  });

export default members;
