/** Pure calendar-day cycle schedule math shared by API and web previews. */

const DAY_MS = 86_400_000;
const LEGACY_ANCHOR = '2024-01-01';
const NATIVE_NUMBER_OFFSET = 20_000_000;

/** How many windows a single materialization request may contain. */
export const MAX_CYCLE_WINDOWS_PER_REQUEST = 400;
/** Compatibility window retained for the current-cycle endpoint. */
export const WINDOW_PAST = 4;
/** Compatibility window retained for the current-cycle endpoint. */
export const WINDOW_FUTURE = 4;

/** A team's native cycle schedule. */
export interface CycleSchedule {
  /** Calendar date on which cycle index zero begins. */
  readonly anchorDate: string;
  /** Number of calendar days in each cycle. */
  readonly cadenceDays: number;
}

/** One native cycle window derived from a schedule. */
export interface CycleWindowSlot {
  /** Stable compatibility number derived from the start calendar date. */
  readonly number: number;
  /** Inclusive start calendar date. */
  readonly startDate: string;
  /** Inclusive end calendar date. */
  readonly endDate: string;
  /** Inclusive UTC start timestamp. */
  readonly startsAt: Date;
  /** Inclusive UTC end timestamp. */
  readonly endsAt: Date;
}

/** Raised when one request would materialize too many cycle rows. */
export class CycleRangeLimitError extends Error {
  /** Create the bounded-range error. */
  constructor() {
    super(`A cycle request may contain at most ${String(MAX_CYCLE_WINDOWS_PER_REQUEST)} windows.`);
    this.name = 'CycleRangeLimitError';
  }
}

/** Normalize persisted cadence input to the supported 1–365 day range. */
export function normalizeCadenceDays(days: number): number {
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : 7;
}

/** Compatibility normalization for callers removed by the through-date API slice. */
export function normalizeCadenceWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return 1;
  const value = Math.floor(weeks);
  return value >= 1 ? value : 1;
}

function dateAtUtc(date: string): Date {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Invalid calendar date: ${date}`);
  }
  return parsed;
}

function dateOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function scheduleIndex(schedule: CycleSchedule, date: string): number {
  const cadence = normalizeCadenceDays(schedule.cadenceDays);
  return Math.floor(
    (dateAtUtc(date).getTime() - dateAtUtc(schedule.anchorDate).getTime()) / DAY_MS / cadence,
  );
}

function slotAt(schedule: CycleSchedule, index: number): CycleWindowSlot {
  const cadence = normalizeCadenceDays(schedule.cadenceDays);
  const startMs = dateAtUtc(schedule.anchorDate).getTime() + index * cadence * DAY_MS;
  const nextStartMs = startMs + cadence * DAY_MS;
  return {
    number: NATIVE_NUMBER_OFFSET + Math.floor(startMs / DAY_MS),
    startDate: dateOf(startMs),
    endDate: dateOf(nextStartMs - DAY_MS),
    startsAt: new Date(startMs),
    endsAt: new Date(nextStartMs - 1),
  };
}

/** Return the anchored cycle window containing a calendar date. */
export function cycleWindowContaining(schedule: CycleSchedule, date: string): CycleWindowSlot {
  return slotAt(schedule, scheduleIndex(schedule, date));
}

/**
 * Return every schedule window intersecting an inclusive date range.
 *
 * @param schedule - Team cadence and anchor.
 * @param throughDate - Inclusive target date.
 * @param fromDate - Inclusive range start; defaults to the anchor.
 * @throws {CycleRangeLimitError} When the range contains more than 400 windows.
 */
export function cycleWindowsThrough(
  schedule: CycleSchedule,
  throughDate: string,
  fromDate = schedule.anchorDate,
): CycleWindowSlot[] {
  const first = scheduleIndex(schedule, fromDate);
  const last = scheduleIndex(schedule, throughDate);
  if (last < first) return [];
  const count = last - first + 1;
  if (count > MAX_CYCLE_WINDOWS_PER_REQUEST) throw new CycleRangeLimitError();
  return Array.from({ length: count }, (_, offset) => slotAt(schedule, first + offset));
}

/** Compatibility rolling window while route callers migrate to explicit date ranges. */
export function rollingWindow(now: Date, cadenceWeeks: number): CycleWindowSlot[] {
  const schedule = {
    anchorDate: LEGACY_ANCHOR,
    cadenceDays: normalizeCadenceWeeks(cadenceWeeks) * 7,
  };
  const center = scheduleIndex(schedule, now.toISOString().slice(0, 10));
  return Array.from({ length: WINDOW_PAST + 1 + WINDOW_FUTURE }, (_, offset) =>
    slotAt(schedule, center - WINDOW_PAST + offset),
  );
}

/** Whether an instant falls inside an inclusive timestamp window. */
export function isWithinWindow(now: Date, startsAt: Date, endsAt: Date): boolean {
  const timestamp = now.getTime();
  return timestamp >= startsAt.getTime() && timestamp <= endsAt.getTime();
}
