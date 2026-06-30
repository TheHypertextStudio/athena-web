/**
 * `@docket/types` — Saved View slice DTOs.
 */
import { z } from 'zod';

import { ActorId, OrganizationId, SavedViewId, TeamId } from './primitives';

/** A saved view's sharing scope. */
export const ViewScope = z.enum(['personal', 'team', 'organization']);
/** View scope value. */
export type ViewScope = z.infer<typeof ViewScope>;

/** One predicate in a saved view's filter set. */
export const ViewFilter = z
  .object({
    field: z
      .string()
      .describe(
        'Task field the predicate tests (e.g. `state`, `assigneeId`, `priority`, `labels`).',
      ),
    op: z
      .enum(['eq', 'neq', 'in', 'nin', 'gt', 'lt', 'contains'])
      .describe(
        "Comparison operator: 'eq' (=), 'neq' (≠), 'in' (in set), 'nin' (not in set), 'gt' (>), 'lt' (<), 'contains' (substring/membership).",
      ),
    value: z
      .unknown()
      .describe(
        'Operand to compare against — a scalar for `eq`/`neq`/`gt`/`lt`/`contains`, an array for `in`/`nin`. Shape depends on `field` and `op`.',
      ),
  })
  .meta({ id: 'ViewFilter', description: 'A saved-view filter predicate.' });
/** View filter value. */
export type ViewFilter = z.infer<typeof ViewFilter>;

/** A saved view's grouping config (group + optional sub-group). */
export const ViewGrouping = z
  .object({
    by: z
      .string()
      .describe('Primary grouping field (e.g. `state` for a board, `assigneeId`, `priority`).'),
    subBy: z
      .string()
      .optional()
      .describe('Optional secondary grouping field nested within each primary group.'),
  })
  .meta({ id: 'ViewGrouping', description: 'A saved-view grouping config.' });
/** View grouping value. */
export type ViewGrouping = z.infer<typeof ViewGrouping>;

/** One sort term in a saved view. */
export const ViewSort = z
  .object({
    field: z.string().describe('Task field to sort by (e.g. `priority`, `dueDate`, `createdAt`).'),
    order: z
      .enum(['asc', 'desc'])
      .describe("Sort direction: 'asc' (ascending) or 'desc' (descending)."),
  })
  .meta({ id: 'ViewSort', description: 'A saved-view sort term.' });
/** View sort value. */
export type ViewSort = z.infer<typeof ViewSort>;

/** Body for creating a Saved View (organizationId comes from the path, never the body). */
export const SavedViewCreate = z
  .object({
    name: z.string().min(1).describe('Human label for the view. Required, non-empty.'),
    scope: ViewScope.optional().describe(
      "Sharing scope: 'personal' | 'team' | 'organization'. Defaults to 'personal'.",
    ),
    ownerActorId: ActorId.optional().describe(
      'Owning actor. Defaults to the calling actor. Mainly meaningful for a `personal` view.',
    ),
    teamId: TeamId.optional().describe(
      'Team the view belongs to; relevant when `scope` is `team`. Must be a team in the caller’s org.',
    ),
    filters: z
      .array(ViewFilter)
      .optional()
      .describe('Filter predicates (ANDed). Defaults to an empty array (no filtering).'),
    grouping: ViewGrouping.nullable()
      .optional()
      .describe('Grouping config, or null for a flat list. Defaults to null.'),
    sort: z
      .array(ViewSort)
      .optional()
      .describe(
        'Ordered sort terms applied in sequence. Defaults to an empty array (no explicit sort).',
      ),
  })
  .meta({ id: 'SavedViewCreate', description: 'Create a saved view within an organization.' });
/** Validated saved-view-create body. */
export type SavedViewCreate = z.infer<typeof SavedViewCreate>;

/** Body for updating a Saved View (all fields optional). */
export const SavedViewUpdate = z
  .object({
    name: z.string().min(1).optional().describe('New name (non-empty). Omit to leave unchanged.'),
    scope: ViewScope.optional().describe(
      "New sharing scope: 'personal' | 'team' | 'organization'. Omit to leave unchanged.",
    ),
    ownerActorId: ActorId.nullable()
      .optional()
      .describe('Re-owner the view, or null to clear. Omit to leave unchanged.'),
    teamId: TeamId.nullable()
      .optional()
      .describe('Re-scope to this team, or null to clear. Omit to leave unchanged.'),
    filters: z
      .array(ViewFilter)
      .optional()
      .describe(
        'Replacement filter set (replaces wholesale, not merged). Omit to leave unchanged.',
      ),
    grouping: ViewGrouping.nullable()
      .optional()
      .describe('New grouping config, or null to flatten. Omit to leave unchanged.'),
    sort: z
      .array(ViewSort)
      .optional()
      .describe('Replacement sort terms (replaces wholesale). Omit to leave unchanged.'),
  })
  .meta({ id: 'SavedViewUpdate', description: 'Update a saved view.' });
/** Validated saved-view-update body. */
export type SavedViewUpdate = z.infer<typeof SavedViewUpdate>;

/** Full saved-view representation returned by reads. */
export const SavedViewOut = z
  .object({
    id: SavedViewId.describe('Opaque saved-view id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    name: z.string().describe('Human label for the view.'),
    scope: ViewScope.describe("Sharing scope: 'personal' | 'team' | 'organization'."),
    ownerActorId: ActorId.nullable().optional().describe('Owning actor; null when ownerless.'),
    teamId: TeamId.nullable()
      .optional()
      .describe('Team the view belongs to; null for personal/org-wide views.'),
    filters: z.array(ViewFilter).describe('Filter predicates (ANDed) the view applies.'),
    grouping: ViewGrouping.nullable().optional().describe('Grouping config; null for a flat list.'),
    sort: z.array(ViewSort).describe('Ordered sort terms the view applies.'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'SavedViewOut', description: 'A saved view.' });
/** Saved-view representation value. */
export type SavedViewOut = z.infer<typeof SavedViewOut>;
