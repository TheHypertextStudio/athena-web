/**
 * `views` — the pure client-side engine that turns a saved view's stored
 * {@link ViewFilter}/{@link ViewGrouping}/{@link ViewSort} config into a filtered, grouped,
 * sorted task list.
 *
 * @remarks
 * A saved view is a stored filter/grouping/sort over the org's tasks (mvp-plan §8.3d). The
 * API returns the full, *permission-scoped* task set (`GET …/tasks` — a viewer only ever
 * receives work they may access), so the screen never re-implements access control: it simply
 * applies the view's config to whatever rows come back. This module is the shared,
 * UI-free heart of that — it is exercised by the view runner and the live filter builder alike,
 * and is deliberately framework-agnostic so the logic stays unit-reviewable.
 *
 * The filterable task fields are a curated subset of {@link TaskOut} that read well as a
 * human filter ("Status is In Progress", "Priority is Urgent", "Title contains 'launch'").
 * Each field declares the operators that make sense for it; unknown fields/operators degrade
 * gracefully (an unrecognized predicate simply does not exclude any task) so a view authored
 * elsewhere never blanks the list.
 */
import type { Priority, TaskOut, ViewFilter, ViewGrouping, ViewSort } from '@docket/types';
import type { WorkflowStateType } from '@docket/ui/components';

import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/components/task-detail/priority';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

/** A task field that can be filtered, grouped, or sorted on in a saved view. */
export type ViewField =
  | 'state'
  | 'priority'
  | 'assigneeId'
  | 'projectId'
  | 'programId'
  | 'dueDate'
  | 'title';

/** A filter operator. Mirrors the `op` union on {@link ViewFilter}. */
export type ViewOp = ViewFilter['op'];

/** Descriptor for one filterable/groupable/sortable field. */
export interface FieldSpec {
  /** The {@link ViewField} key (matches the stored `field` string). */
  field: ViewField;
  /** Human-readable field label (vocabulary-resolved at the call site where needed). */
  label: string;
  /** The operators offered for this field, in menu order. */
  ops: readonly ViewOp[];
  /** Whether the field can be used to group a view. */
  groupable: boolean;
  /** Whether the field can be used to sort a view. */
  sortable: boolean;
  /**
   * For enumerable fields (state, priority), the fixed set of choosable values with labels;
   * `undefined` for free-text / id fields whose values are entered or resolved elsewhere.
   */
  options?: readonly { value: string; label: string }[];
}

/** Human label for each filter operator. */
export const OP_LABEL: Record<ViewOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  nin: 'is none of',
  gt: 'is after',
  lt: 'is before',
  contains: 'contains',
};

/** The canonical workflow-state keys a default org seeds, in workflow order. */
const STATE_KEY_ORDER: readonly string[] = ['backlog', 'todo', 'in_progress', 'done', 'canceled'];

/** Human label for a workflow-state key (via its canonical {@link WorkflowStateType}). */
function stateKeyLabel(key: string): string {
  return STATE_GROUP_LABEL[stateTypeOf(key)];
}

/** The state field options (key + label), in workflow order. */
const STATE_OPTIONS: readonly { value: string; label: string }[] = STATE_KEY_ORDER.map((key) => ({
  value: key,
  label: stateKeyLabel(key),
}));

/** The priority field options (value + label), most-pressing first. */
const PRIORITY_OPTIONS: readonly { value: string; label: string }[] = PRIORITY_ORDER.map(
  (priority) => ({ value: priority, label: PRIORITY_LABEL[priority] }),
);

/**
 * The catalog of fields a saved view may filter / group / sort on.
 *
 * @remarks
 * `label` carries the *neutral* noun; the UI re-skins the entity-noun fields (status excepted)
 * through `useVocabulary` at render time. Comparison operators (`gt`/`lt`) are offered only for
 * the date field, where "after"/"before" read naturally; `contains` only for free text.
 */
