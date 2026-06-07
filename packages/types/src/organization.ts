/**
 * `@docket/types` — Organization slice DTOs.
 */
import { z } from 'zod';

import { ActorId, OrganizationId, TeamId } from './primitives';
import { VocabularySkin } from './vocabulary';

/** Body for creating an Organization (the single un-nested create; `isPersonal` forced false). */
export const OrgCreate = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1).optional(),
    vocabulary: z.enum(['startup', 'nonprofit', 'agency']).default('startup'),
    isPersonal: z.literal(false).default(false),
    intent: z.enum(['startup', 'nonprofit', 'personal']).optional(),
  })
  .meta({ id: 'OrgCreate', description: 'Create a new organization.' });
/** Validated org-create body. */
export type OrgCreate = z.infer<typeof OrgCreate>;

/** Full organization representation returned by reads. */
export const OrgOut = z
  .object({
    id: OrganizationId,
    name: z.string(),
    slug: z.string(),
    avatar: z.string().nullable().optional(),
    isPersonal: z.boolean(),
    vocabulary: VocabularySkin,
    lifecycleState: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'OrgOut', description: 'An organization.' });
/** Organization representation value. */
export type OrgOut = z.infer<typeof OrgOut>;

/** Compact organization summary for membership lists / the org rail. */
export const OrgSummary = z
  .object({
    id: OrganizationId,
    name: z.string(),
    slug: z.string(),
    avatar: z.string().nullable().optional(),
    isPersonal: z.boolean(),
  })
  .meta({ id: 'OrgSummary', description: 'A compact organization summary.' });
/** Organization summary value. */
export type OrgSummary = z.infer<typeof OrgSummary>;

/** The default team returned alongside a freshly-created org. */
export const DefaultTeamOut = z
  .object({ id: TeamId, name: z.string(), key: z.string() })
  .meta({ id: 'DefaultTeamOut', description: "An org's default team." });
/** Default-team value. */
export type DefaultTeamOut = z.infer<typeof DefaultTeamOut>;

/** The org-create response: the org plus its seeded default team + owner actor. */
export const OrgCreateResult = z
  .object({ organization: OrgOut, defaultTeam: DefaultTeamOut, ownerActorId: ActorId })
  .meta({ id: 'OrgCreateResult', description: 'Result of creating an organization.' });
/** Org-create result value. */
export type OrgCreateResult = z.infer<typeof OrgCreateResult>;
