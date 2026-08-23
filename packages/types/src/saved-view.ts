/**
 * `@docket/types` — Saved View slice DTOs.
 */
import { z } from 'zod';

import { ActorId, OrganizationId, SavedViewId, TeamId } from './primitives';
import {
  FractionalRank,
  InitiativeHierarchyWorkViewContext,
  InitiativeViewDefinition,
  ProgramViewDefinition,
  ProgramWorkViewContext,
  ProjectViewDefinition,
  ProjectWorkViewContext,
  TaskViewDefinition,
  TaskWorkViewContext,
} from './work-view';

/** A saved view's sharing scope. */
export const ViewScope = z.enum(['personal', 'team', 'organization']);
/** View scope value. */
export type ViewScope = z.infer<typeof ViewScope>;

/**
 * The closed set of comparison operators a saved-view predicate may use.
 *
 * @remarks
 * Exported separately from {@link ViewFilter} so the server-side SQL translator can name the
 * legal operators when it rejects one, rather than failing with an opaque message.
 */
export const ViewFilterOp = z
  .enum(['eq', 'neq', 'in', 'nin', 'gt', 'lt', 'contains'])
  .describe(
    "Comparison operator: 'eq' (=), 'neq' (≠), 'in' (in set), 'nin' (not in set), 'gt' (>), 'lt' (<), 'contains' (substring/membership).",
  );
/** A saved-view comparison operator. */
export type ViewFilterOp = z.infer<typeof ViewFilterOp>;

