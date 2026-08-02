'use client';

/**
 * The universal timer control that rides along on every authenticated surface.
 *
 * @remarks
 * Mounted by the app shell in two places — the sidebar footer at desktop widths and the mobile
 * top bar below `lg` — because those are the two chromes that survive every navigation. Both
 * read the one `['me','time','active']` query, so they are the same timer rather than two, and
 * navigating or reloading cannot reset it: nothing about the running state lives in this
 * component.
 *
 * The geometry is fixed on purpose. Idle and running are the same height, and the elapsed clock
 * is `tabular-nums`, so a timer ticking past 9:59 does not shove the controls beside it sideways.
 * Interaction never changes size — only colour.
 */
import {
  Button,
  ControlGroup,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import { Pause, Play, Stop } from '@docket/ui/icons';
import Link from 'next/link';
import { type JSX, useState } from 'react';

import { formatClock, spokenDuration } from './format-duration';
import { NamingDialog } from './naming-dialog';
import { useTimerControls, useTimerState } from './use-timer';

/** Props for {@link GlobalTimer}. */
export interface GlobalTimerProps {
  /**
   * The workspace a newly named task lands in.
   *
   * @remarks
   * Null means "wherever the person's personal space is", resolved by the server. Passing the
   * active workspace when there is one keeps a task started from inside a team where that team
   * can see it.
   */
  readonly organizationId?: string | null;
  /** `compact` drops the label and shows the clock alone — the mobile top bar. */
  readonly variant?: 'full' | 'compact';
}

/**
 * The persistent start / pause / resume / stop control.
 *
 * @param props - See {@link GlobalTimerProps}.
 * @returns the timer control.
 */
export function GlobalTimer({
  organizationId = null,
  variant = 'full',
}: GlobalTimerProps): JSX.Element {
  const { record, running, elapsedMs } = useTimerState();
  const controls = useTimerControls(record?.id ?? null);
  const [startOpen, setStartOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compact = variant === 'compact';

  /** Finishing requires a name; an unnamed session opens the dialog instead of ending. */
  const finish = async (): Promise<void> => {
    setError(null);
    try {
      await controls.stop();
    } catch {
      // The server refused because the work is not documented. Ask, rather than reporting a
      // failure the person cannot act on from a toast.
      setFinishOpen(true);
    }
  };

  if (!record) {
    return (
      <>
        <ControlGroup controlSize={compact ? 'xl' : 'md'} className="shrink-0">
          <Button
            variant={compact ? 'ghost' : 'secondary'}
            iconOnly={compact}
            aria-label="Start a timer"
            data-testid="timer-start"
            disabled={controls.busy}
            onClick={() => {
              setError(null);
              setStartOpen(true);
            }}
          >
            <Play aria-hidden="true" />
            {compact ? null : 'Start timer'}
          </Button>
        </ControlGroup>
        <NamingDialog
          open={startOpen}
          onOpenChange={setStartOpen}
          title="Start tracking"
          description="Name the work you are about to do. The timer records every segment against it."
          confirmLabel="Start timer"
          error={error}
          onConfirm={async (name) => {
            setError(null);
            try {
              await controls.start({
                label: name,
                ...(organizationId ? { organizationId } : {}),
              });
              setStartOpen(false);
            } catch {
              setError('Could not start the timer. Try again.');
            }
          }}
        />
      </>
    );
  }

  const clock = formatClock(elapsedMs);
  const state = running ? 'Running' : 'Paused';

  return (
    <>
      <ControlGroup
        controlSize={compact ? 'xl' : 'sm'}
        className="min-w-0"
        data-testid="timer-running"
        data-timer-state={running ? 'running' : 'paused'}
      >
        <Link
          href="/time"
          className="bg-surface-container-high text-on-surface hover:bg-surface-container-highest flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1 no-underline"
          aria-label={`${state}: ${record.title}, ${spokenDuration(elapsedMs)} tracked. Open time reports.`}
        >
          <span
            aria-hidden="true"
            className={
              running
                ? 'bg-state-started size-1.5 shrink-0 rounded-full'
                : 'bg-on-surface-variant size-1.5 shrink-0 rounded-full'
            }
          />
          <Text token="label-medium" numeric className="shrink-0" data-testid="timer-elapsed">
            {clock}
          </Text>
          {compact ? null : (
            <Text token="body-small" tone="muted" truncate className="min-w-0">
              {record.title}
            </Text>
          )}
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              iconOnly
              aria-label={running ? 'Pause timer' : 'Resume timer'}
              data-testid={running ? 'timer-pause' : 'timer-resume'}
              disabled={controls.busy}
              onClick={() => {
                void (running ? controls.pause() : controls.resume());
              }}
            >
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{running ? 'Pause' : 'Resume'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              iconOnly
              aria-label="Finish tracking"
              data-testid="timer-stop"
              disabled={controls.busy}
              onClick={() => {
                void finish();
              }}
            >
              <Stop aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Finish</TooltipContent>
        </Tooltip>
      </ControlGroup>
      <NamingDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        title="Name what you worked on"
        description="Tracking cannot finish until the work is documented. The timer keeps running until you do."
        confirmLabel="Name it and finish"
        initialName={record.title}
        error={error}
        onConfirm={async (name) => {
          setError(null);
          try {
            await controls.rename(name);
            await controls.stop();
            setFinishOpen(false);
          } catch {
            setError('Could not finish tracking. Try again.');
          }
        }}
      />
    </>
  );
}
