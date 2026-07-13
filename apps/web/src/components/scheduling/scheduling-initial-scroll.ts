import { scheduleWallPositionForInstant } from './scheduling-time-axis';
import type { ScheduleLane } from './scheduling-types';

const DEFAULT_SCROLL_MINUTES = 7 * 60;
const LIVE_TIME_LEAD_MINUTES = 60;

/** Choose a useful initial time without overriding an explicit consumer target. */
export function deriveInitialScheduleScrollMinutes({
  initialScrollMinutes,
  now,
  displayTimezone,
  lanes,
}: {
  readonly initialScrollMinutes?: number;
  readonly now?: string;
  readonly displayTimezone: string;
  readonly lanes: readonly ScheduleLane[];
}): number {
  if (initialScrollMinutes !== undefined) return initialScrollMinutes;
  const current = now ? scheduleWallPositionForInstant(now, displayTimezone) : null;
  if (!current || !lanes.some((lane) => lane.date === current.date)) return DEFAULT_SCROLL_MINUTES;
  return Math.max(0, current.wallMinutes - LIVE_TIME_LEAD_MINUTES);
}
