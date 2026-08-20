import {
  isCanonicalTimeframeAnchor,
  type DateResolution,
  type TimeframeEdge,
} from '@docket/work/planning-timeframe';

import { ValidationError } from '../error';

/** One date/resolution pair supplied by a planning-date mutation. */
export interface PlanningDateInput {
  /** The exact or canonical broad-period anchor. */
  readonly date?: string | null | undefined;
  /** The broad resolution, or null/omitted for an exact day. */
  readonly resolution?: DateResolution | null | undefined;
}

/** The three database values that define one saved planning date. */
export interface PlanningDatePatch {
  /** The normalized UTC-midnight date, or null when cleared. */
  readonly date: Date | null;
  /** The broad resolution, or null for an exact day. */
  readonly resolution: DateResolution | null;
  /** The saved fiscal basis for a broad period, or null for an exact day. */
  readonly fiscalYearStartMonth: number | null;
}

function invalidField(field: string): ValidationError {
  return new ValidationError([{ message: 'Invalid planning timeframe', path: [field] }]);
}

/**
 * Validate and normalize an atomic planning-date mutation.
 *
 * @param input - The date and optional broad resolution from the request.
 * @param fiscalYearStartMonth - The workspace fiscal basis to snapshot for broad values.
 * @param edge - The boundary this field stores.
 * @param dateField - The public date field name used for validation errors.
 * @param resolutionField - The public resolution field name used for validation errors.
 * @returns The database patch, or undefined when the request supplied neither field.
 * @throws {ValidationError} When the pair is incomplete or a broad anchor is not canonical.
 */
export function planningDatePatch(
  input: PlanningDateInput,
  fiscalYearStartMonth: number,
  edge: TimeframeEdge,
  dateField: string,
  resolutionField: string,
): PlanningDatePatch | undefined {
  if (input.date === undefined) {
    if (input.resolution !== undefined) throw invalidField(resolutionField);
    return undefined;
  }

  if (input.date === null) {
    if (input.resolution !== undefined && input.resolution !== null) {
      throw invalidField(resolutionField);
    }
    return { date: null, resolution: null, fiscalYearStartMonth: null };
  }

  const resolution = input.resolution ?? null;
  if (resolution === null) {
    return {
      date: new Date(`${input.date}T00:00:00.000Z`),
      resolution: null,
      fiscalYearStartMonth: null,
    };
  }

  if (!isCanonicalTimeframeAnchor({ date: input.date, resolution, fiscalYearStartMonth }, edge)) {
    throw invalidField(dateField);
  }

  return {
    date: new Date(`${input.date}T00:00:00.000Z`),
    resolution,
    fiscalYearStartMonth,
  };
}

/**
 * Reject a closed Project range whose target precedes its start.
 *
 * @param startDate - The effective Project start, or null when open.
 * @param targetDate - The effective Project target, or null when open.
 * @throws {ValidationError} When both dates exist and the target is earlier.
 */
export function assertPlanningDateRange(startDate: Date | null, targetDate: Date | null): void {
  if (startDate !== null && targetDate !== null && targetDate.getTime() < startDate.getTime()) {
    throw invalidField('targetDate');
  }
}
