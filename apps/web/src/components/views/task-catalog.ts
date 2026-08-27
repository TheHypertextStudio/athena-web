'use client';

/**
 * `views` — the {@link FieldCatalog} for the org's tasks, plus the codec between the unified
 * {@link ViewState} and the saved-view's *stored* config shape.
 *
 * @remarks
 * The Saved Views screen is the existing consumer of the filter engine and the home of the
 * Save-view affordance. Migrating it onto the unified {@link FilterToolbar} would otherwise mean
 * two filter UIs in the app; instead this module bridges the gap so the screen uses the *same*
 * toolbar as every entity list while still reading/writing the API's stored
 * {@link import('@docket/types').ViewFilter}/{@link ViewGrouping}/{@link ViewSort} shapes:
 *
 * - {@link buildTaskCatalog} declares the task fields (status, priority, assignee, project,
 *   program, due date, title) as a {@link FieldCatalog} over {@link TaskOut}, so status sorts by
 *   the workspace's own board order and priority by urgency. The status set, entity-noun labels,
 *   and option/label resolution are injected by the page (so the workspace's statuses, its
 *   vocabulary, and its members/projects/programs all flow through).
 * - {@link toViewState} / {@link toStoredView} convert between the generic toolbar state (which
 *   uses `groupBy.field` and `sort[].dir`) and the stored shape (`grouping.by`, `sort[].order`),
 *   so opening a saved view, tweaking it in the toolbar, and saving it round-trips losslessly.
 *
 * Keeping this adapter local to `views` means the generic engine stays free of any saved-view
 * coupling, and the entity-list pages (Projects, …) use the catalog model directly without it.
 */
import type { TaskOut, ViewFilter, ViewGrouping, ViewSort } from '@docket/types';

import {
  type WorkStatusDisplay,
  statusFieldOptions,
  statusRankOf,
} from '@/components/entity-display/work-status';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/components/task-detail/priority';

import {
  type FieldCatalog,
  type FieldOption,
  type ViewFilterTerm,
  type ViewSortTerm,
  type ViewState,
} from './field-catalog';

/** The priority field options (value + label), most-pressing first. */
const PRIORITY_OPTIONS: readonly FieldOption[] = PRIORITY_ORDER.map((priority) => ({
  value: priority,
  label: PRIORITY_LABEL[priority],
}));

/** Sort/group rank for a priority value (urgent first), by {@link PRIORITY_ORDER}. */
function priorityRank(value: string | number | null): number {
  if (value === null) return PRIORITY_ORDER.length;
  const index = PRIORITY_ORDER.indexOf(value as (typeof PRIORITY_ORDER)[number]);
  return index === -1 ? PRIORITY_ORDER.length : index;
}

/** Injected resolvers a page supplies so the task catalog can skin labels + relation options. */
export interface TaskCatalogDeps {
  /**
   * The workspace's Task statuses, in board order, from the status registry.
   *
   * @remarks
   * The Status field used to offer five fixed keys under five category labels, which meant a
   * workspace that renamed `in_progress` to `building` got a filter menu offering a value none of
   * its tasks held. The set decides both the choices and their ordering now, so filtering by
   * "Building" finds the tasks that are building.
   */
  statuses: readonly WorkStatusDisplay[];
  /** Vocabulary label for the "Project" field. */
  projectLabel: string;
  /** Vocabulary label for the "Program" field. */
  programLabel: string;
  /** Resolve a project id to its name (for chips + group headers). */
  resolveProject: (id: string) => string;
  /** Resolve a program id to its name. */
  resolveProgram: (id: string) => string;
  /** Resolve an assignee actor id to its display name. */
  resolveAssignee: (id: string) => string;
  /** The assignee relation options (the org's members/agents as choosable values). */
  assigneeOptions: () => readonly FieldOption[];
  /** The project relation options. */
  projectOptions: () => readonly FieldOption[];
  /** The program relation options. */
  programOptions: () => readonly FieldOption[];
  /**
   * The tasks this list will show, which is where the Label field gets its options.
   *
   * @remarks
   * Unlike every other relation here, labels need no injected resolver: `TaskOut.labels` embeds
   * each label's name, so the rows already carry everything the filter chips and group headers
   * need. Deriving the options from the rows also means the menu only ever offers labels that
   * appear in *this* list — filtering by a label nothing here carries would just empty the view.
   *
   * Omit it and the catalog simply has no Label field, which is the right answer for a list where
   * filtering by label would not earn its place.
   */
  tasks?: readonly TaskOut[];
}

