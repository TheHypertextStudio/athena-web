'use client';

/**
 * `views` — the shared, aligned-column **task table**: the one surface every in-app task
 * *list* renders through, so a project's tasks, a cycle's committed tasks, and any other task
 * roster read identically.
 *
 * @remarks
 * This is the task-side application of the design decision (the user's mandate) that
 * Initiatives, Projects, and Tasks must read as the *same* surface — aligned rows under a light
 * header, Linear-style. {@link TaskTable} renders tasks through the design-system
 * {@link EntityTable} primitive with one shared column vocabulary: a leading status glyph, a
 * flexing/truncating **title**, then the task's key properties in **aligned** columns — status,
 * assignee, due date, and time estimate ({@link formatEstimate | `1h 30m`}). Because it is the
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
 * how a grouped entity roster renders. Activating a row opens the task detail via a real Next.js
 * `Link` (right-clickable / new-tab-openable), with the roving-tabindex keyboard navigation the
 * table owns. Pressing `L` on the focused row opens the shared label picker (via
 * {@link usePickerOverlay}) seeded with that row's own labels, since a task row already has them
 * in hand and needs no fetch to show them.
 */
import type { TaskOut } from '@docket/types';
import {
  ActorAvatar,
  type ActorKind,
  type Column,
  EntityTable,
  type EntityTableGroup,
  LabelChipRow,
} from '@docket/ui/components';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';
import {
  type WorkStatusDisplay,
  unknownStatus,
  WorkStatusIcon,
} from '@/components/entity-display/work-status';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import { useDragController } from '@/components/dnd/drag-context';
import { writeObjectSetPayload } from '@/components/dnd/drag-payload';
import {
  SelectAllCheckbox,
  SelectionCheckbox,
  SelectionProvider,
  useSelectableRow,
  useSelection,
  useSelectionContainerRef,
} from '@/components/selection';
import { useTaskHierarchyDrop } from '@/components/tasks/task-hierarchy-drop';
import { TaskTimerButton } from '@/components/time-tracking';
import { objectKey, objectTargetProps, type ObjectRef } from '@/lib/actions';
import { formatEstimate } from '@/lib/format-estimate';
import { formatCalendarDate } from '@/lib/format-date';

import type { FieldCatalog } from './field-catalog';
import { findField } from './field-catalog';

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

/**
 * Build the canonical `kind: 'task'` object literal a row publishes — both as its drag payload
 * ({@link entityDragSource}) and as the `L` hotkey's {@link ObjectRef} for the label picker. Kept
 * un-annotated (rather than typed as `ObjectRef`) so `organizationId` stays the task's own
 * non-nullable `OrganizationId`, satisfying `EntityDragItem`'s stricter `organizationId: string`
 * as well as the wider `ObjectRef.organizationId: string | null`.
 */
function taskObject(task: TaskOut) {
  return {
    kind: 'task' as const,
    id: task.id,
    organizationId: task.organizationId,
    title: task.title,
    meta: { parentTaskId: task.parentTaskId ?? null },
  } satisfies ObjectRef;
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
   * status's category. Omit it and every row draws the neutral backlog ring, which is the right
   * answer for a table rendered before the set has arrived.
   */
  statuses?: readonly WorkStatusDisplay[];
  /** Resolve a task's assignee actor id to its display name + kind for the avatar column. */
  resolveActor: (actorId: string) => TaskTableActor;
  /** Whether the viewer may rename a task in place (double-click the title). */
  canEdit?: boolean | undefined;
  /** Persist a renamed task title. Enables inline rename when provided with `canEdit`. */
  onRename?: ((taskId: string, title: string) => void) | undefined;
  /** Open a task — used by the inline title so a single click still navigates. */
  onOpen?: ((task: TaskOut) => void) | undefined;
}

/** A short, year-less day formatter for a task's due date (e.g. "Jun 21"). */
const DUE_DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

/**
 * Build the shared aligned-column spec for a task list, derived from the task catalog.
 *
 * @remarks
 * Declaration order is the visual order: the leading status glyph (always kept), the flexing
 * title, then status, assignee, due date, and estimate in priority order (the lowest-priority
 * columns shed first as the table narrows). Headers come from the catalog field descriptors so
 * the table and the {@link FilterToolbar} above it read from one source of truth.
 *
 * @param deps - The task catalog + the assignee resolver.
 * @returns the ordered {@link Column} spec over {@link TaskOut}.
 */
