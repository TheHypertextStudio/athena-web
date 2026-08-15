/**
 * `@docket/types` — Work status slice DTOs.
 *
 * @remarks
 * A work status is one entry in a workspace's status set for a kind of work: `Todo`,
 * `In Review`, `Shipped`. A workspace defines its own names, descriptions, ordering, and
 * how many it wants, for each of Tasks, Projects, Programs, and Initiatives.
 *
 * Every status maps onto exactly one of the five {@link WorkStatusCategory} values, and the
 * category is what carries meaning outside the workspace that named it. Two workspaces can
 * call the same stage `Shipped` and `Live`; both are `completed`. So a status glyph, a
 * cross-team comparison, a progress calculation, and every integration mapping key off the
 * category, while the `key` identifies the row within one set.
 *
 * This module is the single declaration of that category union. `@docket/db`, `@docket/ui`,
 * and `@docket/integrations` all import it from here.
 */
import { z } from 'zod';

import { OrganizationId, TeamId, WorkStatusId } from './primitives';

/**
 * The five canonical categories every work status maps onto, in board order.
 *
 * @remarks
 * Ordered from not-yet-committed through terminal, so the index of a category is its display
 * rank. The set is fixed: a workspace chooses names, ordering, and count, and each status it
 * creates declares which of these five it behaves as.
 */
export const WORK_STATUS_CATEGORIES = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
] as const;

/** Zod schema for a work-status category. */
export const WorkStatusCategory = z
  .enum(WORK_STATUS_CATEGORIES)
  .describe(
    "The canonical category a status behaves as, driving status glyphs, grouping, and progress: 'backlog' (not yet committed) | 'unstarted' (committed, not begun) | 'started' (in progress) | 'completed' (done) | 'canceled' (abandoned). Several statuses in one set may share a category.",
  );
/** A work-status category. */
export type WorkStatusCategory = z.infer<typeof WorkStatusCategory>;

/**
 * The display rank of each {@link WorkStatusCategory}.
 *
 * @remarks
 * A status set sorts by category rank first, then by {@link WorkStatusOut.position} within the
 * category, so a list reads top-to-bottom as work progresses.
 *
 * @example
 * ```typescript
 * statuses.sort(
 *   (a, b) =>
 *     WORK_STATUS_CATEGORY_RANK[a.category] - WORK_STATUS_CATEGORY_RANK[b.category] ||
 *     a.position - b.position,
 * );
 * ```
 */
export const WORK_STATUS_CATEGORY_RANK: Record<WorkStatusCategory, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  canceled: 4,
};

/**
 * Compare two statuses by board order: category rank first, then position within the category.
 *
 * @remarks
 * The one ordering rule, exported so the API resolver, the settings list, and every picker sort
 * a set the same way. Statuses are reordered within their category, so this comparator is what
 * makes the stored `position` meaningful.
 *
 * @param a - The first status.
 * @param b - The second status.
 * @returns A negative number when `a` sorts first, positive when `b` does, `0` when equal.
 *
 * @example
 * ```typescript
 * const ordered = [...statuses].sort(compareWorkStatusOrder);
 * ```
 */
export function compareWorkStatusOrder(
  a: { readonly category: WorkStatusCategory; readonly position: number },
  b: { readonly category: WorkStatusCategory; readonly position: number },
): number {
  const byCategory = WORK_STATUS_CATEGORY_RANK[a.category] - WORK_STATUS_CATEGORY_RANK[b.category];
  return byCategory === 0 ? a.position - b.position : byCategory;
}

/**
 * The categories that end a piece of work.
 *
 * @remarks
 * Entering a status in one of these stamps the owning row's `completedAt` or `canceledAt`, which
 * is what progress, capacity, and throughput read. Leaving one clears both.
 */
export const TERMINAL_CATEGORIES = ['completed', 'canceled'] as const;

/**
 * Whether a category ends a piece of work.
 *
 * @param category - The category to test.
 * @returns `true` for `completed` and `canceled`.
 *
 * @see {@link TERMINAL_CATEGORIES}
 */
export function isTerminalCategory(category: WorkStatusCategory): boolean {
  return category === 'completed' || category === 'canceled';
}

/** The kinds of work that carry a workspace-defined status set. */
export const WORK_STATUS_ENTITY_TYPES = ['task', 'project', 'program', 'initiative'] as const;

/** Zod schema for the kind of work a status set applies to. */
export const WorkStatusEntityType = z
  .enum(WORK_STATUS_ENTITY_TYPES)
  .describe(
    'The kind of work this status set applies to. Cycles are absent because a Cycle’s status follows its dates rather than a choice.',
  );
