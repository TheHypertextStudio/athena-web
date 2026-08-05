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
import type { TimeAnchorSuggestion } from '@docket/types';
import { Pause, Play, Stop } from '@docket/ui/icons';
import {
  Button,
  ControlGroup,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import { EditableTitle } from '@/components/editor/editable-title';

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
  /** Tracked milliseconds, ticking while running. */
  readonly elapsedMs: number;
  /** The block this session was started from, when it was started from one. */
  readonly provenance: TimeAnchorSuggestion | null;
  /** Shown under the controls when finishing was refused for want of a name. */
  readonly notice: string | null;
  /** The timer transitions. */
  readonly controls: TimerControls;
  /** Focus the name field — the response to trying to finish something unnamed. */
  readonly onRequestName: () => void;
  /** Ref target for {@link onRequestName}. */
  readonly nameFieldId: string;
}

/** Name the block a session came from, e.g. `From your 2–3pm block`. */
function provenanceLine(
  provenance: TimeAnchorSuggestion | null,
  unanchored: boolean,
): string | null {
  if (unanchored) return 'Not linked to a task yet';
  if (!provenance?.startsAt || !provenance.endsAt) return null;
  const from = new Date(provenance.startsAt);
  const to = new Date(provenance.endsAt);
  const time = (value: Date): string =>
    value
      .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      .replace(':00', '')
      .toLowerCase()
      .replace(' ', '');
  return `From your ${time(from)}–${time(to)} block`;
}

/** The running or paused session card. */
export default function FocusSession({
  running,
  title,
  unanchored,
  elapsedMs,
  provenance,
  notice,
  controls,
  onRequestName,
  nameFieldId,
}: FocusSessionProps): JSX.Element {
  const provenanceText = provenanceLine(provenance, unanchored);

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

      <div id={nameFieldId}>
        <EditableTitle
          value={title}
          onSave={(next) => {
            void controls.rename(next);
          }}
          canEdit
          ariaLabel="What you are working on"
          placeholder="What are you working on?"
          className="text-on-surface text-body-medium w-full"
        />
      </div>

      {provenanceText ? (
        <Text token="body-small" tone="muted" truncate>
          {provenanceText}
        </Text>
      ) : null}

      {/* One row at every rail width: the labels are hidden below the panel's `@sm` container
          breakpoint rather than allowed to wrap onto a second line. */}
      <ControlGroup controlSize="sm" className="min-w-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              aria-label={running ? 'Pause timer' : 'Resume timer'}
              data-testid={running ? 'timer-pause' : 'timer-resume'}
              disabled={controls.transitioning}
              onClick={() => {
                void (running ? controls.pause() : controls.resume());
              }}
            >
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span className="hidden @sm:inline">{running ? 'Pause' : 'Resume'}</span>
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
              onClick={() => {
                if (unanchored && title.trim().length === 0) {
                  onRequestName();
                  return;
                }
                void controls.stop(unanchored ? title.trim() : undefined);
              }}
            >
              <Stop aria-hidden="true" />
              <span className="hidden @sm:inline">Finish</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Finish</TooltipContent>
        </Tooltip>
      </ControlGroup>

      {notice ? (
        <Text token="body-small" role="status" className="text-on-surface-variant">
          {notice}
        </Text>
      ) : null}
    </div>
  );
}
