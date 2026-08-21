import {
  timeframeKey,
  timeframeLabel,
  type DateResolution,
  type PlanningTimeframe,
} from '@docket/work/planning-timeframe';

import { toDay } from '@/components/date-picker';

/**
 * Reconstruct one planning value from the three fields returned by the API.
 *
 * @param date - Stored date or timestamp.
 * @param resolution - Broad resolution, or `null` for a precise day.
 * @param fiscalYearStartMonth - Saved fiscal basis for a broad value.
 * @returns A calendar-day planning value, or `null` when the date is absent or malformed.
 */
export function toPlanningTimeframe(
  date: string | null | undefined,
  resolution: DateResolution | null | undefined,
  fiscalYearStartMonth: number | null | undefined,
): PlanningTimeframe | null {
  const day = toDay(date);
  if (!day) return null;
  return {
    date: day,
    resolution: resolution ?? null,
    fiscalYearStartMonth: resolution ? (fiscalYearStartMonth ?? null) : null,
  };
}

/**
 * Format a Project or Initiative planning field without exposing its canonical date boundary.
 *
 * @param value - Reconstructed planning value.
 * @returns The semantic label, or `null` when the metadata is malformed.
 */
export function formatPlanningTimeframe(value: PlanningTimeframe | null): string | null {
  if (!value) return null;
  try {
    return timeframeLabel(value.date, value.resolution, value.fiscalYearStartMonth);
  } catch {
    return null;
  }
}

/**
 * Build the stable semantic filter and grouping key for one planning value.
 *
 * @param value - Reconstructed planning value.
 * @returns The semantic key, or `null` when the metadata is malformed.
 */
export function planningTimeframeKey(value: PlanningTimeframe | null): string | null {
  if (!value) return null;
  try {
    return timeframeKey(value.date, value.resolution, value.fiscalYearStartMonth);
  } catch {
    return null;
  }
}
