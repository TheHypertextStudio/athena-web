'use client';

/**
 * "Track this" — the start-timer affordance wherever a task is represented.
 *
 * @remarks
 * Deliberately state-agnostic. A task in `backlog`, `done` or `blocked` can all be tracked,
 * because the timer records what a person *did*, and people routinely spend real time on work
 * that is blocked, finished-then-reopened, or not yet officially started. Gating the control on
 * workflow state would make the ledger a record of the workflow rather than of the day.
 *
 * Starting while another timer runs is not an error and asks nothing: the server switches
 * atomically and emits one `timer_switched`, so the previous stretch is closed exactly where this
 * one begins. The control simply flips to "Tracking" and the shell's timer follows.
 *
 * Every real placement of this control sits *inside* a row that is itself activatable — a table
 * row's `<Link>`, a `ListRow`'s click-to-open — so the click handler always stops the native event
 * before it can bubble. Without this the control would both start the timer AND navigate away
 * (for an anchor-wrapped row) or open the task (for a `ListRow`), on every single click.
 */
import {
  Button,
  ControlGroup,
  DropdownMenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { Pause, Play } from '@docket/ui/icons';
import type { ControlSize } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useTimerControls, useTimerState } from './use-timer';

/** Props for {@link TaskTimerButton}. */
export interface TaskTimerButtonProps {
  readonly taskId: string;
  /** The task's title, used as the session's label. */
  readonly title: string;
  /** Omit to inherit the enclosing `ControlGroup`'s step. */
  readonly controlSize?: ControlSize;
  /** Show the word beside the glyph. Dense list rows pass `false`. */
  readonly withLabel?: boolean;
}

/** Props for the task-specific timer row inside an action menu. */
export type TaskTimerMenuItemProps = Pick<TaskTimerButtonProps, 'taskId' | 'title'>;

interface TaskTimerAction {
  readonly active: boolean;
  readonly tracking: boolean;
  readonly label: string;
  readonly disabled: boolean;
  readonly run: () => Promise<void>;
}

/** Keep button and menu placements on one timer state machine. */
function useTaskTimerAction(taskId: string, title: string): TaskTimerAction {
  const { record, phase } = useTimerState();
  const controls = useTimerControls(record?.id ?? null);
  const tracking = record?.taskId === taskId;
  const active = tracking && phase === 'running';

  return {
    active,
    tracking,
    label: active ? 'Pause tracking' : tracking ? 'Resume tracking' : 'Track this task',
    disabled: controls.starting || controls.transitioning,
    run: async () => {
      if (active) {
        await controls.pause();
        return;
      }
      await controls.start({ label: title, taskId });
    },
  };
}

/**
 * Start (or pause) tracking this specific task.
 *
 * @param props - See {@link TaskTimerButtonProps}.
 * @returns the control.
 */
export function TaskTimerButton({
  taskId,
  title,
  controlSize,
  withLabel = true,
}: TaskTimerButtonProps): JSX.Element {
  const action = useTaskTimerAction(taskId, title);

  return (
    <ControlGroup {...(controlSize ? { controlSize } : {})} className="shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={action.tracking ? 'secondary' : 'outline'}
            iconOnly={!withLabel}
            aria-label={action.label}
            aria-pressed={action.active}
            data-testid={`task-timer-${taskId}`}
            // Only its own transitions disable it. A single shared `busy` meant starting a timer
            // anywhere greyed out every row's control at once.
            disabled={action.disabled}
            onClick={(event) => {
              // Every real host is an activatable row (a task-table `<Link>`, a `ListRow`'s
              // click-to-open). Stopping propagation keeps the row's own handler from also
              // firing; preventing default keeps an anchor-wrapped row from navigating away —
              // stopPropagation alone does not cancel that native default action.
              event.preventDefault();
              event.stopPropagation();
              void action.run();
            }}
          >
            {action.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {withLabel ? (action.active ? 'Tracking' : action.tracking ? 'Resume' : 'Track') : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{action.label}</TooltipContent>
      </Tooltip>
    </ControlGroup>
  );
}

/** Start, pause, or resume tracking this task from an overflow menu. */
export function TaskTimerMenuItem({ taskId, title }: TaskTimerMenuItemProps): JSX.Element {
  const action = useTaskTimerAction(taskId, title);

  return (
    <DropdownMenuItem
      disabled={action.disabled}
      onSelect={() => {
        void action.run();
      }}
    >
      {action.active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      {action.label}
    </DropdownMenuItem>
  );
}
