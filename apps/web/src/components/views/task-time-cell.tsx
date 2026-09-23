'use client';

/**
 * `views/task-time-cell` — a task row's Time cell: the viewer's timer beside the task's estimate.
 *
 * @remarks
 * Sunsama's task clock: tracking and the estimate are both about the task's time, so they share
 * one column. At rest the cell reads as the timer glyph (the start control) and the estimate
 * (`h:mm`, or "—"), and the estimate opens the time-estimate picker for a viewer who may set it.
 * While the viewer tracks the task, the timer becomes its tonal pill with the live elapsed time and
 * the estimate steps aside for it. The timer reflects only the viewer's own clock; see
 * {@link TaskTimerButton}.
 */
import type { TaskOut } from '@docket/work/task-model';
import { Button } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { TaskTimerButton } from '@/components/time-tracking';
import { formatEstimate } from '@/lib/format-estimate';

import { useOpenEstimate } from './task-row-pickers';

/**
 * A fixed, end-aligned slot wide enough for `99:59`, so every row's timer glyph sits in one column
 * whatever the estimate's width; hidden while the viewer tracks this task, so the timer's pill
 * takes its place.
 */
const ESTIMATE_CLASSNAME =
  'w-12 shrink-0 justify-end text-right tabular-nums group-has-[[data-tracking]]/time:hidden';

/** Props for {@link TaskTimeCell}. */
export interface TaskTimeCellProps {
  /** The row's task. */
  readonly task: TaskOut;
  /** Whether the estimate opens its picker; otherwise it is text. */
  readonly editable: boolean;
}

/** Props for {@link EstimateButton}. */
interface EstimateButtonProps {
  readonly task: TaskOut;
  /** The formatted estimate, or `null` when unset. */
  readonly estimate: string | null;
}

/** The estimate as a control that opens the time-estimate picker. */
function EstimateButton({ task, estimate }: EstimateButtonProps): JSX.Element {
  const openEstimate = useOpenEstimate();
  return (
    <Button
      variant="ghost"
      controlSize="sm"
      aria-haspopup="dialog"
      aria-label={`Time estimate — ${estimate ?? 'not set'}`}
      className={`text-on-surface-variant px-1.5 ${ESTIMATE_CLASSNAME}`}
      onClick={(event) => {
        // The row is a link or opens on click; this control opens the picker instead.
        event.preventDefault();
        event.stopPropagation();
        openEstimate(task, event.currentTarget);
      }}
    >
      <span className="truncate">{estimate ?? '—'}</span>
    </Button>
  );
}

/**
 * Render the Time cell for one task row.
 *
 * @param props - See {@link TaskTimeCellProps}.
 * @returns the timer control and, unless the task is being tracked, its estimate.
 */
export function TaskTimeCell({ task, editable }: TaskTimeCellProps): JSX.Element {
  const estimate = formatEstimate(task.estimateMinutes);
  return (
    <span className="group/time text-on-surface-variant flex min-w-0 items-center justify-end gap-0.5">
      <TaskTimerButton taskId={task.id} title={task.title} controlSize="sm" withLabel={false} />
      {editable ? (
        <EstimateButton task={task} estimate={estimate} />
      ) : (
        <span className={`px-1.5 ${ESTIMATE_CLASSNAME}`}>{estimate ?? '—'}</span>
      )}
    </span>
  );
}