/** One predicate in a saved view's filter set. */
export const ViewFilter = z
  .object({
    field: z
      .string()
      .describe(
        'Task field the predicate tests (e.g. `state`, `assigneeId`, `priority`, `labels`).',
      ),
    op: ViewFilterOp,
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
    ownerActorId: ActorId.nullable().describe('Owning actor; null when ownerless.'),
    teamId: TeamId.nullable()
      .optional()
      .describe('Team the view belongs to; null for personal/org-wide views.'),
    filters: z.array(ViewFilter).describe('Filter predicates (ANDed) the view applies.'),
    grouping: ViewGrouping.nullable().describe('Grouping config; null for a flat list.'),
    sort: z.array(ViewSort).describe('Ordered sort terms the view applies.'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'SavedViewOut', description: 'A saved view.' });
/** Saved-view representation value. */
export type SavedViewOut = z.infer<typeof SavedViewOut>;

const savedWorkViewBase = {
  name: z.string().min(1),
  scope: ViewScope.default('personal'),
  ownerActorId: ActorId.optional(),
  teamId: TeamId.optional(),
  position: FractionalRank,
  schemaVersion: z.literal(2).default(2),
};

function savedWorkViewCreateVariant<
  const TTarget extends 'task' | 'project' | 'program' | 'initiative',
  const TDefinition extends z.ZodType,
  const TContext extends z.ZodType,
>(target: TTarget, definition: TDefinition, context: TContext) {
  return z
    .object({
      ...savedWorkViewBase,
      target: z.literal(target),
      context,
      definition,
    })
    .strict();
}

/** Body for creating a v2 saved work view. */
export const SavedWorkViewCreate = z.discriminatedUnion('target', [
  savedWorkViewCreateVariant('task', TaskViewDefinition, TaskWorkViewContext),
  savedWorkViewCreateVariant('project', ProjectViewDefinition, ProjectWorkViewContext),
  savedWorkViewCreateVariant('program', ProgramViewDefinition, ProgramWorkViewContext),
  savedWorkViewCreateVariant(
    'initiative',
    InitiativeViewDefinition,
    InitiativeHierarchyWorkViewContext,
  ),
]);
/** A validated v2 saved-work-view create body. */
export type SavedWorkViewCreate = z.infer<typeof SavedWorkViewCreate>;

const savedWorkViewOutBase = {
  id: SavedViewId,
  organizationId: OrganizationId,
  name: z.string().min(1),
  scope: ViewScope,
  ownerActorId: ActorId.nullable(),
  teamId: TeamId.nullable().optional(),
  position: FractionalRank,
  schemaVersion: z.literal(2),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  filters: z.array(ViewFilter),
  grouping: ViewGrouping.nullable(),
  sort: z.array(ViewSort),
};

function savedWorkViewOutVariant<
  const TTarget extends 'task' | 'project' | 'program' | 'initiative',
  const TDefinition extends z.ZodType,
  const TContext extends z.ZodType,
>(target: TTarget, definition: TDefinition, context: TContext) {
  return z
    .object({
      ...savedWorkViewOutBase,
      target: z.literal(target),
      context,
      definition,
    })
    .strict();
}

/** Saved work view with v2 state and one-window legacy response fields. */
export const SavedWorkViewOut = z.discriminatedUnion('target', [
  savedWorkViewOutVariant('task', TaskViewDefinition, TaskWorkViewContext),
  savedWorkViewOutVariant('project', ProjectViewDefinition, ProjectWorkViewContext),
  savedWorkViewOutVariant('program', ProgramViewDefinition, ProgramWorkViewContext),
  savedWorkViewOutVariant(
    'initiative',
    InitiativeViewDefinition,
    InitiativeHierarchyWorkViewContext,
  ),
]);
/** A validated saved work view. */
export type SavedWorkViewOut = z.infer<typeof SavedWorkViewOut>;

/** Partial update for a v2 saved work view. The target remains immutable. */
export const SavedWorkViewUpdate = z
  .object({
    name: z.string().min(1).optional(),
    scope: ViewScope.optional(),
    ownerActorId: ActorId.nullable().optional(),
    teamId: TeamId.nullable().optional(),
    context: z
      .union([
        TaskWorkViewContext,
        ProjectWorkViewContext,
        ProgramWorkViewContext,
        InitiativeHierarchyWorkViewContext,
      ])
      .optional(),
    position: FractionalRank.optional(),
    definition: z
      .union([
        TaskViewDefinition,
        ProjectViewDefinition,
        ProgramViewDefinition,
        InitiativeViewDefinition,
      ])
      .optional(),
  })
  .strict();
/** A validated saved-work-view update. */
export type SavedWorkViewUpdate = z.infer<typeof SavedWorkViewUpdate>;

const savedWorkViewUpdateBase = {
  name: z.string().min(1).optional(),
  scope: ViewScope.optional(),
  ownerActorId: ActorId.nullable().optional(),
  teamId: TeamId.nullable().optional(),
  position: FractionalRank.optional(),
};

function savedWorkViewUpdateFor(
  definition: z.ZodType,
  context: z.ZodType,
): z.ZodObject<z.ZodRawShape> {
  return z
    .object({
      ...savedWorkViewUpdateBase,
      definition: definition.optional(),
      context: context.optional(),
    })
    .strict();
}

const savedWorkViewUpdates = {
  task: savedWorkViewUpdateFor(TaskViewDefinition, TaskWorkViewContext),
  project: savedWorkViewUpdateFor(ProjectViewDefinition, ProjectWorkViewContext),
  program: savedWorkViewUpdateFor(ProgramViewDefinition, ProgramWorkViewContext),
  initiative: savedWorkViewUpdateFor(InitiativeViewDefinition, InitiativeHierarchyWorkViewContext),
} as const;

/**
 * Parse a typed saved-view update against the immutable target stored on its row.
 *
 * @param target - The saved view's stored target.
 * @param value - The untrusted partial update body.
 * @returns A target-compatible update.
 * @throws A Zod error when the definition or context belongs to another target.
 */
export function parseSavedWorkViewUpdate(
  target: keyof typeof savedWorkViewUpdates,
  value: unknown,
): SavedWorkViewUpdate {
  return savedWorkViewUpdates[target].parse(value);
}

function organizationDefaultVariant<
  const TTarget extends 'task' | 'project' | 'program' | 'initiative',
  const TDefinition extends z.ZodType,
>(target: TTarget, definition: TDefinition) {
  return z
    .object({
      target: z.literal(target),
      definition,
      updatedBy: ActorId,
      updatedAt: z.iso.datetime(),
    })
    .strict();
}

/** Organization-owned built-in page default. Updating it requires `manage`. */
export const OrganizationWorkViewDefault = z.discriminatedUnion('target', [
  organizationDefaultVariant('task', TaskViewDefinition),
  organizationDefaultVariant('project', ProjectViewDefinition),
  organizationDefaultVariant('program', ProgramViewDefinition),
  organizationDefaultVariant('initiative', InitiativeViewDefinition),
]);
/** A validated organization work-view default. */
export type OrganizationWorkViewDefault = z.infer<typeof OrganizationWorkViewDefault>;

function organizationDefaultWriteVariant<
  const TTarget extends 'task' | 'project' | 'program' | 'initiative',
  const TDefinition extends z.ZodType,
>(target: TTarget, definition: TDefinition) {
  return z.object({ target: z.literal(target), definition }).strict();
}

/** Target-discriminated body assembled by the organization-default write route. */
export const OrganizationWorkViewDefaultWrite = z.discriminatedUnion('target', [
  organizationDefaultWriteVariant('task', TaskViewDefinition),
  organizationDefaultWriteVariant('project', ProjectViewDefinition),
  organizationDefaultWriteVariant('program', ProgramViewDefinition),
  organizationDefaultWriteVariant('initiative', InitiativeViewDefinition),
]);
/** A validated organization-default write. */
export type OrganizationWorkViewDefaultWrite = z.infer<typeof OrganizationWorkViewDefaultWrite>;

/** Body accepted by the target-keyed organization-default route. */
export const OrganizationWorkViewDefaultBody = z
  .object({
    definition: z.union([
      TaskViewDefinition,
      ProjectViewDefinition,
      ProgramViewDefinition,
      InitiativeViewDefinition,
    ]),
  })
  .strict();

const LEGACY_TASK_FIELD = {
  state: 'status',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee',
  delegateId: 'delegate',
  teamId: 'team',
  projectId: 'project',
  programId: 'program',
  cycleId: 'cycle',
  milestoneId: 'milestone',
  parentTaskId: 'parent',
  labels: 'labels',
  title: 'title',
  createdBy: 'creator',
  startDate: 'startDate',
  dueDate: 'dueDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  estimate: 'estimate',
  estimateMinutes: 'estimateMinutes',
  blocked: 'blocked',
  blocking: 'blocking',
  archived: 'archived',
} as const;

const V2_TASK_FIELD = Object.fromEntries(
  Object.entries(LEGACY_TASK_FIELD).map(([legacy, current]) => [current, legacy]),
) as Record<string, string>;
V2_TASK_FIELD['status'] = 'state';

type LegacyTaskField = keyof typeof LEGACY_TASK_FIELD;

function legacyTaskField(field: string): (typeof LEGACY_TASK_FIELD)[LegacyTaskField] {
  if (field in LEGACY_TASK_FIELD) return LEGACY_TASK_FIELD[field as LegacyTaskField];
  throw new TypeError(`Legacy Task view field "${field}" is not supported.`);
}

function legacyTaskOperand(field: string, value: unknown): unknown {
  if (field === 'assignee' || field === 'delegate' || field === 'creator') {
    const actor = (actorId: unknown) => ({ kind: 'actor', actorId });
    return Array.isArray(value) ? value.map(actor) : actor(value);
  }
  if (
    field === 'startDate' ||
    field === 'dueDate' ||
    field === 'createdAt' ||
    field === 'updatedAt'
  ) {
    const absolute = (date: unknown) => ({ kind: 'absolute', value: date });
    /* v8 ignore next -- @preserve Current date filters accept one operand, not an array. */
    return Array.isArray(value) ? value.map(absolute) : absolute(value);
  }
  return value;
}

function legacyTaskPredicate(filter: ViewFilter): unknown {
  const field = legacyTaskField(filter.field);
  const relationMany = field === 'labels';
  const temporal =
    field === 'startDate' || field === 'dueDate' || field === 'createdAt' || field === 'updatedAt';
  const operator = (() => {
    switch (filter.op) {
      case 'eq':
        return relationMany ? 'includesAny' : 'is';
      case 'neq':
        return relationMany ? 'includesNone' : 'isNot';
      case 'in':
        return relationMany ? 'includesAny' : 'isAnyOf';
      case 'nin':
        return relationMany ? 'includesNone' : 'isNoneOf';
      case 'gt':
        return temporal ? 'after' : 'greaterThan';
      case 'lt':
        return temporal ? 'before' : 'lessThan';
      case 'contains':
        return 'contains';
    }
  })();
  const rawOperand = relationMany && !Array.isArray(filter.value) ? [filter.value] : filter.value;
  return {
    kind: 'predicate',
    field,
    operator,
    operand: legacyTaskOperand(field, rawOperand),
  };
}

function projectedLegacyOperand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectedLegacyOperand);
  if (value !== null && typeof value === 'object' && 'kind' in value) {
    const operand = value as {
      readonly kind: string;
      readonly actorId?: unknown;
      readonly value?: unknown;
    };
    if (operand.kind === 'actor') return operand.actorId;
    if (operand.kind === 'absolute') return operand.value;
    throw new TypeError(`The ${operand.kind} operand has no equivalent legacy value.`);
  }
  return value;
}

