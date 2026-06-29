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
 * table owns.
 */
import type { TaskOut } from '@docket/types';
import {
  ActorAvatar,
  type ActorKind,
  type Column,
  EntityTable,
  type EntityTableGroup,
  StatusIcon,
} from '@docket/ui/components';
import Link from 'next/link';
import type { JSX } from 'react';

import { formatEstimate } from '@/lib/format-estimate';
import { formatCalendarDate } from '@/lib/format-date';
import { stateTypeOf } from '@/lib/work-state';

import type { FieldCatalog } from './field-catalog';
import { findField } from './field-catalog';

/** The minimal resolved-actor shape the assignee column renders (name + kind + optional avatar). */
export interface TaskTableActor {
  /** The actor's display name. */
  readonly name: string;
  /** The actor's kind, selecting the avatar shape. */
  readonly kind: ActorKind;
  /** Optional avatar image URL. */
  readonly avatarUrl?: string | null;
}

/** A neutral fallback header label, used only if the catalog omits a field (it never should). */
function headerFor<T>(catalog: FieldCatalog<T>, key: string, fallback: string): string {
  return findField(catalog, key)?.label ?? fallback;
}

/** Props for {@link buildTaskColumns}. */
export interface TaskColumnsDeps {
  /** The task {@link FieldCatalog} (the same one the {@link FilterToolbar} drives). */
  catalog: FieldCatalog<TaskOut>;
  /** Resolve a task's assignee actor id to its display name + kind for the avatar column. */
  resolveActor: (actorId: string) => TaskTableActor;
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
export function buildTaskColumns({ catalog, resolveActor }: TaskColumnsDeps): Column<TaskOut>[] {
  return [
    // Leading status glyph — colored by the canonical workflow-state type. Always kept.
    {
      key: 'glyph',
      header: '',
      width: '1.25rem',
      priority: 'always',
      render: (task) => {
        const type = stateTypeOf(task.state);
        return <StatusIcon type={type} label={headerFor(catalog, 'state', 'Status')} />;
      },
    },
    // Title — the one flexing, truncating column.
    {
      key: 'title',
      header: headerFor(catalog, 'title', 'Title'),
      flex: true,
      render: (task) => <span className="text-on-surface truncate">{task.title}</span>,
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
  ];
}

/** Props for {@link TaskTable}. */
export interface TaskTableProps {
  /** The task columns, from {@link buildTaskColumns}. */
  columns: readonly Column<TaskOut>[];
  /** The flat tasks to render. Provide *either* `tasks` *or* {@link TaskTableProps.groups}. */
  tasks?: readonly TaskOut[];
  /** Grouped tasks: full-width group headers with their task rows beneath (wins over `tasks`). */
  groups?: readonly EntityTableGroup<TaskOut>[];
  /** Build the task-detail href for a task (a real, right-clickable link target). */
  taskHref: (task: TaskOut) => string;
  /** Optional override for row activation (e.g. push via router); links navigate by default. */
  onOpenTask?: (task: TaskOut) => void;
  /** Warm a task's detail cache on row hover/focus (prefetch-on-intent). Optional; no-op if unset. */
  onRowPrefetch?: (task: TaskOut) => void;
  /** Accessible label for the grid. */
  label: string;
  /** Initial collapsed group ids (uncontrolled). */
  defaultCollapsed?: Iterable<string>;
  /** Extra classes merged onto the table's outer container. */
  className?: string;
}

/**
 * Render a task list as the shared aligned-column {@link EntityTable}.
 *
 * @remarks
 * The single task-list surface: every task row reads with the same status glyph + title + aligned
 * properties as every other task list, and the same row chrome as an entity roster. Rows open the
 * task detail through a real Next.js `Link`; `onOpenTask` may additionally run on activation (e.g.
 * a router push for the keyboard path).
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
  return (
    <EntityTable<TaskOut>
      aria-label={label}
      columns={columns}
      {...(groups ? { groups } : { rows: tasks ?? [] })}
      getRowKey={(task) => task.id}
      rowHref={(task) => taskHref(task)}
      renderRowLink={(lp) => (
        <Link
          href={lp.href}
          className={lp.className}
          onClick={lp.onClick}
          onMouseEnter={lp.onMouseEnter}
          onFocus={lp.onFocus}
          tabIndex={lp.tabIndex}
          aria-current={lp['aria-current']}
        >
          {lp.children}
        </Link>
      )}
      onRowPrefetch={onRowPrefetch}
      onRowClick={
        onOpenTask
          ? (task) => {
              onOpenTask(task);
            }
          : undefined
      }
      defaultCollapsed={defaultCollapsed}
      className={className}
    />
  );
}