export const FIELD_SPECS: readonly FieldSpec[] = [
  {
    field: 'state',
    label: 'Status',
    ops: ['eq', 'neq', 'in', 'nin'],
    groupable: true,
    sortable: true,
    options: STATE_OPTIONS,
  },
  {
    field: 'priority',
    label: 'Priority',
    ops: ['eq', 'neq', 'in', 'nin'],
    groupable: true,
    sortable: true,
    options: PRIORITY_OPTIONS,
  },
  {
    field: 'assigneeId',
    label: 'Assignee',
    ops: ['eq', 'neq'],
    groupable: true,
    sortable: false,
  },
  {
    field: 'projectId',
    label: 'Project',
    ops: ['eq', 'neq'],
    groupable: true,
    sortable: false,
  },
  {
    field: 'programId',
    label: 'Program',
    ops: ['eq', 'neq'],
    groupable: true,
    sortable: false,
  },
  {
    field: 'dueDate',
    label: 'Due date',
    ops: ['gt', 'lt'],
    groupable: false,
    sortable: true,
  },
  {
    field: 'title',
    label: 'Title',
    ops: ['contains'],
    groupable: false,
    sortable: true,
  },
];

/** Look up a {@link FieldSpec} by its field key. */
export function fieldSpec(field: string): FieldSpec | undefined {
  return FIELD_SPECS.find((spec) => spec.field === field);
}

/** Read a task's value for a {@link ViewField}, normalized to a comparable scalar. */
function taskValue(task: TaskOut, field: string): string | null {
  switch (field) {
    case 'state':
      return task.state;
    case 'priority':
      return task.priority;
    case 'assigneeId':
      return task.assigneeId ?? null;
    case 'projectId':
      return task.projectId ?? null;
    case 'programId':
      return task.programId ?? null;
    case 'dueDate':
      return task.dueDate ?? null;
    case 'title':
      return task.title;
    /* v8 ignore next 2 -- defensive: a view authored elsewhere may reference an unknown field. */
    default:
      return null;
  }
}

/** Coerce a stored filter `value` (typed `unknown`) to a string for scalar comparison. */
function asScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Coerce a stored filter `value` to a set of strings for `in`/`nin`. */
function asScalarSet(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    const out = new Set<string>();
    for (const entry of value) {
      const scalar = asScalar(entry);
      if (scalar !== null) out.add(scalar);
    }
    return out;
  }
  const single = asScalar(value);
  return single === null ? new Set() : new Set([single]);
}

/**
 * Evaluate a single {@link ViewFilter} predicate against a task.
 *
 * @remarks
 * An unrecognized field or a predicate whose value cannot be coerced is treated as "no
 * opinion" (returns `true`) rather than excluding the task — a malformed predicate must never
 * silently blank a shared view.
 */
function matchesFilter(task: TaskOut, filter: ViewFilter): boolean {
  const actual = taskValue(task, filter.field);
  switch (filter.op) {
    case 'eq':
      return actual === asScalar(filter.value);
    case 'neq':
      return actual !== asScalar(filter.value);
    case 'in':
      return actual !== null && asScalarSet(filter.value).has(actual);
    case 'nin':
      return actual === null || !asScalarSet(filter.value).has(actual);
    case 'contains': {
      const needle = asScalar(filter.value);
      if (needle === null) return true;
      return (actual ?? '').toLowerCase().includes(needle.toLowerCase());
    }
    case 'gt': {
      const bound = asScalar(filter.value);
      if (bound === null || actual === null) return false;
      return actual > bound;
    }
    case 'lt': {
      const bound = asScalar(filter.value);
      if (bound === null || actual === null) return false;
      return actual < bound;
    }
    /* v8 ignore next 2 -- defensive: `op` is a closed union; guards a future operator. */
    default:
      return true;
  }
}

/**
 * Apply a view's full filter set to the task list (AND across predicates).
 *
 * @param tasks - The permission-scoped tasks returned by the API.
 * @param filters - The view's filter predicates; an empty set passes every task through.
 * @returns the tasks that satisfy every predicate.
 */
export function applyFilters(
  tasks: readonly TaskOut[],
  filters: readonly ViewFilter[],
): readonly TaskOut[] {
  if (filters.length === 0) return tasks;
  return tasks.filter((task) => filters.every((filter) => matchesFilter(task, filter)));
}

/** Sort rank for a workflow-state key, by its canonical type's workflow order. */
function stateRank(stateKey: string): number {
  return STATE_GROUP_ORDER.indexOf(stateTypeOf(stateKey));
}