/** The kind of work a status set applies to. */
export type WorkStatusEntityType = z.infer<typeof WorkStatusEntityType>;

/**
 * A status name: non-empty once trimmed.
 *
 * @remarks
 * `min(1)` alone accepts `'   '`, which becomes a status nobody can read or select. Rejecting it
 * here keeps it a 422 with a field path.
 */
const WorkStatusName = z
  .string()
  .min(1)
  .max(60)
  .refine((value) => value.trim().length > 0, { message: 'Status name cannot be blank' });

/** One status in a workspace's set. */
export const WorkStatusOut = z
  .object({
    id: WorkStatusId,
    organizationId: OrganizationId,
    entityType: WorkStatusEntityType,
    teamId: TeamId.nullable().describe(
      'The team owning this status when the team keeps its own Task statuses; null for a status belonging to the workspace set.',
    ),
    key: z
      .string()
      .min(1)
      .describe(
        'Stable identifier for this status within its set, stored on the work it is applied to. Assigned by the server from the name at creation and unchanged by later renames, so saved views and automation rules keep resolving.',
      ),
    name: WorkStatusName.describe('Display name shown on rows, pickers, and group headers.'),
    description: z
      .string()
      .nullable()
      .describe('What this status means, shown when choosing between statuses.'),
    category: WorkStatusCategory,
    position: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'Sort order of this status among the statuses sharing its category, ascending. Full board order is category rank, then position.',
      ),
    isDefault: z
      .boolean()
      .describe('Whether new work of this kind starts in this status. Exactly one per set.'),
  })
  .meta({ id: 'WorkStatusOut', description: 'One status in a workspace’s set.' });
/** One status in a workspace's set. */
export type WorkStatusOut = z.infer<typeof WorkStatusOut>;

/** One kind of work's resolved status set. */
export const WorkStatusSetOut = z
  .object({
    entityType: WorkStatusEntityType,
    teamId: TeamId.nullable().describe(
      'The team this set was resolved for, or null for the workspace set.',
    ),
    forked: z
      .boolean()
      .describe(
        'Whether this team keeps its own Task statuses. False means the team follows the workspace set and changes to it apply here.',
      ),
    statuses: z.array(WorkStatusOut).describe('The set in board order.'),
  })
  .meta({ id: 'WorkStatusSetOut', description: 'A resolved status set, in board order.' });
/** One kind of work's resolved status set. */
export type WorkStatusSetOut = z.infer<typeof WorkStatusSetOut>;

/** Body for creating a status. */
export const WorkStatusCreate = z
  .object({
    entityType: WorkStatusEntityType,
    teamId: TeamId.nullable()
      .optional()
      .describe(
        'Add to this team’s own Task statuses. Omit or pass null to add to the workspace set. Accepted for Tasks only.',
      ),
    name: WorkStatusName.describe('Display name, e.g. `In Review`.'),
    description: z
      .string()
      .max(280)
      .nullable()
      .optional()
      .describe('What this status means, up to 280 characters.'),
    category: WorkStatusCategory,
    position: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Where to place this status among those sharing its category. Omit to add it after the others.',
      ),
  })
  .meta({ id: 'WorkStatusCreate', description: 'Add a status to a set.' });
/** Validated status-create body. */
export type WorkStatusCreate = z.infer<typeof WorkStatusCreate>;

/**
 * Body for updating a status.
 *
 * @remarks
 * `key` is absent by design: it is stored on every piece of work carrying this status, and in
 * saved views and automation rules, so it stays fixed while `name` moves freely.
 */
export const WorkStatusUpdate = z
  .object({
    name: WorkStatusName.optional().describe('New display name. Omit to leave unchanged.'),
    description: z
      .string()
      .max(280)
      .nullable()
      .optional()
      .describe('New meaning, up to 280 characters. Pass null to clear it.'),
    category: WorkStatusCategory.optional().describe(
      'New category. Work already in this status has its completion recorded or cleared to match.',
    ),
    isDefault: z
      .literal(true)
      .optional()
      .describe('Make this the status new work of this kind starts in.'),
  })
  .meta({ id: 'WorkStatusUpdate', description: 'Change a status.' });
/** Validated status-update body. */
export type WorkStatusUpdate = z.infer<typeof WorkStatusUpdate>;

/** Body for reordering a status set. */
export const WorkStatusReorder = z
  .object({
    entityType: WorkStatusEntityType,
    teamId: TeamId.nullable().optional().describe('The team whose own set to reorder.'),
    order: z
      .array(WorkStatusId)
      .min(1)
      .describe(
        'Every status in the set, in the desired board order. Statuses sharing a category stay together, in the fixed category order.',
      ),
  })
  .meta({ id: 'WorkStatusReorder', description: 'Reorder a status set.' });
