'use client';

/**
 * `views/task-time-cell` — a task row's Time cell: the viewer's timer beside the task's estimate.
 *
 * @remarks
 * Tracking and the estimate are both about the task's time, so they share one column rather than
 * the timer holding a column of its own. At rest the cell reads as the estimate with a timer glyph
 * in front of it, and the glyph is the start control. While the viewer tracks the task, the
 * control becomes its tonal pill with the live elapsed time and the estimate steps aside for it.
 * The control reflects only the viewer's own clock; see {@link TaskTimerButton}.
 */
import type { TaskOut } from '@docket/work/task-model';
import type { JSX } from 'react';

import { TaskTimerButton } from '@/components/time-tracking';
import { formatEstimate } from '@/lib/format-estimate';

/** Props for {@link TaskTimeCell}. */
export interface TaskTimeCellProps {
  /** The row's task. */
  readonly task: TaskOut;
}

/**
 * Render the Time cell for one task row.
 *
 * @param props - See {@link TaskTimeCellProps}.
 * @returns the timer control and, unless the task is being tracked, its estimate.
 */
export function TaskTimeCell({ task }: TaskTimeCellProps): JSX.Element {
  return (
    <span className="group/time text-on-surface-variant flex min-w-0 items-center justify-end gap-1">
      <TaskTimerButton taskId={task.id} title={task.title} controlSize="sm" withLabel={false} />
      <span className="truncate tabular-nums group-has-[[data-tracking]]/time:hidden">
        {formatEstimate(task.estimateMinutes) ?? '—'}
      </span>
    </span>
  );
}