function projectedLegacyPredicate(predicate: {
  readonly field: string;
  readonly operator: string;
  readonly operand?: unknown;
}): ViewFilter {
  const field = V2_TASK_FIELD[predicate.field];
  /* v8 ignore next -- @preserve TaskViewDefinition rejects unknown fields before projection. */
  if (!field) throw new TypeError(`Task field "${predicate.field}" has no legacy projection.`);
  const op = (() => {
    switch (predicate.operator) {
      case 'is':
      case 'on':
        return 'eq' as const;
      case 'isNot':
        return 'neq' as const;
      case 'isAnyOf':
      case 'includesAny':
        return 'in' as const;
      case 'isNoneOf':
      case 'includesNone':
        return 'nin' as const;
      case 'greaterThan':
      case 'after':
        return 'gt' as const;
      case 'lessThan':
      case 'before':
        return 'lt' as const;
      case 'contains':
        return 'contains' as const;
      /* v8 ignore next -- @preserve TaskViewDefinition rejects unsupported operators first. */
      default:
        throw new TypeError(`Filter operator "${predicate.operator}" has no legacy projection.`);
    }
  })();
  return ViewFilter.parse({ field, op, value: projectedLegacyOperand(predicate.operand) });
}

/**
 * Project a compatible v2 Task definition into the one-window legacy response fields.
 *
 * @param input - The validated Task definition to expose to legacy clients.
 * @returns Equivalent flat filters, grouping, and sorting when the legacy algebra can express it.
 * @throws {TypeError} When the definition uses a v2 expression with no legacy equivalent.
 */