/** Validated reorder body. */
export type WorkStatusReorder = z.infer<typeof WorkStatusReorder>;

/** The result of deleting a status. */
export const WorkStatusDeleteResult = z
  .object({
    deleted: WorkStatusOut,
    remappedCount: z
      .number()
      .int()
      .nonnegative()
      .describe('How many pieces of work moved to the replacement status.'),
  })
  .meta({ id: 'WorkStatusDeleteResult', description: 'What a status deletion moved.' });
/** The result of deleting a status. */
export type WorkStatusDeleteResult = z.infer<typeof WorkStatusDeleteResult>;

/** One entry in a seeded default status set. */
export interface WorkStatusSeed {
  /** Stable identifier within the set. */
  readonly key: string;
  /** Display name. */
  readonly name: string;
  /** What this status means. */
  readonly description: string;
  /** The category this status behaves as. */
  readonly category: WorkStatusCategory;
  /** Sort order among the statuses sharing its category. */
  readonly position: number;
  /** Whether new work starts here. Exactly one per set. */
  readonly isDefault?: true;
}

/**
 * The status sets a new workspace starts with, per kind of work.
 *
 * @remarks
 * The single seed source: workspace creation, the migration that backfills existing
 * workspaces, and the tests that assert both read this. Every workspace is free to rename,
 * reorder, add to, and delete from these afterwards.
 *
 * Program carries `Completed` alongside `Archived` because a Program can reach an end even
 * though it usually runs on. `Archived` records a Program retired and kept for history.
 */
export const DEFAULT_WORK_STATUSES: Record<WorkStatusEntityType, readonly WorkStatusSeed[]> = {
  task: [
    {
      key: 'backlog',
      name: 'Backlog',
      description: 'Captured and waiting to be picked up.',
      category: 'backlog',
      position: 0,
      isDefault: true,
    },
    {
      key: 'todo',
      name: 'Todo',
      description: 'Committed to and ready to start.',
      category: 'unstarted',
      position: 0,
    },
    {
      key: 'in_progress',
      name: 'In Progress',
      description: 'Being worked on now.',
      category: 'started',
      position: 0,
    },
    {
      key: 'done',
      name: 'Done',
      description: 'Finished.',
      category: 'completed',
      position: 0,
    },
    {
      key: 'canceled',
      name: 'Canceled',
      description: 'Dropped without being finished.',
      category: 'canceled',
      position: 0,
    },
  ],
  project: [
    {
      key: 'planned',
      name: 'Planned',
      description: 'Scoped and scheduled, waiting to begin.',
      category: 'unstarted',
      position: 0,
      isDefault: true,
    },
    {
      key: 'active',
      name: 'Active',
      description: 'Underway.',
      category: 'started',
      position: 0,
    },
    {
      key: 'completed',
      name: 'Completed',
      description: 'Delivered.',
      category: 'completed',
      position: 0,
    },
    {
      key: 'canceled',
      name: 'Canceled',
      description: 'Stopped before delivery.',
      category: 'canceled',
      position: 0,
    },
  ],
  program: [
    {
      key: 'proposed',
      name: 'Proposed',
      description: 'Suggested and awaiting a decision.',
      category: 'backlog',
      position: 0,
    },
    {
      key: 'active',
      name: 'Active',
      description: 'Running.',
      category: 'started',
      position: 0,
      isDefault: true,
    },
    {
      key: 'paused',
      name: 'Paused',
      description: 'Running, on hold for now.',
      category: 'started',
      position: 1,
    },
    {
      key: 'completed',
      name: 'Completed',
      description: 'Reached its end.',
      category: 'completed',
      position: 0,
    },
    {
      key: 'archived',
      name: 'Archived',
      description: 'Retired and kept for history.',
      category: 'canceled',
      position: 0,
    },
  ],
  initiative: [
    {
      key: 'proposed',
      name: 'Proposed',
      description: 'Suggested and awaiting a decision.',
      category: 'backlog',
      position: 0,
    },
    {
      key: 'active',
      name: 'Active',
      description: 'Being pursued.',
      category: 'started',
      position: 0,
      isDefault: true,
    },
    {
      key: 'completed',
      name: 'Completed',
      description: 'Achieved.',
      category: 'completed',
      position: 0,
    },
    {
      key: 'canceled',
      name: 'Canceled',
      description: 'No longer being pursued.',
      category: 'canceled',
      position: 0,
    },
  ],
};
