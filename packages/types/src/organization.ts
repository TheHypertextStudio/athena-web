/**
 * `@docket/types` — Organization slice DTOs.
 */
import { z } from 'zod';

import { ActorId, OrganizationId, TeamId } from './primitives';
import { VocabularySkin } from './vocabulary';

/**
 * Body for creating an Organization (the single un-nested create).
 *
 * @remarks
 * Supports two shapes:
 * - **Team org** (`isPersonal: false`, the default): `name` is REQUIRED and must be a
 *   non-empty string. This is the classic "create a workspace" flow.
 * - **Personal space** (`isPersonal: true`): an organization-of-one created without
 *   prompting for a name or vocabulary. `name` is OPTIONAL here; the handler defaults
 *   it to `'Personal'`. This backs the individual onboarding flow where a user gets a
 *   personal space silently (see data-model §3.2 / DECISIONS "personal space").
 *
 * The `name`-required-for-team rule cannot be expressed in a flat object, so it is
 * enforced with a {@link https://zod.dev | superRefine}: when `isPersonal` is false,
 * `name` must be present and non-empty.
 */
export const OrgCreate = z
  .object({
    /** Display name. Required for team orgs; optional for personal spaces (defaults to `'Personal'`). */
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    vocabulary: z.enum(['startup', 'nonprofit', 'agency']).default('startup'),
    /** When true, create a personal space (org-of-one, `is_personal: true`). */
    isPersonal: z.boolean().default(false),
    intent: z.enum(['startup', 'nonprofit', 'personal']).optional(),
  })
  .superRefine((val, ctx) => {
    // Team orgs must be named; personal spaces may omit the name (handler defaults it).
    if (!val.isPersonal && (val.name === undefined || val.name.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'name is required for a team organization',
      });
    }
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
