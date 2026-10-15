/** Finish-aware defaults for a new timed daily-planning block. */
import { nextAvailableStart, type BusyInterval } from './daily-planning-model';

/** A non-overlapping block that fits before the person's finish time. */
export interface NewSessionSlot {
  readonly startsAt: string;
  readonly minutes: number;
}

/** Prefer a full quarter-hour placement, then offer the earliest shorter free interval. */
export function newSessionSlot(
  earliestAt: string,
  finishAt: string,
  requestedMinutes: number,
  busy: readonly BusyInterval[],
): NewSessionSlot | null {
  const finish = Date.parse(finishAt);
  let cursor = Date.parse(earliestAt);
  const minutes = Math.min(requestedMinutes, Math.floor((finish - cursor) / 60_000));
  if (minutes < 1) return null;
  const start = nextAvailableStart(earliestAt, minutes, finishAt, busy);
  if (start) return { startsAt: start, minutes };
  const occupied = busy
    .filter((interval) => interval.blocksTime !== false)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  for (const interval of occupied) {
    const gap = Math.min(finish, Date.parse(interval.startsAt)) - cursor;
    if (gap >= 60_000)
      return {
        startsAt: new Date(cursor).toISOString(),
        minutes: Math.min(minutes, Math.floor(gap / 60_000)),
      };
    cursor = Math.max(cursor, Date.parse(interval.endsAt));
  }
  const remaining = Math.min(minutes, Math.floor((finish - cursor) / 60_000));
  return remaining > 0 ? { startsAt: new Date(cursor).toISOString(), minutes: remaining } : null;
}
