import type { InitiativeTimelineBar } from '@docket/types';

import { toMillis } from './format-date';

/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

/** A dated project bar: the DTO bar plus its resolved start/end epoch millis. */
export interface PlacedBar {
  readonly bar: InitiativeTimelineBar;
  readonly start: number;
  readonly end: number;
}

/** The computed time window for the axis: bounds (ms) plus the month tick marks. */
export interface TimeWindow {
  readonly min: number;
  readonly max: number;
  readonly ticks: readonly number[];
}

/**
 * Partition the project bars into dated (placeable) and unscheduled.
 *
 * A bar with a single date gets a one-day span so it still renders as a visible marker.
 */
export function placeBars(bars: readonly InitiativeTimelineBar[]): {
  placed: readonly PlacedBar[];
  unscheduled: readonly InitiativeTimelineBar[];
} {
  const placed: PlacedBar[] = [];
  const unscheduled: InitiativeTimelineBar[] = [];
  for (const bar of bars) {
    const startMs = toMillis(bar.startDate);
    const endMs = toMillis(bar.targetDate);
    const start = startMs ?? endMs;
    const end = endMs ?? startMs;
    if (start === null || end === null) {
      unscheduled.push(bar);
      continue;
    }
    placed.push({ bar, start: Math.min(start, end), end: Math.max(start, end) });
  }
  return { placed, unscheduled };
}

/** Compute the axis window from the placed bars: bounds padded to month boundaries. */
export function computeWindow(placed: readonly PlacedBar[]): TimeWindow | null {
  if (placed.length === 0) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of placed) {
    if (item.start < min) min = item.start;
    if (item.end > max) max = item.end;
  }
  const lo = new Date(min);
  const windowMin = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1);
  const hi = new Date(max);
  const windowMax = Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth() + 1, 1);
  const ticks: number[] = [];
  const cursor = new Date(windowMin);
  while (cursor.getTime() <= windowMax) {
    ticks.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return { min: windowMin, max: Math.max(windowMax, windowMin + DAY_MS), ticks };
}

/** Convert an epoch-ms value to a 0–100 percentage offset within the window. */
export function pct(value: number, window: TimeWindow): number {
  const span = window.max - window.min;
  if (span <= 0) return 0;
  return ((value - window.min) / span) * 100;
}
