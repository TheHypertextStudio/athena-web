'use client';

/**
 * `time-tracking/focus-session` — the running (or paused) session, as the Focus panel shows it.
 *
 * @remarks
 * One card that persists across running and paused rather than two that swap: the clock, the name
 * and the provenance line stay in place and only their contents change, so pausing reads as the
 * same session being held rather than as a different screen arriving.
 *
 * The name is edited **in place**. That is the whole point of the rework — a person names the work
 * while doing it, in the surface already in front of them, instead of being stopped by a dialog
 * before the clock will run at all. Naming an unanchored session is what creates its ordinary
 * Docket task, so the field is the same control whether it is anchoring or renaming.
 */
import { CircleStop, Edit, Ellipsis, OpenInNew, Pause, Play } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useEffect, useRef, useState } from 'react';

import { formatClock, spokenDuration } from './format-duration';
import type { TimerControls } from './use-timer';

/** Props for {@link FocusSession}. */
export interface FocusSessionProps {
  /** Whether a segment is currently open. */
  readonly running: boolean;
  /** The person's own words for this session; empty while it has none. */
  readonly title: string;
  /** True while the session has no task attached yet. */
  readonly unanchored: boolean;
  /** Owning workspace for an anchored session. */
  readonly organizationId: string | null;
  /** Anchored task id, or null while naming creates one. */
  readonly taskId: string | null;
  /** Tracked milliseconds, ticking while running. */
  readonly elapsedMs: number;
  /** Whether this session was started from a block on the caller's own calendar. */
  readonly fromPlan: boolean;
  /** Shown under the controls when finishing was refused for want of a name. */
  readonly notice: string | null;
  /** Replace the application-owned status beneath the timer controls. */
  readonly onNotice: (notice: string | null) => void;
  /** The timer transitions. */
  readonly controls: TimerControls;
  /** Focus the name field — the response to trying to finish something unnamed. */
  readonly onRequestName: () => void;
  /** Ref target for {@link onRequestName}. */
  readonly nameFieldId: string;
  /** Use full touch targets when the shared card is rendered in immersive mode. */
  readonly comfortable?: boolean;
}

/**
 * Say where this session came from, when there is something to say.
 *
 * @remarks
 * Read from the record's own `planning_context` rather than from the live suggestion. The
 * suggestion answers "what should I be on *now*", so it is deliberately absent once an anchored
 * session is running — asking it where a session that started an hour ago came from would get
 * either silence or, worse, whatever block happens to cover the present minute instead.
 */
function provenanceLine(fromPlan: boolean, unanchored: boolean): string | null {
  if (unanchored) return 'Not linked to a task yet';
  return fromPlan ? 'Started from your calendar' : null;
}

