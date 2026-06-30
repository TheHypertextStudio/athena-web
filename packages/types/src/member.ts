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
    actorId: ActorId.describe(
      "The member's org-scoped human Actor id (`actor.kind = 'human'`). This — not the user id — is how the member is addressed in member/grant/assignment endpoints.",
    ),
    organizationId: OrganizationId.describe('The organization this membership belongs to.'),
    displayName: z
      .string()
      .describe("The member's display name (seeded from the user's name or email at join time)."),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe("URL of the member's avatar image; null when none is set."),
    status: z
      .enum(['active', 'suspended'])
      .describe(
        "Membership status: 'active' (full participation per their role) or 'suspended' (access revoked but the seat retained). A suspended actor is denied by the permission resolver regardless of role.",
      ),
    roleId: RoleId.nullable()
      .optional()
      .describe(
        "The id of the org role this member holds, which supplies their org-wide base capability (Owner/Admin → manage, Member → contribute, Guest → none). May be null for a member with no role assigned. The role's org is validated on every re-point to prevent cross-org capability leakage.",
      ),
    userId: z
      .string()
      .nullable()
      .optional()
      .describe(
        'The Better Auth User id backing this human Actor — the cross-org identity that links this membership to a real person. Null only for actors not bound to a user account.',
      ),
    createdAt: z.string().describe('ISO-8601 timestamp of when the member joined the org.'),
  })
  .meta({ id: 'MemberOut', description: 'A human member of an organization.' });
/** Member representation value. */
export type MemberOut = z.infer<typeof MemberOut>;

/** Body for inviting a new member (organizationId comes from the path, never the body). */
export const MemberInvite = z
  .object({
    email: z
      .email()
      .describe(
        "The invitee's email address (validated as an email). The accept link is sent here, and the invitee redeems it by signing in as the account owning this address.",
      ),
    roleId: RoleId.describe(
      "The id of the org role the new member will hold once they accept. MUST belong to this org (validated server-side; a foreign/unknown role yields 404), which both prevents cross-org capability leakage and determines the invitee's org-wide baseline.",
    ),
    asGuest: z
      .boolean()
      .optional()
      .describe(
        'When true, mark the invitation as a guest seat. Guests are grant-only (the Guest role confers no org-wide capability): the invitee sees nothing until explicit grants name resources for them. Defaults to false.',
      ),
  })
  .meta({ id: 'MemberInvite', description: 'Invite a new member to an organization.' });
/** Validated member-invite body. */
export type MemberInvite = z.infer<typeof MemberInvite>;

/** Body for patching a member's role and/or status. */
export const MemberUpdate = z
  .object({
    roleId: RoleId.optional().describe(
      "Re-point the member to this role. Optional; omit to leave the role unchanged. MUST belong to this org (a foreign/unknown role yields 404). Downgrading the org's last active Owner via this field is rejected with 409 (last-owner guard).",
    ),
    status: z
      .enum(['active', 'suspended'])
      .optional()
      .describe(
        "Set membership status: 'active' to (re)enable participation, 'suspended' to revoke access while keeping the seat. Optional; omit to leave unchanged. Suspending the org's last active Owner is rejected with 409 (last-owner guard).",
      ),
  })
  .meta({ id: 'MemberUpdate', description: "Update a member's role or status." });
/** Validated member-update body. */
export type MemberUpdate = z.infer<typeof MemberUpdate>;

/** Body for accepting an invitation (by its opaque token). */
export const InvitationAccept = z
  .object({
    token: z
      .string()
      .min(1)
      .describe(
        "The invitation's opaque token (delivered in the accept link). Possession of a valid token IS the authorization to join; the server validates it is pending and unexpired before materializing the member.",
      ),
  })
  .meta({ id: 'InvitationAccept', description: 'Accept an invitation by token.' });
/** Validated invitation-accept body. */
export type InvitationAccept = z.infer<typeof InvitationAccept>;

/** Full invitation representation returned by reads/creates. */
export const InvitationOut = z
  .object({
    id: InvitationId.describe(
      'Stable ULID identifier of the invitation. Used to revoke it (`DELETE /invitations/:id`); note the redeem path keys on the opaque token, not this id.',
    ),
    organizationId: OrganizationId.describe('The organization the invitation grants access to.'),
    email: z.string().describe("The invitee's email address the accept link was sent to."),
    roleId: RoleId.describe('The id of the org role the invitee will hold once they accept.'),
    asGuest: z
      .boolean()
      .describe(
        'True when this is a guest-seat invitation (grant-only access). The opaque token itself is intentionally NOT exposed in this representation.',
      ),
    status: z
      .enum(['pending', 'accepted', 'revoked', 'expired'])
      .describe(
        "Invitation lifecycle: 'pending' (outstanding, redeemable), 'accepted' (redeemed — a member Actor was created), 'revoked' (cancelled by a manager), or 'expired' (past its deadline). Only 'pending' invitations are returned by the list endpoint and are redeemable.",
      ),
    invitedBy: ActorId.nullable()
      .optional()
      .describe(
        'The actor id of the member who issued the invitation (recorded from the verified context, never the request body). Null when the inviter is unknown/system.',
      ),
    expiresAt: z
      .string()
      .describe(
        'ISO-8601 deadline after which the invitation can no longer be accepted (7 days from creation). Expiry is enforced at accept time; an expired-but-still-pending row may briefly appear in listings.',
      ),
    createdAt: z.string().describe('ISO-8601 timestamp of when the invitation was issued.'),
    acceptedAt: z
      .string()
      .nullable()
      .optional()
      .describe(
        'ISO-8601 timestamp of when the invitation was redeemed; null while still pending.',
      ),
  })
  .meta({ id: 'InvitationOut', description: 'An organization invitation.' });
/** Invitation representation value. */
export type InvitationOut = z.infer<typeof InvitationOut>;

/** Result of removing a member (a tombstone confirming the actor id removed). */
export const MemberRemoveOut = z
  .object({
    id: ActorId.describe('The actor id of the member that was removed.'),
    removed: z
      .literal(true)
      .describe('Always true — a tombstone confirming the member Actor was deleted.'),
  })
  .meta({ id: 'MemberRemoveOut', description: 'Confirmation that a member was removed.' });
/** Member-removal confirmation value. */
export type MemberRemoveOut = z.infer<typeof MemberRemoveOut>;

/** Result of revoking a pending invitation (a tombstone confirming the invitation id revoked). */
export const InvitationRevokeOut = z
  .object({
    id: InvitationId.describe('The id of the invitation that was revoked.'),
    revoked: z
      .literal(true)
      .describe(
        "Always true — a tombstone confirming the invitation's status was flipped to 'revoked'. The row is retained for audit, not deleted.",
      ),
  })
  .meta({ id: 'InvitationRevokeOut', description: 'Confirmation that an invitation was revoked.' });
/** Invitation-revocation confirmation value. */
export type InvitationRevokeOut = z.infer<typeof InvitationRevokeOut>;
