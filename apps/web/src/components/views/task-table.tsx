'use client';

import { renderSourcePeople } from '@/components/people/source-person-references';

/**
 * `views` — the shared, aligned-column **task table**: the one surface every in-app task
 * *list* renders through, so a project's tasks, a cycle's committed tasks, and any other task
 * roster read identically.
 *
 * @remarks
 * This is the task-side application of the design decision (the user's mandate) that
 * Initiatives, Projects, and Tasks must read as the *same* surface — aligned rows under a light
 * header, Linear-style. {@link TaskTable} renders tasks through the design-system
 * {@link EntityTable} primitive with one shared column vocabulary: the entity icon and a
 * flexing/truncating **title**, then the task's key properties in **aligned** columns — status,
 * labels, assignee, due date, and Time (the viewer's timer beside the estimate, {@link TaskTimeCell}). Because it is the
 * same {@link EntityTable} an entity roster uses, a task list and a project/initiative roster
 * share the exact row chrome (density, hover/active/selected tone, inset focus ring, hairline
 * dividers) and the same responsive column-priority strategy (low-priority columns shed first,
 * then horizontal scroll *within* the table's own panel) — so the app never overflows the page.
 *
 * Columns are derived from the task {@link FieldCatalog} (`buildTaskCatalog`) so the column
 * headers and value labels stay consistent with the {@link FilterToolbar} that sits above the
 * same catalog: the status/assignee labels come straight from the catalog field descriptors.
 *
 * Grouping (by milestone for a project's tasks, by project/program for a cycle's tasks) is passed
 * as {@link EntityTableGroup}s so the full-width group headers span every column, consistent with
 * how a grouped entity roster renders. Within each group a subtask sits directly under its parent
 * Task, one level deeper, and the table becomes a treegrid ({@link nestTaskList}); the glyphs and
 * title render as one indented identity cell with hierarchy rails ({@link withTaskIdentity}).
 * Activating a row opens the task detail via a real Next.js `Link` (right-clickable /
 * new-tab-openable), with the roving-tabindex keyboard navigation the table owns. Pressing `L` on
 * the focused row opens the shared label picker and `W` the time-estimate picker
 * ({@link useTaskRowPickers}), each seeded with the row's own value.
 */
import { type EntityDisplayOut } from '@docket/work/entity-display-contract';
import { type TaskOut } from '@docket/work/task-model';
import {
  ActorAvatar,
  type ActorKind,
  type Column,
  EntityTable,
  type EntityTableGroup,
  type EntityTableRowInteraction,
  LabelChipRow,
} from '@docket/ui/components';
import { type JSX, type ReactNode, useMemo } from 'react';
import { cn } from '@docket/ui/lib/utils';

import { OBJECT_MORE_COLUMN_CLASSNAME, ObjectMoreButton } from '@/components/context-menu';
import { EditableTitle } from '@/components/editor/editable-title';
import {
  type WorkStatusDisplay,
  unknownStatus,
  WorkStatusIcon,
} from '@/components/entity-display/work-status';
import { useDraggable } from '@/components/dnd/use-draggable';
import {
  SelectAllCheckbox,
  SelectionCheckbox,
  SelectionProvider,
  useEntityTableSelection,
  useSelection,
} from '@/components/selection';
import { useTaskHierarchyDrop } from '@/components/tasks/task-hierarchy-drop';
import { useTimerRecord } from '@/components/time-tracking';
import { objectKey, objectTargetProps } from '@/lib/actions';
import { formatCalendarDate } from '@/lib/format-date';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery, usePrefetchApi } from '@/lib/query';
import { taskDetailDef } from '@/lib/use-task-detail';

import { hierarchyRowAria } from '@/components/work-views/hierarchy-rails';

import type { FieldCatalog } from './field-catalog';
import { findField } from './field-catalog';
import { PAGE_LIST_BLEED } from './page-layout';
import { TASK_TABLE_INLINE_LINK_COLUMN_KEY, withTaskIdentity } from './task-identity-cell';
import { taskRowObject, useTaskRowPickers } from './task-row-pickers';
import { TaskTimeCell } from './task-time-cell';
import { nestTaskList, type TaskPositions } from './task-table-hierarchy';

