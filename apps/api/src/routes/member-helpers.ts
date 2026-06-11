import { actor, db, genId, invitation, organization, role } from '@docket/db';
import type { InvitationOut, MemberInvite, MemberOut } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';

export type ActorRow = typeof actor.$inferSelect;
export type InvitationRow = typeof invitation.$inferSelect;

/** Days an invitation stays valid before expiring. */
export const INVITATION_TTL_DAYS = 7;

export function toMemberOut(a: ActorRow): z.input<typeof MemberOut> {
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

export function toInvitationOut(i: InvitationRow): z.input<typeof InvitationOut> {
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

export const actorIdParam = z.object({ actorId: z.string() });
export const invitationIdParam = z.object({ id: z.string() });
export const tokenParam = z.object({ token: z.string().min(1) });

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
export async function acceptInvitation(
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
export async function createInvitation(
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
