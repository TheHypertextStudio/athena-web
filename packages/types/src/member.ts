/**
 * `@docket/types` — Member & Invitation slice DTOs.
 *
 * @remarks
 * A "member" is a human {@link ActorOut}-shaped identity (`actor.kind = 'human'`)
 * carrying its org role. Membership is mutated through invitations (create an
 * invitation row, then accept by token) and through role/status patches on the actor.
 */
import { z } from 'zod';

import { ActorId, InvitationId, OrganizationId, RoleId } from './primitives';

/** A human member of an organization (a human Actor plus its role). */
export const MemberOut = z
  .object({
    actorId: ActorId,
    organizationId: OrganizationId,
    displayName: z.string(),
    avatar: z.string().nullable().optional(),
    status: z.enum(['active', 'suspended']),
    roleId: RoleId.nullable().optional(),
    userId: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .meta({ id: 'MemberOut', description: 'A human member of an organization.' });
/** Member representation value. */
export type MemberOut = z.infer<typeof MemberOut>;

/** Body for inviting a new member (organizationId comes from the path, never the body). */
export const MemberInvite = z
  .object({
    email: z.email(),
    roleId: RoleId,
    asGuest: z.boolean().optional(),
  })
  .meta({ id: 'MemberInvite', description: 'Invite a new member to an organization.' });
/** Validated member-invite body. */
export type MemberInvite = z.infer<typeof MemberInvite>;

/** Body for patching a member's role and/or status. */
export const MemberUpdate = z
  .object({
    roleId: RoleId.optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .meta({ id: 'MemberUpdate', description: "Update a member's role or status." });
/** Validated member-update body. */
export type MemberUpdate = z.infer<typeof MemberUpdate>;

/** Body for accepting an invitation (by its opaque token). */
export const InvitationAccept = z
  .object({
    token: z.string().min(1),
  })
  .meta({ id: 'InvitationAccept', description: 'Accept an invitation by token.' });
/** Validated invitation-accept body. */
export type InvitationAccept = z.infer<typeof InvitationAccept>;

/** Full invitation representation returned by reads/creates. */
export const InvitationOut = z
  .object({
    id: InvitationId,
    organizationId: OrganizationId,
    email: z.string(),
    roleId: RoleId,
    asGuest: z.boolean(),
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    invitedBy: ActorId.nullable().optional(),
    expiresAt: z.string(),
    createdAt: z.string(),
    acceptedAt: z.string().nullable().optional(),
  })
  .meta({ id: 'InvitationOut', description: 'An organization invitation.' });
/** Invitation representation value. */
export type InvitationOut = z.infer<typeof InvitationOut>;

/** Result of removing a member (a tombstone confirming the actor id removed). */
export const MemberRemoveOut = z
  .object({
    id: ActorId,
    removed: z.literal(true),
  })
  .meta({ id: 'MemberRemoveOut', description: 'Confirmation that a member was removed.' });
/** Member-removal confirmation value. */
export type MemberRemoveOut = z.infer<typeof MemberRemoveOut>;

/** Result of revoking a pending invitation (a tombstone confirming the invitation id revoked). */
export const InvitationRevokeOut = z
  .object({
    id: InvitationId,
    revoked: z.literal(true),
  })
  .meta({ id: 'InvitationRevokeOut', description: 'Confirmation that an invitation was revoked.' });
/** Invitation-revocation confirmation value. */
export type InvitationRevokeOut = z.infer<typeof InvitationRevokeOut>;
