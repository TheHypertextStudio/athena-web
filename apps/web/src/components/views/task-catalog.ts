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
 *   program, due date, title) as a {@link FieldCatalog} over {@link TaskOut}, with the same
 *   workflow/urgency ranking the old engine used so status sorts by workflow order and priority
 *   by urgency. Entity-noun labels and option/label resolution are injected by the page (so
 *   vocabulary + the org's members/projects/programs flow through).
 * - {@link toViewState} / {@link toStoredView} convert between the generic toolbar state (which
 *   uses `groupBy.field` and `sort[].dir`) and the stored shape (`grouping.by`, `sort[].order`),
 *   so opening a saved view, tweaking it in the toolbar, and saving it round-trips losslessly.
 *
 * Keeping this adapter local to `views` means the generic engine stays free of any saved-view
 * coupling, and the entity-list pages (Projects, …) use the catalog model directly without it.
 */
import type { TaskOut, ViewFilter, ViewGrouping, ViewSort } from '@docket/types';

import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/components/task-detail/priority';
import { STATE_GROUP_LABEL, STATE_GROUP_ORDER, stateTypeOf } from '@/lib/work-state';

import {
  type FieldCatalog,
  type FieldOption,
  type ViewFilterTerm,
  type ViewSortTerm,
  type ViewState,
} from './field-catalog';

/** The canonical workflow-state keys a default org seeds, in workflow order. */
const STATE_KEY_ORDER: readonly string[] = ['backlog', 'todo', 'in_progress', 'done', 'canceled'];

/** The status field options (state key + canonical-type label + glyph hint), in workflow order. */
const STATE_OPTIONS: readonly FieldOption[] = STATE_KEY_ORDER.map((key) => {
  const type = stateTypeOf(key);
  return { value: key, label: STATE_GROUP_LABEL[type], hint: type };
});

/** The priority field options (value + label), most-pressing first. */
const PRIORITY_OPTIONS: readonly FieldOption[] = PRIORITY_ORDER.map((priority) => ({
  value: priority,
  label: PRIORITY_LABEL[priority],
}));

/** Sort/group rank for a status key, by its canonical type's workflow order. */
function statusRank(value: string | number | null): number {
  if (value === null) return STATE_GROUP_ORDER.length;
  return STATE_GROUP_ORDER.indexOf(stateTypeOf(String(value)));
}

/** Sort/group rank for a priority value (urgent first), by {@link PRIORITY_ORDER}. */
function priorityRank(value: string | number | null): number {
  if (value === null) return PRIORITY_ORDER.length;
  const index = PRIORITY_ORDER.indexOf(value as (typeof PRIORITY_ORDER)[number]);
  return index === -1 ? PRIORITY_ORDER.length : index;
}

/** Injected resolvers a page supplies so the task catalog can skin labels + relation options. */
export interface TaskCatalogDeps {
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
}

/**
 * Build the task {@link FieldCatalog} the Saved Views toolbar drives.
 *
 * @param deps - The page-supplied vocabulary labels + relation resolvers/options.
 * @returns the catalog over {@link TaskOut}.
 */
export function buildTaskCatalog(deps: TaskCatalogDeps): FieldCatalog<TaskOut> {
  return [
    {
      key: 'state',
      label: 'Status',
      type: 'enum',
      accessor: (task) => task.state,
      options: STATE_OPTIONS,
      groupable: true,
      sortable: true,
      rank: statusRank,
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
    filters: state.filters.map(
      (f: ViewFilterTerm): ViewFilter => ({
        field: f.field,
        op: f.op,
        value: f.value,
      }),
    ),
    grouping: state.groupBy ? { by: state.groupBy.field } : null,
    sort: state.sort.map((s: ViewSortTerm): ViewSort => ({ field: s.field, order: s.dir })),
  };
}
