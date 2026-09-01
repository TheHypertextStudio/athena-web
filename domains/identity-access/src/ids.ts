import { z } from 'zod';

const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ownedId = z.string().regex(ulid);

/** Organization identifier. */
export const OrganizationId = ownedId
  .brand<'OrganizationId'>()
  .describe(
    'ULID id of an Organization — a tenant workspace; the top-level boundary every other entity belongs to.',
  );
/** Organization identifier value. */
export type OrganizationId = z.infer<typeof OrganizationId>;
/** Actor identifier. */
export const ActorId = ownedId
  .brand<'ActorId'>()
  .describe(
    "ULID id of an Actor — a member identity within one org (a human user's membership, or an agent/service principal).",
  );
/** Actor identifier value. */
export type ActorId = z.infer<typeof ActorId>;
/** Team identifier. */
export const TeamId = ownedId
  .brand<'TeamId'>()
  .describe(
    'ULID id of a Team — a named group of actors within an org used for ownership and routing.',
  );
/** Team identifier value. */
export type TeamId = z.infer<typeof TeamId>;
/** Role identifier. */
export const RoleId = ownedId
  .brand<'RoleId'>()
  .describe('ULID id of a Role — a named bundle of capabilities assignable to an actor.');
/** Role identifier value. */
export type RoleId = z.infer<typeof RoleId>;
/** Explicit grant identifier. */
export const GrantId = ownedId
  .brand<'GrantId'>()
  .describe(
    'ULID id of a Grant — an explicit capability award to an actor on a specific resource.',
  );
/** Explicit grant identifier value. */
export type GrantId = z.infer<typeof GrantId>;
/** Organization invitation identifier. */
export const InvitationId = ownedId
  .brand<'InvitationId'>()
  .describe('ULID id of an Invitation — a pending offer for a person to join an org as an actor.');
/** Organization invitation identifier value. */
export type InvitationId = z.infer<typeof InvitationId>;