export function buildTaskColumns({
  catalog,
  statuses = [],
  resolveActor,
  canEdit,
  onRename,
  onOpen,
}: TaskColumnsDeps): Column<TaskOut>[] {
  const statusOf = (task: TaskOut): WorkStatusDisplay =>
    statuses.find((status) => status.key === task.state) ?? unknownStatus(task.state);

  return [
    // Leading status glyph — coloured by the status's category, named by the workspace's own word.
    {
      key: 'glyph',
      header: '',
      width: '1.25rem',
      priority: 'always',
      render: (task) => {
        const { name, category } = statusOf(task);
        return <WorkStatusIcon name={name} category={category} />;
      },
    },
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
    // Labels — the workspace's own vocabulary. Sheds first (priority 3) because it is the most
    // optional fact on a row: useful when you have labels, absent for a workspace that has none.
    {
      key: 'labels',
      header: headerFor(catalog, 'labels', 'Labels'),
      minWidth: '7rem',
      priority: 3,
      render: (task) =>
        task.labels.length > 0 ? (
          <LabelChipRow labels={task.labels} />
        ) : (
          <span className="text-on-surface-variant">—</span>
        ),
    },
    // Assignee — relation field; the avatar encodes the actor kind by shape.
    {
      key: 'assigneeId',
      header: headerFor(catalog, 'assigneeId', 'Assignee'),
      minWidth: '8rem',
      priority: 2,
      render: (task) => {
        const actor = task.assigneeId ? resolveActor(task.assigneeId) : null;
        if (!actor) return <span className="text-on-surface-variant">—</span>;
        return (
          <span className="text-on-surface flex min-w-0 items-center gap-1.5">
            <ActorAvatar
              kind={actor.kind}
              name={actor.name}
              avatarUrl={actor.avatarUrl}
              size={18}
            />
            <span className="truncate">{actor.name}</span>
          </span>
        );
      },
    },
    // Due date — end-aligned, tabular so dates line up.
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
    // Estimate — `estimateMinutes` formatted as "1h 30m"; end-aligned, tabular.
    {
      key: 'estimate',
      header: 'Estimate',
      align: 'end',
      width: '4.5rem',
      priority: 3,
      render: (task) => {
        const estimate = formatEstimate(task.estimateMinutes);
        return <span className="text-on-surface-variant tabular-nums">{estimate ?? '—'}</span>;
      },
    },
    // Track — the universal start-timer affordance: every task list is a place a task
    // is "represented", so every row offers it, icon-only to stay dense. Kept a tier longer than
    // the metadata columns (priority 1 vs. 2/3) since it is an action, not a fact about the task.
    {
      key: 'timer',
      header: '',
      width: '2.25rem',
      priority: 1,
      render: (task) => (
        <TaskTimerButton taskId={task.id} title={task.title} controlSize="sm" withLabel={false} />
      ),
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
  /** Warm a task's detail cache on row hover/focus (prefetch-on-intent). Optional; no-op if unset. */
  onRowPrefetch?: ((task: TaskOut) => void) | undefined;
  /** Accessible label for the grid. */
  label: string;
  /** Initial collapsed group ids (uncontrolled). */
  defaultCollapsed?: Iterable<string> | undefined;
  /** Extra classes merged onto the table's outer container. */
  className?: string | undefined;
}

/**
 * Drop every key whose value is `undefined`, keeping the rest under their original (now
 * `undefined`-free) types — for spreading an object with optional-and-possibly-`undefined`
 * fields onto a target whose own prop types don't accept an explicit `undefined`.
 */
function withoutUndefinedValues<T extends object>(
  value: T,
): {
  [K in keyof T]: Exclude<T[K], undefined>;
} {
  const result = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(value) as (keyof T)[]) {
    const fieldValue = value[key];
    if (fieldValue !== undefined) {
      result[key] = fieldValue as Exclude<T[typeof key], undefined>;
    }
  }
  return result;
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
  onRowPrefetch,
  label,
  defaultCollapsed,
  className,
}: TaskTableProps): JSX.Element {
  const visibleTasks = groups ? groups.flatMap((group) => group.rows) : (tasks ?? []);
  const objects = visibleTasks.map(taskObject);

  return (
    <SelectionProvider
      items={objects}
      organizationId={objects[0]?.organizationId ?? null}
      onActivate={(object) => {
        const task = visibleTasks.find(({ id }) => id === object.id);
        if (task) onOpenTask?.(task);
      }}
    >
      <SelectableTaskTable
        columns={columns}
        {...(groups ? { groups } : { tasks: tasks ?? [] })}
        taskHref={taskHref}
        onOpenTask={onOpenTask}
        onRowPrefetch={onRowPrefetch}
        label={label}
        defaultCollapsed={defaultCollapsed}
        className={className}
      />
    </SelectionProvider>
  );
}