/** The minimal resolved-actor shape the assignee column renders (name + kind + optional avatar). */
export interface TaskTableActor {
  /** The actor's display name. */
  readonly name: string;
  /** The actor's kind, selecting the avatar shape. */
  readonly kind: ActorKind;
  /** Optional avatar image URL. */
  readonly avatarUrl?: string | null | undefined;
}

/** A neutral fallback header label, used only if the catalog omits a field (it never should). */
function headerFor<T>(catalog: FieldCatalog<T>, key: string, fallback: string): string {
  return findField(catalog, key)?.label ?? fallback;
}

/** Props for {@link buildTaskColumns}. */
export interface TaskColumnsDeps {
  /** The task {@link FieldCatalog} (the same one the {@link FilterToolbar} drives). */
  catalog: FieldCatalog<TaskOut>;
  /**
   * The workspace's Task statuses, in board order, so the leading glyph can name itself.
   *
   * @remarks
   * A row's `state` is a key into this set, and the glyph's colour comes from the matching
   * status's category. Required so a list cannot silently fall back to grey: pass `[]` only while
   * the set has not arrived, which draws every row as the neutral backlog ring.
   */
  statuses: readonly WorkStatusDisplay[];
  /** Resolve a task's assignee actor id to its display name + kind for the avatar column. */
  resolveActor: (actorId: string) => TaskTableActor;
  /** Whether the viewer may rename a task in place (double-click the title). */
  canEdit?: boolean | undefined;
  /** Persist a renamed task title. Enables inline rename when provided with `canEdit`. */
  onRename?: ((taskId: string, title: string) => void) | undefined;
  /**
   * Whether the viewer may set a task's time estimate from its row. `false` shows the estimate as
   * text; omit where the list does not know, and the server decides.
   */
  canEstimate?: boolean | undefined;
  /** Open a task — used by the inline title so a single click still navigates. */
  onOpen?: ((task: TaskOut) => void) | undefined;
}

/** A short, year-less day formatter for a task's due date (e.g. "Jun 21"). */
const DUE_DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

/** Props for {@link TaskStatusCell}. */
interface TaskStatusCellProps {
  /** The workspace's Task statuses. */
  readonly statuses: readonly WorkStatusDisplay[];
  /** The row's task. */
  readonly task: TaskOut;
}

/**
 * A task's status as the Tasks page shows it: the category-coloured glyph and the workspace's own
 * name for the status, drawn from the workspace's statuses by the task's state key.
 */
function TaskStatusCell({ statuses, task }: TaskStatusCellProps): JSX.Element {
  const { name, category } =
    statuses.find((status) => status.key === task.state) ?? unknownStatus(task.state);
  return (
    <span className="text-on-surface-variant flex min-w-0 items-center gap-2">
      <WorkStatusIcon name={name} category={category} />
      <span className="truncate" aria-hidden="true">
        {name}
      </span>
    </span>
  );
}

/**
 * Build the shared aligned-column spec for a task list, derived from the task catalog.
 *
 * @remarks
 * Declaration order is the visual order: the flexing title (which the table leads with the task's
 * entity icon), then status, labels, assignee, due date, and estimate in priority order (the
 * lowest-priority columns shed first as the table narrows). Headers come from the catalog field
 * descriptors so the table and the {@link FilterToolbar} above it read from one source of truth.
 *
 * @param deps - The task catalog + the assignee resolver.
 * @returns the ordered {@link Column} spec over {@link TaskOut}.
 */
