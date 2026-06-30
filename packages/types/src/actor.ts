/**
 * `@docket/types` — Actor slice DTOs.
 */
import { z } from 'zod';

import { ActorId, OrganizationId, RoleId } from './primitives';

/** Actor representation returned by reads (the org-scoped identity for any "who"). */
export const ActorOut = z
  .object({
    id: ActorId.describe(
      'Stable ULID identifier of the actor — the org-scoped identity for any "who" (an assignee, grant subject, comment author, etc.). An actor is unique to one org; the same person in two orgs has two actor ids.',
    ),
    organizationId: OrganizationId.describe(
      'The organization this actor belongs to (actors are org-scoped, never shared across orgs).',
    ),
    kind: z
      .enum(['human', 'agent', 'team'])
      .describe(
        "What kind of identity this actor represents: 'human' (a person, backed by a User and carrying a role), 'agent' (an AI agent, authorized purely by Actor-grants with no role), or 'team' (the actor that represents a Team itself, e.g. for team-level assignment).",
      ),
    displayName: z.string().describe("The actor's display name as shown throughout the UI."),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe("URL of the actor's avatar image; null when none is set."),
    status: z
      .enum(['active', 'suspended'])
      .describe(
        "Actor status: 'active' (participates normally) or 'suspended' (denied by the permission resolver regardless of role/grants). Typically only meaningful for human actors.",
      ),
    roleId: RoleId.nullable()
      .optional()
      .describe(
        'The org role this actor holds, supplying their org-wide base capability. Set for human actors; null for agents (which carry no role and are authorized purely by Actor-grants) and team actors.',
      ),
  })
  .meta({ id: 'ActorOut', description: 'An org-scoped actor.' });
/** Actor representation value. */
export type ActorOut = z.infer<typeof ActorOut>;