/** The running or paused session card. */
export default function FocusSession({
  running,
  title,
  unanchored,
  organizationId,
  taskId,
  elapsedMs,
  fromPlan,
  notice,
  onNotice,
  controls,
  onRequestName,
  nameFieldId,
  comfortable = false,
}: FocusSessionProps): JSX.Element {
  const provenanceText = provenanceLine(fromPlan, unanchored);
  const [editing, setEditing] = useState(false);
  const [renameDraft, setRenameDraft] = useState(title);
  const renameInFlight = useRef(false);
  const taskHref = organizationId && taskId ? `/orgs/${organizationId}/tasks/${taskId}` : null;

  useEffect(() => {
    if (!editing) setRenameDraft(title);
  }, [editing, title]);

  const renameSession = async (): Promise<void> => {
    if (renameInFlight.current) return;
    const next = renameDraft.trim();
    if (next.length === 0 || next === title.trim()) {
      setRenameDraft(title);
      setEditing(false);
      return;
    }
    renameInFlight.current = true;
    onNotice(null);
    try {
      await controls.rename(next);
      setEditing(false);
    } catch {
      onNotice('Could not rename the task. Try again.');
    } finally {
      renameInFlight.current = false;
    }
  };

  const updateTimer = async (operation: () => Promise<void>): Promise<void> => {
    onNotice(null);
    try {
      await operation();
    } catch {
      onNotice('Could not update the timer. Try again.');
    }
  };

  return (
    <div
      className="bg-surface-container flex flex-col gap-2 rounded-xl p-3"
      data-testid="focus-session"
      data-timer-state={running ? 'running' : 'paused'}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={
            running
              ? 'bg-state-started size-1.5 shrink-0 rounded-full'
              : 'bg-on-surface-variant size-1.5 shrink-0 rounded-full'
          }
        />
        {/* `tabular-nums` is load-bearing: a clock whose digits change width shoves the controls
            beneath it sideways once a second. */}
        <Text
          token="headline-small"
          numeric
          className="text-on-surface"
          data-testid="timer-elapsed"
          aria-label={`${spokenDuration(elapsedMs)} tracked`}
        >
          {formatClock(elapsedMs)}
        </Text>
      </div>

      <div id={nameFieldId} className="min-w-0">
        {taskHref && !editing ? (
          <Link
            href={taskHref}
            className="text-on-surface text-body-medium hover:text-primary focus-visible:outline-primary block min-h-10 w-full min-w-0 rounded-sm py-2 break-words whitespace-normal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {title}
          </Link>
        ) : (
          <input
            type="text"
            value={renameDraft}
            aria-label="What you are working on"
            placeholder="What are you working on?"
            autoFocus={taskHref !== null}
            onChange={(event) => {
              setRenameDraft(event.target.value);
            }}
            onBlur={(event) => {
              const related = event.relatedTarget as HTMLElement | null;
              if (related?.dataset['testid']?.startsWith('timer-')) return;
              void renameSession();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void renameSession();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setRenameDraft(title);
                if (taskHref) setEditing(false);
              }
            }}
            className="text-on-surface text-body-medium focus-visible:outline-primary min-h-10 w-full min-w-0 rounded-sm bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        )}
      </div>

      {provenanceText ? (
        <Text token="body-small" tone="muted" truncate>
          {provenanceText}
        </Text>
      ) : null}

      <ControlGroup controlSize={comfortable ? 'xl' : 'sm'} className="w-full min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              aria-label={running ? 'Pause timer' : 'Resume timer'}
              data-testid={running ? 'timer-pause' : 'timer-resume'}
              disabled={controls.transitioning}
              className="min-h-10 min-w-10"
              onClick={() => {
                void updateTimer(running ? controls.pause : controls.resume);
              }}
            >
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span>{running ? 'Pause' : 'Resume'}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{running ? 'Pause' : 'Resume'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Never disabled for want of a name. The gesture is always accepted; when there is
                nothing to file the time under, the name field takes focus and says so. */}
            <Button
              variant="ghost"
              aria-label="Finish tracking"
              data-testid="timer-stop"
              disabled={controls.transitioning}
              className="min-h-10 min-w-10"
              onClick={() => {
                const unanchoredTitle = renameDraft.trim();
                if (unanchored && unanchoredTitle.length === 0) {
                  onRequestName();
                  return;
                }
                void updateTimer(() => controls.stop(unanchored ? unanchoredTitle : undefined));
              }}
            >
              <CircleStop aria-hidden="true" />
              <span>Finish</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Finish</TooltipContent>
        </Tooltip>
        {taskHref && !editing ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                iconOnly
                aria-label="Task actions"
                className="ml-auto min-h-10 min-w-10"
              >
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={taskHref}>
                  <OpenInNew aria-hidden="true" />
                  Open task
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setRenameDraft(title);
                  setEditing(true);
                }}
              >
                <Edit aria-hidden="true" />
                Rename task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ControlGroup>

      {notice ? (
        <Text token="body-small" role="status" className="text-on-surface-variant">
          {notice}
        </Text>
      ) : null}
    </div>
  );
}