export function buildTaskColumns({
  catalog,
  statuses,
  resolveActor,
  canEdit,
  onRename,
  onOpen,
  canEstimate,
}: TaskColumnsDeps): Column<TaskOut>[] {
  return [
    // Title — the one flexing, truncating column.
    {
      key: 'title',
      header: headerFor(catalog, 'title', 'Title'),
      flex: true,
      render: (task) =>
        canEdit && onRename ? (
          <EditableTitle
            value={task.title}
            onSave={(title) => {
              onRename(task.id, title);
            }}
            canEdit
            activate="doubleClick"
            {...(onOpen
              ? {
                  onActivate: () => {
                    onOpen(task);
                  },
                }
              : {})}
            ariaLabel="Task title"
            className="text-on-surface truncate"
          />
        ) : (
          <span className="text-on-surface truncate">{task.title}</span>
        ),
    },
    // Status — glyph plus the workspace's name for it, as on the Tasks page. The first fact a
    // table adds (priority 2, from a 512px table); below that the row is its icon and title.
    // Each later tier is placed so the title keeps at least ~230px as the columns arrive.
    {
      key: 'state',
      header: headerFor(catalog, 'state', 'Status'),
      width: '7rem',
      priority: 2,
      render: (task) => <TaskStatusCell statuses={statuses} task={task} />,
    },
    // Labels — the workspace's own vocabulary. Sheds first (priority 7, below a 1024px table)
    // because it is the most optional fact on a row, and a table beside the Athena panel needs
    // that width for titles.
    {
      key: 'labels',
      header: headerFor(catalog, 'labels', 'Labels'),
      minWidth: '7rem',
      priority: 7,
      render: (task) =>
        task.labels.length > 0 ? (
          <LabelChipRow labels={task.labels} />
        ) : (
          <span className="text-on-surface-variant">—</span>
        ),
    },
    // Assignee — relation field; the avatar encodes the actor kind by shape. From a 768px table
    // (priority 5), after the due date.
    {
      key: 'assigneeId',
      header: headerFor(catalog, 'assigneeId', 'Assignee'),
      minWidth: '8rem',
      priority: 5,
      render: (task) => renderTaskAssignee(task, resolveActor),
    },
    // Due date — end-aligned, tabular so dates line up. From a 576px table (priority 3).
    {
      key: 'dueDate',
      header: headerFor(catalog, 'dueDate', 'Due date'),
      align: 'end',
      width: '5rem',
      priority: 3,
      render: (task) => {
        const due = formatCalendarDate(task.dueDate, DUE_DATE_OPTIONS);
        return <span className="text-on-surface-variant tabular-nums">{due ?? '—'}</span>;
      },
    },
    // Time — the viewer's timer beside the estimate ("1h 30m"), which becomes the live pill while
    // the task is tracked. An action as well as a fact, so it arrives first (priority 1, from a
    // 448px table); below that a tracked task's pill sits beside its title instead.
    {
      key: 'time',
      header: 'Time',
      align: 'end',
      width: '6rem',
      priority: 1,
      render: (task) => <TaskTimeCell task={task} editable={canEstimate !== false} />,
    },
  ];
}

/** Props for {@link TaskTable}. */
export interface TaskTableProps {
  /** The task columns, from {@link buildTaskColumns}. */
  columns: readonly Column<TaskOut>[];
  /** The flat tasks to render. Provide *either* `tasks` *or* {@link TaskTableProps.groups}. */
  tasks?: readonly TaskOut[] | undefined;
  /** Grouped tasks: full-width group headers with their task rows beneath (wins over `tasks`). */
  groups?: readonly EntityTableGroup<TaskOut>[] | undefined;
  /** Build the task-detail href for a task (a real, right-clickable link target). */
  taskHref: (task: TaskOut) => string;
  /** Optional override for row activation (e.g. push via router); links navigate by default. */
  onOpenTask?: ((task: TaskOut) => void) | undefined;
  /** Accessible label for the grid. */
  label: string;
  /** Initial collapsed group ids (uncontrolled). */
  defaultCollapsed?: Iterable<string> | undefined;
  /** Extra classes merged onto the table's outer container. */
  className?: string | undefined;
  /**
   * Whether this table is its page's main list, which runs edge to edge on a narrow pane
   * ({@link PAGE_LIST_BLEED}). Leave it off for a table inside a card or panel.
   */
  bleed?: boolean | undefined;
  /** Customized task identities composed through one workspace-wide display read. */
  displayByTaskId?: ReadonlyMap<string, EntityDisplayOut> | undefined;
  /**
   * A pending proposal's sentence for a task, keyed by task id.
   *
   * @remarks
   * A task with an entry renders as a ghost row — the tonal tint at reduced opacity, no border,
   * that marks a change that has not happened yet — with the sentence trailing its title and a
   * stable `proposal-task-<id>` view-transition name, so approving the change can morph the row
   * in place instead of popping its new state in.
   */
  proposedByTaskId?: ReadonlyMap<string, string> | undefined;
  /** Task ids to tint with the hover-highlight tone (the row a hovered proposal would change). */
  highlightedIds?: ReadonlySet<string> | undefined;
}

