import type { CycleOut } from '@docket/work/cycle-contract';
import {
  MAX_CYCLE_WINDOWS_PER_REQUEST,
  type CycleSchedule,
  cycleWindowContaining,
} from '@docket/work/cycle-schedule';

/** One bounded request to the cycle range materialization endpoint. */
export interface CycleEnsureRange {
  readonly fromDate: string;
  readonly throughDate: string;
}

/** Assignment candidates split by their meaning in the picker. */
export interface FutureCycleGroups {
  readonly retained: readonly CycleOut[];
  readonly current: readonly CycleOut[];
  readonly upcoming: readonly CycleOut[];
}

function dateAtUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const value = dateAtUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Return the last day of the calendar quarter after the one containing `date`. */
export function endOfNextQuarter(date: string): string {
  const value = dateAtUtc(date);
  const quarter = Math.floor(value.getUTCMonth() / 3);
  return new Date(Date.UTC(value.getUTCFullYear(), (quarter + 2) * 3, 0))
    .toISOString()
    .slice(0, 10);
}

/** Split an arbitrary target horizon into requests of no more than 400 schedule windows. */
export function cycleEnsureRanges(
  schedule: CycleSchedule,
  fromDate: string,
  throughDate: string,
): readonly CycleEnsureRange[] {
  if (throughDate < fromDate) return [];
  const ranges: CycleEnsureRange[] = [];
  let cursor = cycleWindowContaining(schedule, fromDate).startDate;
  while (cursor <= throughDate) {
    const lastStart = addDays(cursor, (MAX_CYCLE_WINDOWS_PER_REQUEST - 1) * schedule.cadenceDays);
    const lastEnd = addDays(lastStart, schedule.cadenceDays - 1);
    const pageThrough = lastEnd < throughDate ? lastEnd : throughDate;
    ranges.push({ fromDate: cursor, throughDate: pageThrough });
    cursor = addDays(lastEnd, 1);
  }
  return ranges;
}

/** Execute bounded ensure requests sequentially so every page starts after the previous page. */
export async function ensureCycleRanges(
  schedule: CycleSchedule,
  fromDate: string,
  throughDate: string,
  ensure: (range: CycleEnsureRange) => Promise<void>,
): Promise<void> {
  for (const range of cycleEnsureRanges(schedule, fromDate, throughDate)) await ensure(range);
}

/** Filter and order one team's assignment candidates without losing its selected completed cycle. */
export function groupFutureCycles(
  cycles: readonly CycleOut[],
  teamId: string,
  selectedCycleId: string | null,
  today: string,
): FutureCycleGroups {
  const sorted = [...cycles]
    .filter((cycle) => cycle.teamId === teamId)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  const retained = sorted.filter(
    (cycle) => cycle.id === selectedCycleId && cycle.status === 'completed',
  );
  const current = sorted.filter(
    (cycle) =>
      cycle.status !== 'completed' &&
      (cycle.isCurrent === true ||
        (cycle.startsAt.slice(0, 10) <= today && cycle.endsAt.slice(0, 10) >= today)),
  );
  const currentIds = new Set(current.map(({ id }) => id));
  const upcoming = sorted.filter(
    (cycle) =>
      cycle.status !== 'completed' &&
      !currentIds.has(cycle.id) &&
      cycle.endsAt.slice(0, 10) >= today,
  );
  return { retained, current, upcoming };
}
