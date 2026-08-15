/**
 * `@docket/types` — Organization slice DTOs.
 */
import { z } from 'zod';
import { VocabularyPreset, VocabularySkin } from '@docket/work/vocabulary';

import { ActorId, OrganizationId, TeamId } from './primitives';
import { SettingsImageValue } from './settings-image';
import { PublicSlug } from './slug';

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
    slug: PublicSlug.optional().describe(
      "The org's one identifier: its internal key and, unless a custom domain is set, the path segment its published briefs answer on by default. Must be unique across all orgs (the `organization_slug_uq` index) and not one of the reserved system names. When omitted it is auto-derived — from the name for team orgs, or `personal-<userId>` for personal spaces — and disambiguated with a numeric suffix on collision. When supplied explicitly, a collision is rejected with 409 instead of being disambiguated.",
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

/** Mutable, user-facing workspace identity attributes. */
export const OrgUpdate = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("The workspace's editable display name."),
    purpose: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .describe('A concise workspace purpose; null clears the current purpose.'),
    slug: PublicSlug.optional().describe(
      "The workspace's one identifier: its internal key and, unless a custom domain is set, the path segment its published briefs answer on by default. Globally unique; not one of the reserved system names.",
    ),
    avatar: SettingsImageValue.nullable()
      .optional()
      .describe('The workspace logo image; null removes the current logo.'),
    vocabulary: VocabularyPreset.optional().describe(
      'The terminology preset used for work throughout the workspace.',
    ),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one workspace change.')
  .meta({ id: 'OrgUpdate', description: 'Editable workspace identity settings.' });
/** Validated workspace identity update body. */
export type OrgUpdate = z.infer<typeof OrgUpdate>;

/** Full organization representation returned by reads. */
export const OrgOut = z
  .object({
    id: OrganizationId.describe('Stable ULID identifier of the organization.'),
    name: z.string().describe("The organization's display name."),
    slug: z
      .string()
      .describe(
        "The workspace's one identifier: unique across all orgs, and — unless a custom domain is set — the path segment its published briefs answer on by default.",
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
    slug: z
      .string()
      .describe("The workspace's one identifier — see {@link OrgOut.slug} for its full role."),
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

/**
 * The workspace-wide task-estimation scale — which fixed set of point values `task.estimate`
 * is chosen from, mirroring Linear's per-workspace estimate setting.
 *
 * @remarks
 * `none` turns estimation off entirely: no picker renders anywhere in the product, though any
 * `estimate` already stored on a task is left alone rather than silently cleared. See
 * {@link ESTIMATION_SCALES} for the point values/labels each of the other four scales offers.
 */
export const EstimationScale = z
  .enum(['none', 'exponential', 'fibonacci', 'linear', 't_shirt'])
  .describe(
    "The workspace's task-estimation scale: 'none' (no estimates), 'exponential' " +
      "(1, 2, 4, 8, 16, 32), 'fibonacci' (0, 1, 2, 3, 5, 8, 13, 21), 'linear' (1–10), or " +
      "'t_shirt' (XS–XL).",
  );
/** Workspace estimation-scale value. */
export type EstimationScale = z.infer<typeof EstimationScale>;

/** One selectable point value a task estimate picker offers, under a given scale. */
export interface EstimationScaleOption {
  /** The integer persisted to `task.estimate`. */
  readonly value: number;
  /** The label a picker shows for this value (a bare number for every scale but t-shirt). */
  readonly label: string;
}

/** Human label for each {@link EstimationScale}, for the workspace settings picker. */
export const ESTIMATION_SCALE_LABEL: Readonly<Record<EstimationScale, string>> = {
  none: 'No estimates',
  exponential: 'Exponential',
  fibonacci: 'Fibonacci',
  linear: 'Linear',
  t_shirt: 'T-shirt sizes',
};

/**
 * The single source of truth for what point values each {@link EstimationScale} offers, in
 * picker order. Read by both the workspace settings picker (to describe each scale option) and
 * the task estimate picker (to build its choices once a workspace's scale is known).
 */
export const ESTIMATION_SCALES: Readonly<
  Record<EstimationScale, readonly EstimationScaleOption[]>
> = {
  none: [],
  exponential: [1, 2, 4, 8, 16, 32].map((value) => ({ value, label: String(value) })),
  fibonacci: [0, 1, 2, 3, 5, 8, 13, 21].map((value) => ({ value, label: String(value) })),
  linear: Array.from({ length: 10 }, (_, i) => i + 1).map((value) => ({
    value,
    label: String(value),
  })),
  t_shirt: [
    { value: 1, label: 'XS' },
    { value: 2, label: 'S' },
    { value: 3, label: 'M' },
    { value: 5, label: 'L' },
    { value: 8, label: 'XL' },
  ],
};

/** Settings that control the work model within one workspace context. */
export const WorkspaceSettingsOut = z
  .object({
    initiativeMaxDepth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe('Maximum total levels in the workspace Initiative hierarchy.'),
    estimationScale: EstimationScale.describe(
      "The workspace's task-estimation scale. Determines which point values the task " +
        'estimate picker offers; see {@link ESTIMATION_SCALES}.',
    ),
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