/** Flatten nested task groups into the provider's visible object order. */
function taskGroupRows(groups: readonly EntityTableGroup<TaskOut>[]): readonly TaskOut[] {
  return groups.flatMap((group) => group.rows ?? taskGroupRows(group.children));
}

/** Resolve the provider row set without adding branches to the public renderer. */
function taskTableRows(
  tasks: readonly TaskOut[] | undefined,
  groups: readonly EntityTableGroup<TaskOut>[] | undefined,
): readonly TaskOut[] {
  return groups === undefined ? (tasks ?? []) : taskGroupRows(groups);
}

/** Build one stable selection identity for a task table instance. */
function taskTableSurfaceId(organizationId: string | null, label: string): string {
  return `task-table:${organizationId ?? 'none'}:${label}`;
}

/**
 * Render a task list as the shared aligned-column {@link EntityTable}.
 *
 * @remarks
 * The single task-list surface: every task row reads with the same status glyph + title + aligned
 * properties as every other task list, and the same row chrome as an entity roster. Rows open the
 * task detail through a real Next.js `Link`; `onOpenTask` may additionally run on activation (e.g.
 * a router push for the keyboard path). Every row is also a drag source publishing the canonical
 * `kind: 'task'` entity object, so a task can be dragged from any task list onto any drop target
 * (the calendar, an initiative, a cycle) without this surface knowing what a drop means.
 *
 * @param props - The {@link TaskTableProps}.
 * @returns the rendered table.
 */
export function TaskTable({
  columns,
  tasks,
  groups,
  taskHref,
  onOpenTask,
  label,
  defaultCollapsed,
  className,
  bleed = false,
  proposedByTaskId,
  highlightedIds,
}: TaskTableProps): JSX.Element {
  // Subtasks sit directly under their parent, so selection order follows the rendered order.
  const nesting = useMemo(() => nestTaskList(tasks, groups), [tasks, groups]);
  const visibleTasks = taskTableRows(nesting.tasks, nesting.groups);
  const objects = visibleTasks.map(taskRowObject);
  const organizationId = objects[0]?.organizationId ?? null;
  const selectionSurfaceId = taskTableSurfaceId(organizationId, label);
  const displaysQ = useApiQuery(
    apiQueryOptions(
      organizationId
        ? queryKeys.entityDisplays(organizationId, 'task')
        : ['entity-displays', 'task'],
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId: organizationId ?? '', subjectType: 'task' },
          query: { limit: '100' },
        }),
      'Could not load task display settings.',
      { enabled: organizationId !== null },
    ),
  );
  const displayByTaskId = new Map<string, EntityDisplayOut>(
    (displaysQ.data?.items ?? []).map((display) => [display.subjectId, display]),
  );

  return (
    <SelectionProvider
      key={selectionSurfaceId}
      surfaceId={selectionSurfaceId}
      items={objects}
      organizationId={objects[0]?.organizationId ?? null}
      actionScope="all"
      onActivate={(object) => {
        const task = visibleTasks.find(({ id }) => id === object.id);
        if (task) onOpenTask?.(task);
      }}
    >
      <SelectableTaskTable
        columns={columns}
        {...(nesting.groups ? { groups: nesting.groups } : { tasks: nesting.tasks ?? [] })}
        positions={nesting.positions}
        nested={nesting.nested}
        taskHref={taskHref}
        onOpenTask={onOpenTask}
        label={label}
        defaultCollapsed={defaultCollapsed}
        className={cn(bleed && PAGE_LIST_BLEED, className)}
        displayByTaskId={displayByTaskId}
        proposedByTaskId={proposedByTaskId}
        highlightedIds={highlightedIds}
      />
    </SelectionProvider>
  );
}