export function projectTaskViewDefinitionToLegacy(
  input: TaskViewDefinition,
): Pick<SavedViewOut, 'filters' | 'grouping' | 'sort'> {
  const definition = TaskViewDefinition.parse(input);
  const filter = definition.filter;
  const predicates =
    filter === null
      ? []
      : filter.kind === 'predicate'
        ? [filter]
        : filter.kind === 'all' && filter.children.every((child) => child.kind === 'predicate')
          ? filter.children
          : (() => {
              throw new TypeError(
                'Nested, negated, or disjunctive filters have no legacy projection.',
              );
            })();
  return {
    filters: predicates.map(projectedLegacyPredicate),
    grouping: definition.arrangement.groupBy
      ? ViewGrouping.parse({
          by: V2_TASK_FIELD[definition.arrangement.groupBy],
          ...(definition.arrangement.subGroupBy
            ? { subBy: V2_TASK_FIELD[definition.arrangement.subGroupBy] }
            : {}),
        })
      : null,
    sort: definition.arrangement.orderBy.map((term) =>
      ViewSort.parse({
        field: V2_TASK_FIELD[term.field],
        order: term.direction,
      }),
    ),
  };
}

/**
 * Project a validated v2 Task definition into legacy fields without rejecting v2-only algebra.
 *
 * @param input - The authoritative v2 Task definition.
 * @returns An equivalent legacy projection when possible, or a deterministic no-match filter when
 *   legacy clients cannot express the definition.
 */
export function projectTaskViewDefinitionToLegacyFallback(
  input: TaskViewDefinition,
): Pick<SavedViewOut, 'filters' | 'grouping' | 'sort'> {
  const definition = TaskViewDefinition.parse(input);
  try {
    return projectTaskViewDefinitionToLegacy(definition);
  } catch {
    return legacyTaskNoMatchProjection();
  }
}

/** Return the deterministic fail-closed Task projection used for non-projectable saved views. */
export function legacyTaskNoMatchProjection(): Pick<SavedViewOut, 'filters' | 'grouping' | 'sort'> {
  return {
    filters: [{ field: 'estimateMinutes', op: 'lt', value: 0 }],
    grouping: null,
    sort: [],
  };
}

/** Convert the legacy flat Task view state into one validated v2 definition. */
export function migrateLegacyTaskViewDefinition(
  legacy: Pick<SavedViewOut, 'filters' | 'grouping' | 'sort'>,
): TaskViewDefinition {
  const definition = {
    version: 2,
    target: 'task',
    filter:
      legacy.filters.length === 0
        ? null
        : { kind: 'all', children: legacy.filters.map(legacyTaskPredicate) },
    arrangement: {
      groupBy: legacy.grouping ? legacyTaskField(legacy.grouping.by) : null,
      subGroupBy: legacy.grouping?.subBy ? legacyTaskField(legacy.grouping.subBy) : null,
      orderBy: legacy.sort.map((term) => ({
        field: legacyTaskField(term.field),
        direction: term.order,
      })),
    },
    presentation: {
      layout: 'list',
      properties: ['status', 'priority', 'assignee', 'dueDate'],
      density: 'comfortable',
      showEmptyGroups: false,
    },
  };
  return TaskViewDefinition.parse(definition);
}
