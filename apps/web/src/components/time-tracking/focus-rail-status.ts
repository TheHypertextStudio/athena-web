/**
 * `time-tracking/focus-rail-status` — the timer as one dot and one sentence on the rail icon.
 *
 * @remarks
 * The Focus panel collapses to zero width, so without this the timer would disappear the moment
 * somebody collapsed the rail — which is exactly when they most need to know it is still counting.
 * The activity-bar icon is the only part of the rail that is always on screen.
 *
 * Deliberately a pure function rather than a component. The shell calls it during its own render,
 * and it must not subscribe to anything with a clock: the elapsed seconds belong in the panel, and
 * a shell that re-rendered every second would re-render the entire application every second.
 */
import type { RailPanelStatus } from '@docket/ui/components';

import type { TimerStatus } from './use-timer';

/** What a session with no name of its own is called on the rail. */
const UNNAMED = 'untitled work';

/**
 * Map the timer's coarse state onto the rail icon's status, or null when there is nothing to say.
 *
 * @remarks
 * Returns null while idle with nothing pending, so the icon stays a plain glyph. A permanent dot
 * would be decoration, and a decoration that never changes teaches people to stop looking at the
 * one place the timer reports itself.
 *
 * @param status - The tickless timer state from {@link ./use-timer.useTimerStatus}.
 * @returns the {@link RailPanelStatus} to hang on the Focus icon, or null.
 */
export function focusRailStatus(status: TimerStatus): RailPanelStatus | null {
  if (status.phase === 'running') {
    return { tone: 'active', label: `tracking ${status.title.trim() || UNNAMED}` };
  }
  if (status.phase === 'paused') {
    return { tone: 'muted', label: `paused on ${status.title.trim() || UNNAMED}` };
  }
  if (status.nudging && status.suggestion) {
    return { tone: 'attention', label: `${status.suggestion.title} is scheduled now` };
  }
  return null;
}
