/**
 * Legacy Task view projection and migration utilities.
 *
 * @remarks
 * Handles conversion between v1 flat view filters/grouping/sorting and v2 hierarchical
 * Task definitions for backwards compatibility with legacy clients.
 */
import type { TaskViewDefinition } from './work-view';
import type { SavedViewOut } from './saved-view';
import { ViewFilter, ViewGrouping, ViewSort } from './saved-view';

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

const LEGACY_TASK_OPERATOR = {
  eq: 'is',
  neq: 'isNot',
  in: 'isAnyOf',
  nin: 'isNoneOf',
  gt: 'greaterThan',
  lt: 'lessThan',
  contains: 'contains',
} as const;

function legacyTaskOperator(
  operation: ViewFilter['op'],
  relationMany: boolean,
  temporal: boolean,
): string {
  if (relationMany && (operation === 'eq' || operation === 'in')) return 'includesAny';
  if (relationMany && (operation === 'neq' || operation === 'nin')) return 'includesNone';
  if (temporal && operation === 'gt') return 'after';
  if (temporal && operation === 'lt') return 'before';
  return LEGACY_TASK_OPERATOR[operation];
}

function legacyTaskPredicate(filter: ViewFilter): unknown {
  const field = legacyTaskField(filter.field);
  const relationMany = field === 'labels';
  const temporal =
    field === 'startDate' || field === 'dueDate' || field === 'createdAt' || field === 'updatedAt';
  const operator = legacyTaskOperator(filter.op, relationMany, temporal);
  const rawOperand = relationMany && !Array.isArray(filter.value) ? [filter.value] : filter.value;
  return {
    kind: 'predicate',
    field,
    operator,
    operand: legacyTaskOperand(field, rawOperand),
  };
}

function extractOperandValue(operand: {
  readonly kind: string;
  readonly actorId?: unknown;
  readonly value?: unknown;
}): unknown {
  if (operand.kind === 'actor') return operand.actorId;
  if (operand.kind === 'absolute') return operand.value;
  throw new TypeError(`The ${operand.kind} operand has no equivalent legacy value.`);
}

function projectedLegacyOperand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectedLegacyOperand);
  if (value !== null && typeof value === 'object' && 'kind' in value) {
    return extractOperandValue(
      value as {
        readonly kind: string;
        readonly actorId?: unknown;
        readonly value?: unknown;
      },
    );
  }
  return value;
}

const PROJECTED_LEGACY_OPERATOR = {
  is: 'eq',
  on: 'eq',
  isNot: 'neq',
  isAnyOf: 'in',
  includesAny: 'in',
  isNoneOf: 'nin',
  includesNone: 'nin',
  greaterThan: 'gt',
  after: 'gt',
  lessThan: 'lt',
  before: 'lt',
  contains: 'contains',
} as const;

function projectedLegacyOperator(operator: string): ViewFilter['op'] {
  if (operator in PROJECTED_LEGACY_OPERATOR) {
    return PROJECTED_LEGACY_OPERATOR[operator as keyof typeof PROJECTED_LEGACY_OPERATOR];
  }
  /* v8 ignore next -- @preserve TaskViewDefinition rejects unsupported operators first. */
  throw new TypeError(`Filter operator "${operator}" has no legacy projection.`);
}

/** One v2 predicate node, reduced to the fields the legacy projection reads. */
interface V2Predicate {
  readonly field: string;
  readonly operator: string;
  readonly operand?: unknown;
}

function projectedLegacyPredicate(predicate: V2Predicate): ViewFilter {
  const field = V2_TASK_FIELD[predicate.field];
  /* v8 ignore next -- @preserve TaskViewDefinition rejects unknown fields before projection. */
  if (!field) throw new TypeError(`Task field "${predicate.field}" has no legacy projection.`);
  const op = projectedLegacyOperator(predicate.operator);
  return ViewFilter.parse({ field, op, value: projectedLegacyOperand(predicate.operand) });
}

function extractFilterPredicates(filter: unknown): V2Predicate[] {
  if (filter === null) return [];
  const f = filter as { kind: string; children?: unknown[] };
  if (f.kind === 'predicate') return [f as unknown as V2Predicate];
  if (
    f.kind === 'all' &&
    Array.isArray(f.children) &&
    f.children.every((c: unknown) => (c as { kind: string }).kind === 'predicate')
  ) {
    return f.children as V2Predicate[];
  }
  throw new TypeError('Nested, negated, or disjunctive filters have no legacy projection.');
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
  const definition = input as unknown as {
    filter: unknown;
    arrangement: {
      groupBy?: string;
      subGroupBy?: string;
      orderBy: { field: string; direction: 'asc' | 'desc' }[];
    };
  };
  const predicates = extractFilterPredicates(definition.filter);
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
  try {
    return projectTaskViewDefinitionToLegacy(input);
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
  return definition as unknown as TaskViewDefinition;
}
