/**
 * `@docket/types` — Initiative slice DTOs.
 */
import { z } from 'zod';

import { Health } from './capability';
import { AttachmentOut } from './attachment';
import { LabelOut } from './label';
import {
  ActorId,
  Id,
  InitiativeId,
  LabelId,
  OrganizationId,
  ProgramId,
  ProjectId,
} from './primitives';
import { UpdateOut } from './update';

/** Initiative (theme) status. */
export const InitiativeStatus = z
  .enum(['proposed', 'active', 'completed', 'canceled'])
  .describe('Manually owned Initiative lifecycle: proposed, active, completed, or canceled.');
/** Initiative status value. */
export type InitiativeStatus = z.infer<typeof InitiativeStatus>;

/** Initiative priority. */
export const InitiativePriority = z
  .enum(['none', 'low', 'medium', 'high'])
  .describe('The Initiative priority; defaults to none.');
/** Initiative priority value. */
export type InitiativePriority = z.infer<typeof InitiativePriority>;

/** Expected interval between narrative Initiative updates. */
export const InitiativeUpdateCadence = z
  .enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'none'])
  .describe('The update interval used to determine whether an active Initiative is stale.');
/** Initiative update cadence value. */
export type InitiativeUpdateCadence = z.infer<typeof InitiativeUpdateCadence>;

/** Body for creating an Initiative (organizationId comes from the path, never the body). */
export const InitiativeCreate = z
  .object({
    name: z
      .string()
      .min(1)
      .describe('Human-readable initiative (theme) name. Required, non-empty.'),
    description: z.string().optional().describe('Optional free-text description of the theme.'),
    summary: z
      .string()
      .max(280)
      .optional()
      .describe('Optional plain-text summary, limited to 280 characters.'),
    ownerId: ActorId.optional().describe(
      'Optional owning Actor (accountable person). Must reference an Actor in the caller’s org (404 `Owner not found` otherwise).',
    ),
    status: InitiativeStatus.optional().describe(
      'Initial status. Defaults to `active` when omitted.',
    ),
    priority: InitiativePriority.optional().describe(
      'Initial priority. Defaults to `none` when omitted.',
    ),
    updateCadence: InitiativeUpdateCadence.optional().describe(
      'Expected update interval. Defaults to `monthly` when omitted.',
    ),
    targetDate: z.iso
      .date()
      .optional()
      .describe('Optional planned completion date (ISO-8601 `YYYY-MM-DD`).'),
    health: Health.optional().describe(
      'Optional initial health verdict (`on_track`/`at_risk`/`off_track`). Omit to leave unset.',
    ),
    labelIds: z
      .array(LabelId)
      .optional()
      .describe('Organization-global Labels to attach during creation.'),
  })
  .meta({ id: 'InitiativeCreate', description: 'Create an initiative within an organization.' });
/** Validated initiative-create body. */
export type InitiativeCreate = z.infer<typeof InitiativeCreate>;

