import {
  timeframeAnchor,
  timeframeBounds,
  timeframeLabel,
  type DateResolution,
  type TimeframeEdge,
} from '@docket/work/planning-timeframe';

import { addMonths, CALENDAR_MAX_DAY, CALENDAR_MIN_DAY, compareIso } from './calendar-date';

/** One broad period that the planning timeframe picker can commit. */
export interface TimeframeOption {
  /** Canonical first-day or last-day anchor stored for the field. */
  readonly date: string;
  /** Linear-compatible resolution attached to the date. */
  readonly resolution: DateResolution;
  /** Zero-based fiscal month used to derive the period. */
  readonly fiscalYearStartMonth: number;
  /** Semantic label shown instead of the storage anchor. */
  readonly label: string;
}

/** Number of calendar months represented by each broad resolution. */
export function timeframeResolutionMonths(resolution: DateResolution): number {
  switch (resolution) {
    case 'month':
      return 1;
    case 'quarter':
      return 3;
    case 'halfYear':
      return 6;
    case 'year':
      return 12;
  }
}

/**
 * Build the seven broad periods around the period that contains today.
 *
 * @param today - Calendar day that defines the current period.
 * @param resolution - Size of each broad period.
 * @param fiscalYearStartMonth - Zero-based month that starts the workspace fiscal year.
 * @param edge - Whether the stored field uses the period's first or final day.
 * @param windowOffset - Additional period offset applied to the seven-result window.
 * @returns Previous two, current, and next four periods that fit the product date bounds.
 */
export function nearbyTimeframeOptions(
  today: string,
  resolution: DateResolution,
  fiscalYearStartMonth: number,
  edge: TimeframeEdge,
  windowOffset = 0,
): readonly TimeframeOption[] {
  const currentStart = timeframeBounds(today, resolution, fiscalYearStartMonth).start;
  const months = timeframeResolutionMonths(resolution);

  return Array.from({ length: 7 }, (_, index) => index - 2 + windowOffset)
    .map((periodOffset) => addMonths(currentStart, periodOffset * months))
    .map((periodDate) => {
      const date = timeframeAnchor(periodDate, resolution, fiscalYearStartMonth, edge);
      return {
        date,
        resolution,
        fiscalYearStartMonth,
        label: timeframeLabel(date, resolution, fiscalYearStartMonth),
      } satisfies TimeframeOption;
    })
    .filter(
      ({ date }) =>
        compareIso(date, CALENDAR_MIN_DAY) >= 0 && compareIso(date, CALENDAR_MAX_DAY) <= 0,
    );
}
