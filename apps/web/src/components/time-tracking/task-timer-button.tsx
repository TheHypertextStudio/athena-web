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
 */
import {
  Button,
  ControlGroup,
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
  const { record, running } = useTimerState();
  const controls = useTimerControls(record?.id ?? null);
  const tracking = record?.taskId === taskId;
  const active = tracking && running;

  const label = active ? 'Pause tracking' : tracking ? 'Resume tracking' : 'Track this task';

  return (
    <ControlGroup {...(controlSize ? { controlSize } : {})} className="shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={tracking ? 'secondary' : 'outline'}
            iconOnly={!withLabel}
            aria-label={label}
            aria-pressed={active}
            data-testid={`task-timer-${taskId}`}
            disabled={controls.busy}
            onClick={() => {
              if (active) {
                void controls.pause();
                return;
              }
              void controls.start({ label: title, taskId });
            }}
          >
            {active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {withLabel ? (active ? 'Tracking' : tracking ? 'Resume' : 'Track') : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </ControlGroup>
  );
}
