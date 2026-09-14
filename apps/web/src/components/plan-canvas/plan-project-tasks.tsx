'use client';

/**
 * `components/plan-canvas/plan-project-tasks` — what a container shows below its header.
 *
 * @remarks
 * At the altitude a plan is read, a project's tasks are a detail. A container rests collapsed and
 * names its tasks in miniature: a few titles, then a count. That block is
 * one click target, and the header's chevron is the same command, so showing the rows is a
 * deliberate act rather than the default. Expanded, the rows are real nodes and the container
 * ends with its Add task row; a container with no tasks yet shows only that row.
 */
import { ChevronDown, ChevronUp, Plus } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, surfaceToneColor } from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { PlanCanvasActions } from './plan-canvas-context';
import {
  PLAN_MINI_ROW,
  PLAN_MINI_SHOWN,
  PLAN_PROJECT_FOOTER,
  type PlanMiniTask,
  type PlanProjectNodeData,
} from './plan-nodes';

/** The accessible name of the command that shows or hides a container's rows. */
export function tasksToggleLabel(expanded: boolean, count: number): string {
  if (expanded) return 'Hide tasks';
  return `Show ${String(count)} ${count === 1 ? 'task' : 'tasks'}`;
}

/** Props for {@link PlanMiniTaskList}. */
export interface PlanMiniTaskListProps {
  readonly tasks: readonly PlanMiniTask[];
  readonly onExpand: () => void;
}

/** The miniature task list a collapsed container shows; one click shows the rows. */
export function PlanMiniTaskList({ tasks, onExpand }: PlanMiniTaskListProps): JSX.Element {
  const shown = tasks.slice(0, PLAN_MINI_SHOWN);
  const more = tasks.length - shown.length;
  const label = tasksToggleLabel(false, tasks.length);
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-label={label}
      title={label}
      data-testid="plan-mini-tasks"
      onClick={(event) => {
        event.stopPropagation();
        onExpand();
      }}
      className={cn(
        surfaceToneColor('floating'),
        'nodrag nopan text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring flex w-full flex-col rounded-md px-1 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
      )}
    >
      {shown.map((task) => (
        <span
          key={task.ref}
          className="text-label-small flex min-w-0 items-center gap-1.5"
          style={{ height: PLAN_MINI_ROW }}
        >
          <span className="min-w-0 flex-1 truncate">{task.title}</span>
        </span>
      ))}
      {more > 0 ? (
        <span
          className="text-label-small flex items-center gap-1.5"
          style={{ height: PLAN_MINI_ROW }}
        >
          +{more} more
        </span>
      ) : null}
    </button>
  );
}

/** Props for {@link PlanTasksToggle}. */
export interface PlanTasksToggleProps {
  readonly expanded: boolean;
  readonly count: number;
  readonly onToggle: () => void;
}

/** The header's chevron: the same command as the miniature list, from the row a person reads. */
export function PlanTasksToggle({ expanded, count, onToggle }: PlanTasksToggleProps): JSX.Element {
  const Glyph = expanded ? ChevronUp : ChevronDown;
  const label = tasksToggleLabel(expanded, count);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      className="nodrag nopan shrink-0"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Glyph className="size-4" />
    </Button>
  );
}

/** Props for {@link PlanProjectBody}. */
export interface PlanProjectBodyProps {
  readonly id: string;
  readonly node: PlanProjectNodeData;
  readonly actions: PlanCanvasActions | null;
}

/**
 * Below the header: the miniature list while collapsed, or the Add task row when the rows are
 * shown (or there are none yet) and the viewer may add one.
 */
export function PlanProjectBody({ id, node, actions }: PlanProjectBodyProps): JSX.Element | null {
  if (!node.expanded && node.tasks.length > 0) {
    return (
      <div className="px-2 pt-2">
        <PlanMiniTaskList
          tasks={node.tasks}
          onExpand={() => {
            actions?.toggleTasks(id);
          }}
        />
      </div>
    );
  }
  if (!node.canAddTask || actions === null) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        actions.addTask(id);
      }}
      style={{ height: PLAN_PROJECT_FOOTER }}
      className="nodrag nopan text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus-visible:ring-ring text-label-medium absolute right-2 bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md px-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <Plus aria-hidden="true" className="size-3.5" /> Add task
    </button>
  );
}
