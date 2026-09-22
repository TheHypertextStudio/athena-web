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
 *
 * It is the viewer's own clock and nothing else. Time is per actor: an agent or another person
 * working the same task runs an independent clock, several tasks can be live at once across those
 * actors, and a person controls only the tracking they have authority over. So "tracking" here
 * means the caller's one human record is on this task; another actor's activity never lights this
 * control, and this control never pauses or resumes anyone else's clock.
 *
 * Shape follows state, MD3 Expressive style: idle it is a round icon button with a timer glyph;
 * while the viewer tracks this task it becomes a tonal, rounded-square pill carrying pause or
 * resume and the live elapsed time, and pressing it tightens its corners. Only that pill reads the
 * ticking clock ({@link TrackedElapsed}), so a list of rows re-renders once a second, not once per
 * row.
 */
import {
  Button,
  ControlGroup,
  DropdownMenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { Pause, Play, Timer } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { ControlSize } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { formatClock } from './format-duration';
import { useTimerControls, useTimerRecord, useTimerState } from './use-timer';

/** Props for {@link TaskTimerButton}. */
export interface TaskTimerButtonProps {
  readonly taskId: string;
  /** The task's title, used as the session's label. */
  readonly title: string;
  /** Omit to inherit the enclosing `ControlGroup`'s step. */
  readonly controlSize?: ControlSize;
  /** Show the word beside the glyph. Dense list rows pass `false`. */
  readonly withLabel?: boolean;
  /**
   * `quiet` (default) is a text button for rows and cards. `prominent` is the page's own primary
   * action: filled tonal at rest, filled primary while the timer runs.
   */
  readonly emphasis?: 'quiet' | 'prominent';
}

/** The button style for an emphasis and a timer state. */
function timerVariant(
  emphasis: 'quiet' | 'prominent',
  action: Pick<TaskTimerAction, 'active' | 'tracking'>,
): 'default' | 'secondary' | 'ghost' {
  if (emphasis === 'prominent') return action.active ? 'default' : 'secondary';
  return action.tracking ? 'secondary' : 'ghost';
}

/** Morph corners and tone with the emphasized curve; pressing tightens the corners. */
const TIMER_SHAPE =
  'transition-[border-radius,background-color,color] duration-(--dur-base) ease-(--ease-emphasized-decel) active:rounded-corner-sm motion-reduce:transition-none';

/** The live elapsed time of the viewer's current session; the one reader of the ticking clock. */
function TrackedElapsed(): JSX.Element {
  const { elapsedMs } = useTimerState();
  return <span className="tabular-nums">{formatClock(elapsedMs)}</span>;
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

/** Where the viewer's clock stands for one task. */
interface TimerStateProps {
  /** The viewer's clock is running on this task. */
  readonly active: boolean;
  /** The viewer's current session is on this task, running or paused. */
  readonly tracking: boolean;
}

/** Pause while running, resume while paused, and the timer glyph when this task is not tracked. */
function TimerGlyph({ active, tracking }: TimerStateProps): JSX.Element {
  if (active) return <Pause aria-hidden="true" />;
  if (tracking) return <Play aria-hidden="true" />;
  return <Timer aria-hidden="true" />;
}

/** Props for {@link TimerText}. */
interface TimerTextProps extends TimerStateProps {
  /** Whether the placement shows a word beside the glyph. */
  readonly withLabel: boolean;
}

/**
 * The text beside the glyph: a labelled placement shows its verb, and a dense row's control shows
 * the elapsed time only while this task is tracked.
 */
function TimerText({ active, tracking, withLabel }: TimerTextProps): JSX.Element | null {
  if (!withLabel) return tracking ? <TrackedElapsed /> : null;
  if (active) return <>Tracking</>;
  if (tracking) return <>Resume</>;
  return <>Track</>;
}

/**
 * The control's shape and tone: round and at the metadata tone while idle (an icon-only ghost has
 * no colour of its own and would inherit a row's title ink), and a rounded square while tracked.
 */
function timerButtonClassName(tracking: boolean, withLabel: boolean): string {
  if (tracking) return cn(TIMER_SHAPE, 'rounded-corner-md');
  return cn(TIMER_SHAPE, 'rounded-corner-full', !withLabel && 'text-on-surface-variant');
}

/** Keep button and menu placements on one timer state machine. */
function useTaskTimerAction(taskId: string, title: string): TaskTimerAction {
  const { record, phase } = useTimerRecord();
  const controls = useTimerControls(record?.id ?? null);
  const tracking = record?.taskId === taskId;
  const active = tracking && phase === 'running';

  return {
    active,
    tracking,
    label: active ? 'Pause tracking' : tracking ? 'Resume tracking' : 'Track this task',
    disabled: controls.starting || controls.transitioning,
    run: async () => {
      try {
        if (active) {
          await controls.pause();
          return;
        }
        await controls.start({ label: title, taskId });
      } catch {
        // The timer's mutation has already presented the failure as a notice.
      }
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
  emphasis = 'quiet',
}: TaskTimerButtonProps): JSX.Element {
  const action = useTaskTimerAction(taskId, title);

  return (
    <ControlGroup {...(controlSize ? { controlSize } : {})} className="shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={timerVariant(emphasis, action)}
            iconOnly={!withLabel && !action.tracking}
            className={timerButtonClassName(action.tracking, withLabel)}
            aria-label={action.label}
            aria-pressed={action.active}
            // Lets a host keep the tracked task's control visible where it hides idle ones.
            data-tracking={action.tracking ? '' : undefined}
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
            <TimerGlyph active={action.active} tracking={action.tracking} />
            <TimerText active={action.active} tracking={action.tracking} withLabel={withLabel} />
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
      <TimerGlyph active={action.active} tracking={action.tracking} />
      {action.label}
    </DropdownMenuItem>
  );
}
