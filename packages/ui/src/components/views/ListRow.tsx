'use client';

/**
 * `@docket/ui` — the list row primitive and its Task-cell preset.
 *
 * @remarks
 * {@link ListRow} is the generic grid row used by the virtualized {@link ListView}: it
 * carries `role="row"`, owns selection/active styling, and exposes the keyboard/selection
 * affordances (`tabIndex`, `data-active`, `aria-selected`). Arbitrary cells (each
 * `role="gridcell"`) are passed as children.
 *
 * {@link TaskRow} is the canonical preset for a task: a leading {@link StatusIcon} (colored
 * by the task's workflow-state *type*), the title, and a trailing {@link ActorAvatar} for
 * the assignee. Feature code can compose {@link ListRow} + {@link ListCell} directly for
 * other entity shapes.
 */
import * as React from 'react';

import { cn } from '../../lib/utils';
import { focusRingInset } from '../../primitives/focus';
import { ActorAvatar, type ActorKind } from '../atoms/ActorAvatar';
import { StatusIcon, type WorkflowStateType } from '../atoms/StatusIcon';

/** Props for {@link ListRow}. */
export interface ListRowProps extends React.ComponentPropsWithoutRef<'div'> {
  /** The row's cells, each typically a {@link ListCell} (`role="gridcell"`). */
  children: React.ReactNode;
  /** Whether the row is the active (keyboard-focused) row. */
  active?: boolean;
  /** Whether the row is selected. */
  selected?: boolean;
  /** Activate the row (Enter / click). */
  onActivate?: () => void;
  /** Tab index for roving-tabindex keyboard navigation; defaults to `-1`. */
  tabIndex?: number;
  /** Extra classes merged onto the row. */
  className?: string;
}

/** Props for {@link ListCell}. */
export interface ListCellProps {
  /** The cell content. */
  children: React.ReactNode;
  /** Extra classes merged onto the gridcell. */
  className?: string;
}

/**
 * A single grid cell (`role="gridcell"`) within a {@link ListRow}.
 *
 * @remarks
 * A minimal flex container; pass layout classes via `className` (e.g. `flex-1` for the
 * title cell, `shrink-0` for fixed-width leading/trailing cells).
 */
export function ListCell({ children, className }: ListCellProps): React.JSX.Element {
  return (
    <span role="gridcell" className={cn('flex min-w-0 items-center', className)}>
      {children}
    </span>
  );
}

/**
 * The generic virtualized-list row primitive.
 *
 * @remarks
 * Renders `role="row"` with selection/active styling driven by the MD3 surface tones
 * (`bg-surface-container-highest` for active/selected, `hover:bg-surface-container-high`).
 * Activating the row (click or Enter handled by the row's `onKeyDown`)
 * calls `onActivate`. Keyboard *navigation between* rows is owned by `useListKeyboard` at
 * the {@link ListView} level; this row only handles its own activation.
 *
 * Density is the shared row rhythm — `min-h-9 px-3 py-1.5 gap-2` (36px tall) — so a virtualized
 * task list and a plain {@link EntityListRow} entity list read as the same component family. The
 * keyboard-focus treatment is the dense-row {@link focusRingInset} so adjacent flush rows never
 * collide rings.
 *
 * It forwards its ref and spreads any extra DOM props onto the row `<div>`, so it can serve as a
 * `ContextMenuTrigger asChild` child (right-click row actions) without an extra wrapper element —
 * keeping the virtualized list's row measurement intact.
 */
export const ListRow = React.forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { children, active = false, selected = false, onActivate, tabIndex = -1, className, ...rest },
  ref,
): React.JSX.Element {
  return (
    <div
      ref={ref}
      role="row"
      aria-selected={selected}
      data-active={active ? '' : undefined}
      tabIndex={tabIndex}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onActivate?.();
        }
      }}
      {...rest}
      className={cn(
        'border-outline-variant text-body flex min-h-9 w-full cursor-pointer items-center gap-2 border-b px-3 py-1.5 transition-colors outline-none',
        'hover:bg-surface-container-high focus-visible:bg-surface-container-high',
        focusRingInset,
        active && 'bg-surface-container-highest',
        selected && 'bg-surface-container-highest',
        className,
      )}
    >
      {children}
    </div>
  );
});

/** The minimal task shape the {@link TaskRow} preset renders. */
export interface TaskRowData {
  /** Stable task id. */
  id: string;
  /** Task title. */
  title: string;
  /** The canonical workflow-state type driving the leading {@link StatusIcon}. */
  stateType: WorkflowStateType;
  /** Optional assignee display name. */
  assigneeName?: string | null;
  /** The assignee's actor kind; defaults to `human` when an assignee is present. */
  assigneeKind?: ActorKind;
  /** Optional assignee avatar URL. */
  assigneeAvatarUrl?: string | null;
}

/** Props for {@link TaskRow}. */
export interface TaskRowProps {
  /** The task to render. */
  task: TaskRowData;
  /** Whether the row is the active (keyboard-focused) row. */
  active?: boolean;
  /** Whether the row is selected. */
  selected?: boolean;
  /** Activate (open) the task. */
  onActivate?: () => void;
  /** Tab index for roving-tabindex keyboard navigation; defaults to `-1`. */
  tabIndex?: number;
}

/**
 * The canonical Task-cell preset: status icon, title, and assignee avatar.
 *
 * @remarks
 * Composes {@link ListRow} + {@link ListCell}; the leading {@link StatusIcon} is colored by
 * the task's workflow-state *type*, and the trailing {@link ActorAvatar} encodes the
 * assignee's kind by shape. Pass this as the `renderRow` for a task-oriented {@link ListView}.
 *
 * @example
 * ```tsx
 * <ListView items={tasks} groupBy={byProject} renderRow={(t) => <TaskRow task={t} />} />
 * ```
 */
export function TaskRow({
  task,
  active,
  selected,
  onActivate,
  tabIndex,
}: TaskRowProps): React.JSX.Element {
  return (
    <ListRow active={active} selected={selected} onActivate={onActivate} tabIndex={tabIndex}>
      <ListCell className="shrink-0">
        <StatusIcon type={task.stateType} />
      </ListCell>
      <ListCell className="flex-1">
        <span className="text-on-surface truncate">{task.title}</span>
      </ListCell>
      {task.assigneeName ? (
        <ListCell className="shrink-0">
          <ActorAvatar
            kind={task.assigneeKind ?? 'human'}
            name={task.assigneeName}
            avatarUrl={task.assigneeAvatarUrl}
          />
        </ListCell>
      ) : null}
    </ListRow>
  );
}