/** Body for updating an Initiative (all fields optional). */
export const InitiativeUpdate = z
  .object({
    name: z
      .string()
      .min(1)
      .optional()
      .describe('New name. Omit to leave unchanged; non-empty when set.'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('New description. Omit to leave unchanged; `null` clears it.'),
    summary: z
      .string()
      .max(280)
      .nullable()
      .optional()
      .describe('New plain-text summary. Omit to leave unchanged; `null` clears it.'),
    ownerId: ActorId.nullable()
      .optional()
      .describe(
        'Re-point the owner (must be an Actor in the caller’s org). Omit to leave unchanged; `null` clears it.',
      ),
    status: InitiativeStatus.optional().describe(
      'New lifecycle status. Including this emits a status-change observation.',
    ),
    priority: InitiativePriority.optional().describe('New priority. Omit to leave unchanged.'),
    updateCadence: InitiativeUpdateCadence.optional().describe(
      'New expected update interval. Omit to leave unchanged.',
    ),
    targetDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe(
        'New planned completion date (ISO-8601). Omit to leave unchanged; `null` clears it.',
      ),
    health: Health.nullable()
      .optional()
      .describe('New health verdict. Omit to leave unchanged; `null` clears it.'),
    labelIds: z
      .array(LabelId)
      .optional()
      .describe('Complete replacement set of organization-global Labels.'),
  })
  .meta({ id: 'InitiativeUpdate', description: 'Update an initiative.' });
/** Validated initiative-update body. */
export type InitiativeUpdate = z.infer<typeof InitiativeUpdate>;

/** Full initiative representation returned by reads. */
export const InitiativeOut = z
  .object({
    id: InitiativeId.describe('Stable unique identifier of the initiative.'),
    organizationId: OrganizationId.describe('The owning organization (tenant).'),
    name: z.string().describe('Human-readable initiative name.'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Free-text description, or `null`/absent when none.'),
    summary: z.string().nullable().describe('Plain-text summary, or `null` when none.'),
    ownerId: ActorId.nullable()
      .optional()
      .describe('The owning Actor (accountable person), or `null` when unowned.'),
    status: InitiativeStatus.describe('The manually owned lifecycle status.'),
    priority: InitiativePriority.describe('The Initiative priority.'),
    updateCadence: InitiativeUpdateCadence.describe('The expected narrative update interval.'),
    targetDate: z
      .string()
      .nullable()
      .optional()
      .describe('Planned completion date (ISO-8601 string), or `null` when undated.'),
    health: Health.nullable()
      .optional()
      .describe(
        'The stored health verdict, or `null` when unset (the detail’s `rolledUpHealth` is derived from children instead).',
      ),
    createdAt: z.string().describe('When the initiative was created (ISO-8601 timestamp).'),
  })
  .meta({ id: 'InitiativeOut', description: 'An initiative.' });
/** Initiative representation value. */
export type InitiativeOut = z.infer<typeof InitiativeOut>;

/**
 * A health distribution: how many of an Initiative's associated children fall into each
 * `Health` bucket, plus the number that carry no health verdict.
 *
 * @remarks
 * An Initiative contains no work itself; its rolled-up signal is derived purely from the
 * `health` of the Projects + Programs it associates with (data-model §4.1/§7). A child
 * with a null `health` is counted in {@link InitiativeHealthDistribution.unknown} rather
 * than silently treated as on-track.
 */
export const InitiativeHealthDistribution = z
  .object({
    onTrack: z
      .number()
      .int()
      .min(0)
      .describe('Count of associated children (Projects + Programs) whose `health` is `on_track`.'),
    atRisk: z
      .number()
      .int()
      .min(0)
      .describe('Count of associated children whose `health` is `at_risk`.'),
    offTrack: z
      .number()
      .int()
      .min(0)
      .describe('Count of associated children whose `health` is `off_track`.'),
    unknown: z
      .number()
      .int()
      .min(0)
      .describe(
        'Count of associated children that carry no `health` verdict yet (counted here rather than silently treated as on-track).',
      ),
  })
  .meta({
    id: 'InitiativeHealthDistribution',
    description: "Counts of an initiative's children per health bucket.",
  });
/** Initiative health-distribution value. */
export type InitiativeHealthDistribution = z.infer<typeof InitiativeHealthDistribution>;

/**
 * The count of each kind of child an Initiative associates with (its m2m membership mix).
 *
 * @remarks
 * The `childMix` referenced by the api-rpc-contract §3.3 `InitiativeOut` roll-up: how many
 * Programs and Projects the Initiative spans, regardless of their health/status.
 */
export const InitiativeChildMix = z
  .object({
    programs: z
      .number()
      .int()
      .min(0)
      .describe('Number of associated Programs (via `initiative_program` edges).'),
    projects: z
      .number()
      .int()
      .min(0)
      .describe('Number of associated Projects (via `initiative_project` edges).'),
  })
  .meta({ id: 'InitiativeChildMix', description: "An initiative's program/project counts." });
/** Initiative child-mix value. */
export type InitiativeChildMix = z.infer<typeof InitiativeChildMix>;

/**
 * Full Initiative detail: the base {@link InitiativeOut} plus the membership roll-up.
 *
 * @remarks
 * Because an Initiative carries no work, the detail enriches the stored row with values
 * derived from its associated children:
 * - `childMix` — how many Programs/Projects it spans.
 * - `distribution` — the per-health-bucket breakdown of those children.
 * - `rolledUpHealth` — the worst child health (`off_track > at_risk > on_track`), or `null`
 *   when no child carries a verdict. This is the auto-derived signal the contract calls for.
 * Connected-work health never overwrites the independently writable Initiative health.
 */
export const InitiativeDetail = InitiativeOut.extend({
  childMix: InitiativeChildMix.describe(
    'The program/project membership counts (how many of each the initiative spans).',
  ),
  distribution: InitiativeHealthDistribution.describe(
    'The per-health-bucket breakdown of the associated children.',
  ),
  rolledUpHealth: Health.nullable().describe(
    'The single worst child health (`off_track ≻ at_risk ≻ on_track`), or `null` when no child carries a verdict. The auto-derived health signal for the theme.',
  ),
}).meta({ id: 'InitiativeDetail', description: 'An initiative with its child roll-up.' });
/** Initiative detail value. */
export type InitiativeDetail = z.infer<typeof InitiativeDetail>;

/** Body for placing an Initiative beneath another in the current workspace context. */
export const InitiativeHierarchyLinkCreate = z
  .object({
    parentInitiativeId: InitiativeId.describe('Parent Initiative in the workspace hierarchy.'),
    childInitiativeId: InitiativeId.describe('Child Initiative in the workspace hierarchy.'),
  })
  .meta({
    id: 'InitiativeHierarchyLinkCreate',
    description: 'Create a context-owned Initiative hierarchy link.',
  });
/** Validated Initiative hierarchy-link create body. */
export type InitiativeHierarchyLinkCreate = z.infer<typeof InitiativeHierarchyLinkCreate>;

/** Body for moving an existing hierarchy link beneath a different parent. */
export const InitiativeHierarchyLinkMove = z
  .object({
    parentInitiativeId: InitiativeId.describe('New parent Initiative in the same context.'),
  })
  .meta({
    id: 'InitiativeHierarchyLinkMove',
    description: 'Move a context-owned Initiative hierarchy link.',
  });
/** Validated Initiative hierarchy-link move body. */
export type InitiativeHierarchyLinkMove = z.infer<typeof InitiativeHierarchyLinkMove>;

/** One context-owned Initiative hierarchy edge. */
export const InitiativeHierarchyLinkOut = z
  .object({
    id: Id.describe('Stable hierarchy-link identifier.'),
    contextOrganizationId: OrganizationId.describe('Workspace that owns this hierarchy edge.'),
    parentInitiativeId: InitiativeId.describe('Parent Initiative.'),
    childInitiativeId: InitiativeId.describe('Child Initiative.'),
    createdAt: z.string().describe('Creation timestamp (ISO-8601).'),
  })
  .meta({
    id: 'InitiativeHierarchyLinkOut',
    description: 'A context-owned Initiative hierarchy link.',
  });
/** Initiative hierarchy-link representation. */
export type InitiativeHierarchyLinkOut = z.infer<typeof InitiativeHierarchyLinkOut>;

/** URL resource attached to an Initiative strategic document. */
export const InitiativeResourceCreate = z
  .object({
    title: z.string().min(1).describe('Human-readable resource title.'),
    url: z.url().describe('External URL referenced by the Initiative.'),
  })
  .meta({ id: 'InitiativeResourceCreate', description: 'Attach a URL to an Initiative.' });
/** Validated Initiative resource body. */
export type InitiativeResourceCreate = z.infer<typeof InitiativeResourceCreate>;

/** Compact Initiative reference used by context hierarchy reads. */
export const InitiativeReference = z.object({
  id: InitiativeId,
  organizationId: OrganizationId,
  organizationName: z.string(),
  name: z.string(),
  status: InitiativeStatus,
  health: Health.nullable(),
  crossWorkspace: z.boolean(),
});
/** Compact Initiative reference value. */
export type InitiativeReference = z.infer<typeof InitiativeReference>;

/** One visible row in the context hierarchy overview. */
export const InitiativeOverviewItem = InitiativeOut.extend({
  organizationName: z.string(),
  parentInitiativeId: InitiativeId.nullable(),
  depth: z.number().int().min(1).max(5),
  childCount: z.number().int().min(0),
  ownerName: z.string().nullable(),
  lastUpdateAt: z.string().nullable(),
}).meta({ id: 'InitiativeOverviewItem', description: 'One Initiative hierarchy overview row.' });
/** Initiative hierarchy overview row value. */
export type InitiativeOverviewItem = z.infer<typeof InitiativeOverviewItem>;

/** Severity category for an executive attention item. */
export const InitiativeAttentionSeverity = z.enum(['off_track', 'at_risk', 'stale']);
/** Initiative attention severity value. */
export type InitiativeAttentionSeverity = z.infer<typeof InitiativeAttentionSeverity>;

/** One deterministic executive attention item. */
export const InitiativeAttentionItem = z.object({
  initiativeId: InitiativeId,
  organizationId: OrganizationId,
  organizationName: z.string(),
  parentInitiativeId: InitiativeId.nullable(),
  parentInitiativeName: z.string().nullable(),
  title: z.string(),
  excerpt: z.string().nullable(),
  severity: InitiativeAttentionSeverity,
  action: z.enum(['open', 'update']),
  lastUpdateAt: z.string().nullable(),
});
/** Initiative attention item value. */
export type InitiativeAttentionItem = z.infer<typeof InitiativeAttentionItem>;

/** Aggregate executive Initiative overview. */
export const InitiativeOverviewOut = z.object({
  items: z.array(InitiativeOverviewItem),
  attention: z.array(InitiativeAttentionItem).max(4),
});
/** Aggregate Initiative overview value. */
export type InitiativeOverviewOut = z.infer<typeof InitiativeOverviewOut>;

/** A direct or descendant Program/Project contributing to an Initiative rollup. */
export const InitiativeConnectedWork = z.object({
  kind: z.enum(['program', 'project']),
  id: z.string(),
  organizationId: OrganizationId,
  name: z.string(),
  status: z.string(),
  health: Health.nullable(),
  direct: z.boolean(),
  inheritedThroughInitiativeId: InitiativeId.nullable(),
});
/** Connected Initiative work row value. */
export type InitiativeConnectedWork = z.infer<typeof InitiativeConnectedWork>;

/** Aggregate document-detail read in one workspace hierarchy context. */
export const InitiativeAggregateDetail = InitiativeDetail.extend({
  contextOrganizationId: OrganizationId,
  parent: InitiativeReference.nullable(),
  children: z.array(InitiativeReference),
  connectedWork: z.array(InitiativeConnectedWork),
  labels: z.array(LabelOut),
  resources: z.array(AttachmentOut),
  latestUpdate: UpdateOut.nullable(),
  updateCount: z.number().int().min(0),
}).meta({ id: 'InitiativeAggregateDetail', description: 'Aggregate Initiative document detail.' });
/** Aggregate Initiative detail value. */
export type InitiativeAggregateDetail = z.infer<typeof InitiativeAggregateDetail>;

/** Body for linking a Project to an Initiative (the initiative id comes from the path). */
export const InitiativeProjectLink = z
  .object({
    projectId: ProjectId.describe(
      'The Project to associate with the Initiative. Must live in the caller’s org (404 otherwise); a duplicate link is rejected with 409.',
    ),
  })
  .meta({ id: 'InitiativeProjectLink', description: 'Associate a project with an initiative.' });
/** Validated initiative→project link body. */
export type InitiativeProjectLink = z.infer<typeof InitiativeProjectLink>;

/** Body for linking a Program to an Initiative (the initiative id comes from the path). */
export const InitiativeProgramLink = z
  .object({
    programId: ProgramId.describe(
      'The Program to associate with the Initiative. Must live in the caller’s org (404 otherwise); a duplicate link is rejected with 409.',
    ),
  })
  .meta({ id: 'InitiativeProgramLink', description: 'Associate a program with an initiative.' });
/** Validated initiative→program link body. */
export type InitiativeProgramLink = z.infer<typeof InitiativeProgramLink>;

/** Result of linking a Project to an Initiative. */
export const InitiativeProjectLinked = z
  .object({
    initiativeId: InitiativeId.describe('The initiative that was linked.'),
    projectId: ProjectId.describe('The project that was linked.'),
    linked: z.literal(true).describe('Always `true`; the `initiative_project` edge now exists.'),
  })
  .meta({ id: 'InitiativeProjectLinked', description: 'An initiative↔project link result.' });
/** Initiative→project link result value. */
export type InitiativeProjectLinked = z.infer<typeof InitiativeProjectLinked>;

/** Result of linking a Program to an Initiative. */
export const InitiativeProgramLinked = z
  .object({
    initiativeId: InitiativeId.describe('The initiative that was linked.'),
    programId: ProgramId.describe('The program that was linked.'),
    linked: z.literal(true).describe('Always `true`; the `initiative_program` edge now exists.'),
  })
  .meta({ id: 'InitiativeProgramLinked', description: 'An initiative↔program link result.' });
/** Initiative→program link result value. */
export type InitiativeProgramLinked = z.infer<typeof InitiativeProgramLinked>;

/** Result of unlinking a child (Project or Program) from an Initiative. */
export const InitiativeUnlinked = z
  .object({
    unlinked: z.literal(true).describe('Always `true`; the association edge no longer exists.'),
  })
  .meta({ id: 'InitiativeUnlinked', description: 'An initiative child-unlink result.' });
/** Initiative child-unlink result value. */
export type InitiativeUnlinked = z.infer<typeof InitiativeUnlinked>;

/**
 * One timeline bar for an associated Project (a bounded, dated effort).
 *
 * @remarks
 * The roadmap-first roll-up (api-rpc-contract §3.3 `GET /:initiativeId/timeline`): each
 * associated Project becomes a dated bar with its current `status`/`health`. `startDate`
 * and `targetDate` may be null when the Project has not been scheduled.
 */
export const InitiativeTimelineBar = z
  .object({
    id: ProjectId.describe('The associated Project this bar represents.'),
    name: z.string().describe('The Project’s display name.'),
    status: z
      .string()
      .describe('The Project’s lifecycle status (`planned`/`active`/`completed`/`canceled`).'),
    health: Health.nullable().describe('The Project’s health verdict, or `null` when unset.'),
    startDate: z
      .string()
      .nullable()
      .describe('ISO start date (the bar’s left edge), or `null` when the Project is unscheduled.'),
    targetDate: z
      .string()
      .nullable()
      .describe('ISO target/end date (the bar’s right edge), or `null` when unscheduled.'),
  })
  .meta({ id: 'InitiativeTimelineBar', description: 'A project bar on an initiative timeline.' });
/** Initiative timeline project-bar value. */
export type InitiativeTimelineBar = z.infer<typeof InitiativeTimelineBar>;

/**
 * One timeline lane for an associated Program (an ongoing area of operations).
 *
 * @remarks
 * Programs have no end state, so a lane carries no end date — only its identity, current
 * `status`, and `health`. Lanes render above the Project bars on the roadmap.
 */
export const InitiativeTimelineLane = z
  .object({
    id: ProgramId.describe('The associated Program this lane represents.'),
    name: z.string().describe('The Program’s display name.'),
    status: z.string().describe('The Program’s status (`active`/`paused`/`archived`).'),
    health: Health.nullable().describe('The Program’s health verdict, or `null` when unset.'),
  })
  .meta({ id: 'InitiativeTimelineLane', description: 'A program lane on an initiative timeline.' });
/** Initiative timeline program-lane value. */
export type InitiativeTimelineLane = z.infer<typeof InitiativeTimelineLane>;

/**
 * The roadmap-first timeline roll-up for an Initiative: its Program lanes + Project bars.
 *
 * @remarks
 * Returned by `GET /:initiativeId/timeline`. The optional `from`/`to` query window filters
 * the Project bars to those that overlap the window (a Project overlaps when it has no
 * dates, or its `[startDate, targetDate]` intersects `[from, to]`); Program lanes are
 * always returned (they are ongoing and undated).
 */
export const InitiativeTimelineOut = z
  .object({
    programs: z
      .array(InitiativeTimelineLane)
      .describe(
        'Ongoing, undated Program lanes associated with the Initiative — always returned in full (not windowed).',
      ),
    projects: z
      .array(InitiativeTimelineBar)
      .describe(
        'Dated Project bars associated with the Initiative, filtered to those overlapping the optional `from`/`to` window (unscheduled projects always included).',
      ),
  })
  .meta({ id: 'InitiativeTimelineOut', description: 'An initiative roadmap roll-up.' });
/** Initiative timeline value. */
export type InitiativeTimelineOut = z.infer<typeof InitiativeTimelineOut>;

/** Query window for the Initiative timeline (both bounds optional ISO dates). */
export const InitiativeTimelineQuery = z
  .object({
    from: z.iso
      .date()
      .optional()
      .describe(
        'Lower bound (ISO-8601 `YYYY-MM-DD`) of the window. Open when omitted. Filters Project bars only.',
      ),
    to: z.iso
      .date()
      .optional()
      .describe(
        'Upper bound (ISO-8601 `YYYY-MM-DD`) of the window (inclusive through end-of-day). Open when omitted. Filters Project bars only.',
      ),
  })
  .meta({ id: 'InitiativeTimelineQuery', description: 'Initiative timeline window query.' });
/** Validated initiative-timeline query value. */
export type InitiativeTimelineQuery = z.infer<typeof InitiativeTimelineQuery>;