/** The distinct labels across a set of tasks, name-sorted, as filter options. */
function labelOptionsOf(tasks: readonly TaskOut[]): readonly FieldOption[] {
  const byId = new Map<string, string>();
  for (const task of tasks) {
    for (const label of task.labels) byId.set(label.id, label.name);
  }
  return [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Build the task {@link FieldCatalog} the Saved Views toolbar drives.
 *
 * @param deps - The page-supplied vocabulary labels + relation resolvers/options.
 * @returns the catalog over {@link TaskOut}.
 */
export function buildTaskCatalog(deps: TaskCatalogDeps): FieldCatalog<TaskOut> {
  const rows = deps.tasks;
  const labelNames = rows ? new Map(labelOptionsOf(rows).map((o) => [o.value, o.label])) : null;
  return [
    {
      key: 'state',
      label: 'Status',
      type: 'enum',
      accessor: (task) => task.state,
      options: statusFieldOptions(deps.statuses),
      groupable: true,
      sortable: true,
      rank: statusRankOf(deps.statuses),
    },
    {
      key: 'priority',
      label: 'Priority',
      type: 'enum',
      accessor: (task) => task.priority,
      options: PRIORITY_OPTIONS,
      groupable: true,
      sortable: true,
      rank: priorityRank,
    },
    {
      key: 'assigneeId',
      label: 'Assignee',
      type: 'relation',
      accessor: (task) => task.assigneeId ?? null,
      resolveOptions: deps.assigneeOptions,
      resolveLabel: deps.resolveAssignee,
      groupable: true,
    },
    {
      key: 'projectId',
      label: deps.projectLabel,
      type: 'relation',
      accessor: (task) => task.projectId ?? null,
      resolveOptions: deps.projectOptions,
      resolveLabel: deps.resolveProject,
      groupable: true,
    },
    {
      key: 'programId',
      label: deps.programLabel,
      type: 'relation',
      accessor: (task) => task.programId ?? null,
      resolveOptions: deps.programOptions,
      resolveLabel: deps.resolveProgram,
      groupable: true,
    },
    ...(rows
      ? ([
          {
            key: 'labels',
            label: 'Label',
            type: 'relation',
            // Sorting reads `accessor`, and ordering a row by a *set* has no single honest
            // answer, so this reports the first label and the field is not sortable.
            accessor: (task) => task.labels[0]?.id ?? null,
            // The multi-value slot the engine already had: filtering matches if *any* label
            // matches, and grouping fans a task into one bucket per label — so a task with two
            // labels appears under both, and group counts can exceed the row count.
            values: (task) => task.labels.map((l) => l.id),
            resolveOptions: () => labelOptionsOf(rows),
            resolveLabel: (id) => labelNames?.get(id) ?? id,
            groupable: true,
          },
        ] satisfies FieldCatalog<TaskOut>)
      : []),
    {
      key: 'dueDate',
      label: 'Due date',
      type: 'date',
      accessor: (task) => task.dueDate ?? null,
      sortable: true,
    },
    {
      key: 'title',
      label: 'Title',
      type: 'text',
      accessor: (task) => task.title,
      sortable: true,
    },
  ];
}

/**
 * Convert a saved view's stored config into the unified toolbar {@link ViewState}.
 *
 * @remarks
 * `grouping.by` → `groupBy.field`; `sort[].order` → `sort[].dir`. Filters share the same
 * `{ field, op, value }` shape, so they pass through. An absent grouping/sort yields the empty
 * state for that slot.
 *
 * @param stored - The stored filters / grouping / sort from a saved view.
 * @returns the equivalent {@link ViewState}.
 */
export function toViewState(stored: {
  filters: readonly ViewFilter[];
  grouping: ViewGrouping | null;
  sort: readonly ViewSort[];
}): ViewState {
  return {
    filters: stored.filters.map((f) => ({ field: f.field, op: f.op, value: f.value })),
    groupBy: stored.grouping ? { field: stored.grouping.by } : null,
    sort: stored.sort.map((s) => ({ field: s.field, dir: s.order })),
  };
}

/**
 * Convert a unified toolbar {@link ViewState} back into the stored saved-view config shape.
 *
 * @param state - The toolbar state.
 * @returns the stored filters / grouping / sort, ready for the create payload.
 */
export function toStoredView(state: ViewState): {
  filters: readonly ViewFilter[];
  grouping: ViewGrouping | null;
  sort: readonly ViewSort[];
} {
  return {
    filters: state.filters.map((f: ViewFilterTerm): ViewFilter => ({
      field: f.field,
      op: f.op,
      value: f.value,
    })),
    grouping: state.groupBy ? { by: state.groupBy.field } : null,
    sort: state.sort.map((s: ViewSortTerm): ViewSort => ({ field: s.field, order: s.dir })),
  };
}
