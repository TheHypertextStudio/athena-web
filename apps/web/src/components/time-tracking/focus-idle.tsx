'use client';

/**
 * `time-tracking/focus-idle` — nothing is tracking, so offer the one thing most likely next.
 *
 * @remarks
 * The primary control **starts the timer**. It does not open anything, ask anything, or gate
 * anything: pressing it puts the clock on the suggested task, or on nothing at all when the day
 * names nothing, and the person says what the work was afterwards. Everything else here is a
 * shortcut, not a step.
 *
 * The suggestion is shown with its reason. An unexplained guess is worse than no guess — somebody
 * cannot tell a fresh suggestion from a stale one unless the interface says where it came from —
 * and the reason is also what makes accepting it a decision rather than a reflex.
 */
import type { TimeAnchorSuggestion } from '@docket/types';
import { Play } from '@docket/ui/icons';
import { Button, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

import { formatDuration } from './format-duration';
import type { FocusPresentation } from './focus-route-frame';

/** One task the panel can put the clock on with a single click. */
export interface FocusShortcut {
  readonly taskId: string;
  readonly title: string;
  /** Time already tracked against it today, for the trailing total. */
  readonly trackedMs: number;
}

/** Props for {@link FocusIdle}. */
export interface FocusIdleProps {
  /** What the caller's own schedule says they should be on, when anything does. */
  readonly suggestion: TimeAnchorSuggestion | null;
  /** True when the suggested block began within the last few minutes. */
  readonly nudging: boolean;
  /** Other tasks worked on today, most recent first. */
  readonly shortcuts: readonly FocusShortcut[];
  /** True while a start is in flight. */
  readonly starting: boolean;
  /** Begin tracking; called with no task id for a deliberately nameless start. */
  readonly onStart: (taskId?: string) => void;
  /** The enclosing rail or page presentation chooses the control density. */
  readonly presentation?: FocusPresentation | undefined;
}

/** The one sentence each suggestion source justifies itself with. */
const REASON: Record<TimeAnchorSuggestion['source'], string> = {
  calendar_timebox: 'Scheduled now',
  daily_plan_timebox: 'Timeboxed for now',
  day_directive: 'Next in your day plan',
  recent: 'You were on this earlier',
};

/** The idle state: a suggestion when there is one, a bare start when there is not. */
export default function FocusIdle({
  suggestion,
  nudging,
  shortcuts,
  starting,
  onStart,
  presentation = 'rail',
}: FocusIdleProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {suggestion ? (
        <div
          className={
            nudging
              ? 'bg-surface-container-high flex flex-col gap-2 rounded-xl p-3'
              : 'bg-surface-container flex flex-col gap-2 rounded-xl p-3'
          }
          data-testid="focus-suggestion"
          data-nudging={nudging ? 'true' : 'false'}
        >
          <Text token="body-medium" className="text-on-surface" truncate>
            {suggestion.title}
          </Text>
          <Text token="body-small" tone="muted">
            {REASON[suggestion.source]}
          </Text>
          <Button
            variant="default"
            controlSize={presentation === 'page' ? 'xl' : 'sm'}
            className="w-full"
            data-testid="timer-start-suggested"
            disabled={starting}
            onClick={() => {
              onStart(suggestion.taskId);
            }}
          >
            <Play aria-hidden="true" />
            Start
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          controlSize={presentation === 'page' ? 'xl' : 'sm'}
          className="w-full"
          aria-label="Start a timer"
          data-testid="timer-start"
          disabled={starting}
          onClick={() => {
            onStart();
          }}
        >
          <Play aria-hidden="true" />
          Start timer
        </Button>
      )}

      {shortcuts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Text token="body-small" tone="muted">
            {suggestion ? 'Or pick up again' : 'Earlier today'}
          </Text>
          <ul className="flex flex-col gap-1">
            {shortcuts.map((shortcut) => (
              <li key={shortcut.taskId}>
                <button
                  type="button"
                  disabled={starting}
                  onClick={() => {
                    onStart(shortcut.taskId);
                  }}
                  className="bg-surface-container-low hover:bg-surface-container focus-visible:outline-primary flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="text-on-surface text-body-medium min-w-0 flex-1 truncate">
                    {shortcut.title}
                  </span>
                  <span className="text-on-surface-variant text-body-small shrink-0 tabular-nums">
                    {formatDuration(shortcut.trackedMs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