/** Row render-prop bridge that binds the application selection model inside generic UI. */
function TaskRowInteraction({
  row,
  tasks,
  children,
}: {
  readonly row: TaskOut;
  readonly tasks: readonly TaskOut[];
  readonly children: (
    binding: ReturnType<typeof useSelectableRow> & { readonly className?: string },
  ) => ReactNode;
}): JSX.Element {
  const object = taskObject(row);
  const binding = useSelectableRow(object);
  const drop = useTaskHierarchyDrop(object, tasks);
  return (
    <>
      {children({
        ...binding,
        rowProps: { ...binding.rowProps, ...objectTargetProps(object), ...drop.rowProps },
        className: drop.className,
      })}
      {drop.status ? (
        <span className="sr-only" role="status">
          {drop.status}
        </span>
      ) : null}
    </>
  );
}

/** The table body rendered inside its selection provider. */
function SelectableTaskTable({
  columns,
  tasks,
  groups,
  taskHref,
  onOpenTask,
  onRowPrefetch,
  label,
  defaultCollapsed,
  className,
}: TaskTableProps): JSX.Element {
  const pickerOverlay = usePickerOverlay();
  const selection = useSelection();
  const selectionRef = useSelectionContainerRef();
  const dragController = useDragController();
  const visibleTasks = groups ? groups.flatMap((group) => group.rows) : (tasks ?? []);
  const selectableColumns: readonly Column<TaskOut>[] = [
    {
      key: 'selection',
      header: <SelectAllCheckbox />,
      width: '1rem',
      priority: 'always',
      render: (task) => <SelectionCheckbox object={taskObject(task)} />,
    },
    ...columns,
  ];
  const openLabels = (task: TaskOut, anchor: HTMLElement | null): void => {
    const object = taskObject(task);
    pickerOverlay.open({
      kind: 'labels',
      organizationId: task.organizationId,
      objects: [object],
      current: new Map([[objectKey(object), task.labels.map((label) => label.id)]]),
      anchor,
    });
  };

  return (
    <EntityTable<TaskOut>
      aria-label={label}
      columns={selectableColumns}
      {...(groups ? { groups } : { rows: tasks ?? [] })}
      getRowKey={(task) => task.id}
      rowHref={(task) => taskHref(task)}
      rowLinkColumnKey="title"
      containerInteraction={{
        ...selection.containerProps,
        ref: selectionRef,
        onKeyDown: (event) => {
          selection.containerProps.onKeyDown(event);
          if (event.defaultPrevented || event.key.toLowerCase() !== 'l') return;
          const activeId = selection.activeKey?.replace(/^task:/, '');
          const task = [...(tasks ?? []), ...(groups?.flatMap((group) => group.rows) ?? [])].find(
            ({ id }) => id === activeId,
          );
          if (!task) return;
          event.preventDefault();
          openLabels(task, event.currentTarget.querySelector<HTMLElement>('[data-active="true"]'));
        },
      }}
      renderRowInteraction={({ row, children }) => (
        <TaskRowInteraction row={row} tasks={visibleTasks}>
          {children}
        </TaskRowInteraction>
      )}
      rowDrag={(task) => {
        const object = taskObject(task);
        return {
          onDragStart: (event) => {
            const objects = selection.isSelected(objectKey(object))
              ? selection.selectedObjects
              : [object];
            writeObjectSetPayload(event.dataTransfer, objects, object);
            dragController.begin(object, selection.surfaceId, objects);
          },
          onDragEnd: () => {
            dragController.end();
          },
        };
      }}
      renderRowLink={({ children, ...linkProps }) => (
        // Spread rather than cherry-pick: a dropped `draggable`/`onDragStart` would silently turn
        // the row back into an undraggable one with no type error. `withoutUndefinedValues` keeps
        // that guarantee while dropping the explicit-`undefined` values Link's own prop types
        // (unlike ours) don't accept under exactOptionalPropertyTypes.
        <Link {...withoutUndefinedValues(linkProps)}>{children}</Link>
      )}
      {...(onRowPrefetch !== undefined ? { onRowPrefetch } : {})}
      {...(onOpenTask
        ? {
            onRowClick: (task: TaskOut) => {
              onOpenTask(task);
            },
          }
        : {})}
      onRowPropertyKey={(key, task, anchor) => {
        if (key !== 'l') return false;
        openLabels(task, anchor);
        return true;
      }}
      {...(defaultCollapsed !== undefined ? { defaultCollapsed } : {})}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