/** The ghost tint + opacity a proposed row renders with — no border, a tonal step only. */
const PROPOSED_ROW_CLASSNAME = 'bg-primary-container/25 opacity-80';

/** The tone a row renders with while a hovered proposal names it as its target. */
const HIGHLIGHTED_ROW_CLASSNAME = 'bg-surface-container-high';

/**
 * The light tonal step on the row the viewer is tracking, matched to its timer pill. It marks the
 * viewer's own clock only; selection keeps its stronger fill.
 */
const TRACKED_ROW_CLASSNAME = 'bg-secondary-container/35';

/** What {@link taskRowTone} reads to pick a row's tonal state. */
interface TaskRowToneState {
  readonly taskId: string;
  readonly selected: boolean;
  readonly proposed: boolean;
  readonly trackedTaskId: string | null | undefined;
  readonly highlightedIds: ReadonlySet<string> | undefined;
}

/** A row's tonal state classes: proposed, tracked by the viewer, or named by a hovered proposal. */
function taskRowTone(state: TaskRowToneState): string {
  return cn(
    state.proposed && PROPOSED_ROW_CLASSNAME,
    state.trackedTaskId === state.taskId && !state.selected && TRACKED_ROW_CLASSNAME,
    state.highlightedIds?.has(state.taskId) === true && HIGHLIGHTED_ROW_CLASSNAME,
  );
}

/** Row render-prop bridge that binds the application selection model inside generic UI. */
function TaskRowInteraction({
  row,
  tasks,
  proposedByTaskId,
  highlightedIds,
  children,
}: {
  readonly row: TaskOut;
  readonly tasks: readonly TaskOut[];
  readonly proposedByTaskId: ReadonlyMap<string, string> | undefined;
  readonly highlightedIds: ReadonlySet<string> | undefined;
  readonly children: (binding: EntityTableRowInteraction) => ReactNode;
}): JSX.Element {
  const object = taskRowObject(row);
  const selection = useSelection();
  const selected = selection.isSelected(objectKey(object));
  const drag = useDraggable({
    object,
    actionScope: selection.actionScope,
    surfaceId: selection.surfaceId,
    objects: selected ? selection.selectedObjects : [object],
  });
  const drop = useTaskHierarchyDrop(object, tasks);
  const proposed = proposedByTaskId?.has(row.id) ?? false;
  const trackedTaskId = useTimerRecord().record?.taskId;
  return (
    <>
      {children({
        selected,
        interactionRef: (element: HTMLElement | null) => {
          drag.ref(element);
          drop.rowProps.ref(element);
        },
        rowProps: {
          ...objectTargetProps(object),
          'aria-selected': selected,
          'data-selected': selected,
          'data-drop-state': drop.rowProps['data-drop-state'],
          'data-drag-state': drag['data-drag-state'],
          // The stable morph target: approving the proposal can transition this row's identity
          // in place instead of popping the settled row in once the ghost disappears.
          ...(proposed ? { style: { viewTransitionName: `proposal-task-${row.id}` } } : {}),
        },
        className: cn(
          drop.className,
          drop.rowProps.className,
          drag.className,
          taskRowTone({ taskId: row.id, selected, proposed, trackedTaskId, highlightedIds }),
        ),
      })}
      {drop.status ? (
        <span className="sr-only" role="status">
          {drop.status}
        </span>
      ) : null}
    </>
  );
}

/**
 * The leading selection checkbox. It appears on hover, so a touch screen could never see it; there
 * the column is dropped and its width goes to the title.
 */