/** Sort rank for a priority value (urgent first), by {@link PRIORITY_ORDER}. */
function priorityRank(priority: string): number {
  const index = PRIORITY_ORDER.indexOf(priority as Priority);
  return index === -1 ? PRIORITY_ORDER.length : index;
}

/**
 * Compare two tasks on a single {@link ViewField} for sorting.
 *
 * @remarks
 * Status and priority sort by their canonical *workflow* / *pressing* order rather than
 * alphabetically (so "In Progress" precedes "Done", "Urgent" precedes "Low"). All other fields
 * sort lexically, with absent values (`null`) sorted last regardless of direction so blanks
 * never lead.
 */
function compareField(a: TaskOut, b: TaskOut, field: string): number {
  if (field === 'state') return stateRank(a.state) - stateRank(b.state);
  if (field === 'priority') return priorityRank(a.priority) - priorityRank(b.priority);
  const av = taskValue(a, field);
  const bv = taskValue(b, field);
  if (av === bv) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av < bv ? -1 : 1;
}

/**
 * Sort tasks by a view's ordered {@link ViewSort} terms (stable, multi-key).
 *
 * @param tasks - The (already filtered) tasks to order.
 * @param sort - The ordered sort terms; an empty set leaves the input order untouched.
 * @returns a new, ordered array (the input is never mutated).
 */
export function sortTasks(
  tasks: readonly TaskOut[],
  sort: readonly ViewSort[],
): readonly TaskOut[] {
  if (sort.length === 0) return tasks;
  return [...tasks].sort((a, b) => {
    for (const term of sort) {
      const cmp = compareField(a, b, term.field);
      if (cmp !== 0) return term.order === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

/** A resolver that turns an entity id into its display label (project/program/assignee names). */
export type LabelResolver = (field: string, value: string | null) => string;

/**
 * Compute the group bucket id + label for a task under a view's {@link ViewGrouping}.
 *
 * @remarks
 * Returns `null` when the view has no grouping (the {@link ListView} then renders a single,
 * ungrouped list). For status grouping the bucket also carries the canonical
 * {@link WorkflowStateType} so the group header can show the matching status glyph. Entity-id
 * groupings resolve their human label through the supplied {@link LabelResolver}; a task with
 * no value for the grouping field lands in the list view's synthesized "no group" bucket
 * (signalled by returning `null` for that task).
 */
export function groupFor(
  task: TaskOut,
  grouping: ViewGrouping | null | undefined,
  resolve: LabelResolver,
): { id: string; label: string; stateType?: WorkflowStateType } | null {
  if (!grouping) return null;
  const field = grouping.by;
  const value = taskValue(task, field);
  if (field === 'state') {
    const type = stateTypeOf(task.state);
    return { id: type, label: STATE_GROUP_LABEL[type], stateType: type };
  }
  if (field === 'priority') {
    return { id: task.priority, label: PRIORITY_LABEL[task.priority] };
  }
  if (value === null) return null;
  return { id: value, label: resolve(field, value) };
}

/**
 * Render a stored filter predicate as a short, human-readable summary chip.
 *
 * @example
 * ```ts
 * describeFilter({ field: 'state', op: 'eq', value: 'in_progress' }, resolve);
 * // "Status is In Progress"
 * ```
 */
export function describeFilter(filter: ViewFilter, resolve: LabelResolver): string {
  const spec = fieldSpec(filter.field);
  const fieldLabel = spec?.label ?? filter.field;
  const op = OP_LABEL[filter.op];
  if (filter.op === 'in' || filter.op === 'nin') {
    const values = [...asScalarSet(filter.value)].map((v) => valueLabel(filter.field, v, resolve));
    return `${fieldLabel} ${op} ${values.join(', ') || '—'}`;
  }
  const scalar = asScalar(filter.value);
  return `${fieldLabel} ${op} ${scalar === null ? '—' : valueLabel(filter.field, scalar, resolve)}`;
}

/** Resolve one filter value to its display label (enum label, or resolver for ids). */
export function valueLabel(field: string, value: string, resolve: LabelResolver): string {
  const spec = fieldSpec(field);
  const option = spec?.options?.find((o) => o.value === value);
  if (option) return option.label;
  return resolve(field, value);
}
