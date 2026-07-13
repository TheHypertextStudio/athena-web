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
    name: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The organization's display name. REQUIRED for a team org (`isPersonal: false`) and validated non-empty by a superRefine; OPTIONAL for a personal space (`isPersonal: true`), where the handler defaults it to 'Personal'. Also seeds the auto-derived slug when `slug` is omitted.",
      ),
    purpose: z
      .string()
      .optional()
      .describe(
        'A short free-text statement of what the organization is for. Backs the second field of the create-org form (name + purpose) and is shown in org settings. Optional; has no effect on slug or authorization.',
      ),
    slug: z
      .string()
      .min(1)
      .optional()
      .describe(
        'URL-safe unique identifier for the org, used in paths and the web app URL. Must be unique across all orgs (the `organization_slug_uq` index). When omitted it is auto-derived — from the name for team orgs, or `personal-<userId>` for personal spaces — and silently disambiguated with a random suffix on collision. When supplied explicitly, a collision is rejected with 409 instead of being disambiguated.',
      ),
    vocabulary: z
      .enum(['startup', 'nonprofit', 'agency'])
      .default('startup')
      .describe(
        "The terminology skin applied across the org's UI — 'startup' | 'nonprofit' | 'agency' — which relabels entities (e.g. the nonprofit skin renames Projects to Programs-of-work). Stored as the `preset` of the org's vocabulary skin. Defaults to 'startup'.",
      ),
    isPersonal: z
      .boolean()
      .default(false)
      .describe(
        'When true, create a personal space — an organization-of-one (`is_personal: true`) created without prompting for a name/vocabulary. Personal-space creation is idempotent per user (an existing personal org is returned rather than duplicated), and invitations/guests are rejected for it. Defaults to false (a normal team org).',
      ),
    intent: z
      .enum(['startup', 'nonprofit', 'personal'])
      .optional()
      .describe(
        "Optional onboarding-intent hint captured by the create flow — 'startup' | 'nonprofit' | 'personal' — describing why the org is being created. Informational only; it does not itself set the vocabulary or the `isPersonal` flag (those are explicit fields).",
      ),
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
    id: OrganizationId.describe('Stable ULID identifier of the organization.'),
    name: z.string().describe("The organization's display name."),
    slug: z
      .string()
      .describe(
        'URL-safe unique identifier used in API paths and the web app URL; unique across all orgs.',
      ),
    purpose: z
      .string()
      .nullable()
      .optional()
      .describe('Free-text statement of what the org is for; null when never set.'),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe("URL of the org's avatar/logo image; null when none has been uploaded."),
    isPersonal: z
      .boolean()
      .describe(
        'True for a personal space (org-of-one); such orgs reject invitations and guests. False for a normal team org.',
      ),
    vocabulary: VocabularySkin.describe(
      "The org's terminology skin — a preset ('startup' | 'nonprofit' | 'agency') plus optional per-key label overrides — that relabels entities across the UI.",
    ),
    lifecycleState: z
      .string()
      .describe(
        "The org's billing/lifecycle state (e.g. 'active', 'pending_deletion'). Gating on this state runs before the authorization layer; a frozen org blocks writes.",
      ),
    createdAt: z.string().describe('ISO-8601 timestamp of when the org was created.'),
  })
  .meta({ id: 'OrgOut', description: 'An organization.' });
/** Organization representation value. */
export type OrgOut = z.infer<typeof OrgOut>;

/** Compact organization summary for membership lists / the org rail. */
export const OrgSummary = z
  .object({
    id: OrganizationId.describe('Stable ULID identifier of the organization.'),
    name: z.string().describe("The organization's display name, shown in the org switcher."),
    slug: z.string().describe('URL-safe unique identifier used in paths and the web app URL.'),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe("URL of the org's avatar/logo; null when none uploaded."),
    isPersonal: z
      .boolean()
      .describe('True for a personal space (org-of-one); false for a team org.'),
  })
  .meta({ id: 'OrgSummary', description: 'A compact organization summary.' });
/** Organization summary value. */
export type OrgSummary = z.infer<typeof OrgSummary>;

/** Settings that control the work model within one workspace context. */
export const WorkspaceSettingsOut = z
  .object({
    initiativeMaxDepth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe('Maximum total levels in the workspace Initiative hierarchy.'),
  })
  .meta({ id: 'WorkspaceSettingsOut', description: 'Workspace work-structure settings.' });
/** Workspace settings representation. */
export type WorkspaceSettingsOut = z.infer<typeof WorkspaceSettingsOut>;

/** Mutable workspace work-structure settings. */
export const WorkspaceSettingsUpdate = WorkspaceSettingsOut.partial().meta({
  id: 'WorkspaceSettingsUpdate',
  description: 'Workspace work-structure settings to update.',
});
/** Workspace settings update body. */
export type WorkspaceSettingsUpdate = z.infer<typeof WorkspaceSettingsUpdate>;

/** The default team returned alongside a freshly-created org. */
export const DefaultTeamOut = z
  .object({
    id: TeamId.describe('Stable ULID identifier of the seeded default team.'),
    name: z.string().describe("The default team's display name (seeded as 'General')."),
    key: z
      .string()
      .describe("The default team's short key, unique within the org (seeded as 'GEN')."),
  })
  .meta({ id: 'DefaultTeamOut', description: "An org's default team." });
/** Default-team value. */
export type DefaultTeamOut = z.infer<typeof DefaultTeamOut>;

/** The org-create response: the org plus its seeded default team + owner actor. */
export const OrgCreateResult = z
  .object({
    organization: OrgOut.describe(
      'The newly created (or, for an idempotent personal space, existing) organization.',
    ),
    defaultTeam: DefaultTeamOut.describe(
      "The org's seeded default team ('General' / 'GEN'), which the client can immediately scope work to.",
    ),
    ownerActorId: ActorId.describe(
      "The id of the creator's Owner human Actor in the new org — the caller's identity for subsequent `/:orgId/*` calls.",
    ),
  })
  .meta({ id: 'OrgCreateResult', description: 'Result of creating an organization.' });
/** Org-create result value. */
export type OrgCreateResult = z.infer<typeof OrgCreateResult>;