const TASK_SELECTION_COLUMN: Column<TaskOut> = {
  key: 'selection',
  header: <SelectAllCheckbox />,
  width: '1rem',
  priority: 'always',
  className: 'pointer-coarse:hidden',
  render: (task) => <SelectionCheckbox object={taskRowObject(task)} />,
};

/** The trailing ⋯ that opens the row's action menu, the touch-screen route to right-click. */
const TASK_MORE_COLUMN: Column<TaskOut> = {
  key: 'more',
  header: '',
  width: '2rem',
  priority: 'always',
  className: OBJECT_MORE_COLUMN_CLASSNAME,
  render: (task) => <ObjectMoreButton title={task.title} />,
};

/** {@link TaskTableProps} plus the nesting {@link TaskTable} derived from them. */
interface SelectableTaskTableProps extends TaskTableProps {
  /** Each row's place under its parent Task, keyed by row object. */
  readonly positions: TaskPositions;
  /** Whether any row nests, which makes the grid a treegrid. */
  readonly nested: boolean;
}

/** The table body rendered inside its selection provider. */
function SelectableTaskTable({
  columns,
  tasks,
  groups,
  positions,
  nested,
  taskHref,
  onOpenTask,
  label,
  defaultCollapsed,
  className,
  displayByTaskId,
  proposedByTaskId,
  highlightedIds,
}: SelectableTaskTableProps): JSX.Element {
  const rowPickers = useTaskRowPickers();
  const prefetch = usePrefetchApi();
  const visibleTasks = taskTableRows(tasks, groups);
  const tableSelection = useEntityTableSelection<TaskOut>(taskRowObject);
  // Warm a task's detail on hover or focus, so opening it is instant.
  const onRowPrefetch = (task: TaskOut): void => {
    prefetch(taskDetailDef(task.organizationId, task.id));
  };
  const selectableColumns: readonly Column<TaskOut>[] = [
    TASK_SELECTION_COLUMN,
    ...withTaskIdentity(columns, {
      displayByTaskId,
      proposedByTaskId,
      positions,
      taskHref,
      onOpenTask,
      onRowPrefetch,
    }),
    TASK_MORE_COLUMN,
  ];
  return (
    <EntityTable<TaskOut>
      aria-label={label}
      columns={selectableColumns}
      {...(groups ? { groups } : { rows: tasks ?? [] })}
      getRowKey={(task) => task.id}
      gridRole={nested ? 'treegrid' : 'grid'}
      getRowAria={nested ? (task) => hierarchyRowAria(positions.get(task)) : undefined}
      {...tableSelection}
      rowHref={(task) => taskHref(task)}
      rowLinkColumnKey={TASK_TABLE_INLINE_LINK_COLUMN_KEY}
      renderRowInteraction={({ row, children }) => (
        <TaskRowInteraction
          row={row}
          tasks={visibleTasks}
          proposedByTaskId={proposedByTaskId}
          highlightedIds={highlightedIds}
        >
          {children}
        </TaskRowInteraction>
      )}
      onRowPrefetch={onRowPrefetch}
      {...(onOpenTask
        ? {
            onRowClick: (task: TaskOut) => {
              onOpenTask(task);
            },
          }
        : {})}
      onRowPropertyKey={rowPickers.onPropertyKey}
      {...(defaultCollapsed !== undefined ? { defaultCollapsed } : {})}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

function renderTaskAssignee(
  task: TaskOut,
  resolveActor: TaskColumnsDeps['resolveActor'],
): JSX.Element {
  const actor = task.assigneeId ? resolveActor(task.assigneeId) : null;
  if (!actor)
    return (
      renderSourcePeople(task, 'assignee') ?? <span className="text-on-surface-variant">—</span>
    );
  return (
    <span className="text-on-surface flex min-w-0 items-center gap-1.5">
      <ActorAvatar kind={actor.kind} name={actor.name} avatarUrl={actor.avatarUrl} size={18} />
      <span className="truncate">{actor.name}</span>
    </span>
  );
}
