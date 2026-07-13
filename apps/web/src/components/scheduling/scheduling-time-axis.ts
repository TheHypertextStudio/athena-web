import { Temporal } from '@js-temporal/polyfill';

import { deriveSnapMinutes, MINUTES_PER_DAY } from './scheduling-geometry';

const MINIMUM_MAJOR_TICK_SEPARATION = 44;
const MAJOR_TICK_INTERVALS = [15, 30, 60, 120] as const;

/** How Temporal resolves a skipped or repeated wall-clock position. */
export type ScheduleTimeDisambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

/** One wall-clock line emitted for the scheduling grid. */
export interface ScheduleTick {
  /** Minute offset from the lane's local midnight. */
  readonly wallMinutes: number;
  /** Locale-aware wall-clock label. */
  readonly label: string;
  /** Whether the line is eligible for a visible time label. */
  readonly kind: 'major' | 'minor';
  /** Daylight-saving transition state at this wall-clock position. */
  readonly transition: 'normal' | 'skipped' | 'repeated';
}

/** Inputs for {@link deriveScheduleTicks}. */
export interface DeriveScheduleTicksOptions {
  /** Bare ISO date represented by the scheduling lane. */
  readonly date: string;
  /** IANA timezone shared by the scheduling canvas. */
  readonly timezone: string;
  /** Current continuous vertical zoom in physical pixels per hour. */
  readonly pixelsPerHour: number;
  /** Optional locale override used by deterministic consumers and tests. */
  readonly locale?: string;
}

/** Exact instant boundaries for a sequence of local scheduling dates. */
export interface ScheduleDateRange {
  /** Inclusive ISO instant at the first date's local midnight. */
  readonly startISO: string;
  /** Exclusive ISO instant at the local midnight after the last date. */
  readonly endISO: string;
}

/** Return whether a string names a timezone supported by the current runtime. */
function isSupportedTimezone(timezone: string | undefined): timezone is string {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a preferred IANA timezone, falling back to the viewer runtime and then UTC.
 *
 * @param preferred - Consumer-selected timezone when available.
 * @returns A timezone accepted by both native `Intl` and Temporal.
 */
export function resolveScheduleTimezone(preferred?: string): string {
  if (isSupportedTimezone(preferred)) return preferred;

  let viewerTimezone: string | undefined;
  try {
    viewerTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    viewerTimezone = undefined;
  }
  return isSupportedTimezone(viewerTimezone) ? viewerTimezone : 'UTC';
}

/**
 * Convert an exact ISO instant to one canvas-zone wall-clock position.
 *
 * @param instant - Exact ISO instant to place on the wall-clock axis.
 * @param timezone - Required IANA timezone shared by the canvas.
 * @returns The bare local date and minute offset from local midnight, or `null` for invalid input.
 */
export function scheduleWallPositionForInstant(
  instant: string,
  timezone: string,
): { readonly date: string; readonly wallMinutes: number } | null {
  try {
    const zonedDateTime = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
    return {
      date: zonedDateTime.toPlainDate().toString(),
      wallMinutes: zonedDateTime.hour * 60 + zonedDateTime.minute,
    };
  } catch {
    return null;
  }
}

/**
 * Measure signed physical duration between two exact ISO instants.
 *
 * @param startInstant - Inclusive exact start instant.
 * @param endInstant - Exclusive exact end instant.
 * @returns Elapsed minutes, or `null` when either instant is invalid.
 */
export function scheduleElapsedMinutes(startInstant: string, endInstant: string): number | null {
  try {
    const start = Temporal.Instant.from(startInstant);
    const end = Temporal.Instant.from(endInstant);
    return Number(end.epochNanoseconds - start.epochNanoseconds) / 60_000_000_000;
  } catch {
    return null;
  }
}

/** Return one plain date-time at a bounded minute offset from local midnight. */
function plainDateTimeAt(
  date: Temporal.PlainDate,
  wallMinutes: number,
): Temporal.PlainDateTime | null {
  if (!Number.isInteger(wallMinutes) || wallMinutes < 0 || wallMinutes > MINUTES_PER_DAY) {
    return null;
  }
  return date.toPlainDateTime().add({ minutes: wallMinutes });
}

/** Resolve one wall-clock position to a zoned value under an explicit ambiguity policy. */
function zonedDateTimeAt(
  date: Temporal.PlainDate,
  wallMinutes: number,
  timezone: string,
  disambiguation: ScheduleTimeDisambiguation,
): Temporal.ZonedDateTime | null {
  const plainDateTime = plainDateTimeAt(date, wallMinutes);
  if (!plainDateTime) return null;

  try {
    return Temporal.ZonedDateTime.from(
      {
        year: plainDateTime.year,
        month: plainDateTime.month,
        day: plainDateTime.day,
        hour: plainDateTime.hour,
        minute: plainDateTime.minute,
        timeZone: timezone,
      },
      { disambiguation },
    );
  } catch {
    return null;
  }
}

/**
 * Convert a lane wall-clock position to an exact ISO instant.
 *
 * @param date - Bare ISO date represented by the lane.
 * @param wallMinutes - Whole minute offset from local midnight, including `1440` for the next day.
 * @param timezone - IANA timezone shared by the scheduling canvas.
 * @param disambiguation - Temporal policy for skipped or repeated local times.
 * @returns An ISO instant, or `null` when the input or requested resolution is invalid.
 */
export function scheduleInstantAt(
  date: string,
  wallMinutes: number,
  timezone: string,
  disambiguation: ScheduleTimeDisambiguation = 'compatible',
): string | null {
  try {
    const plainDate = Temporal.PlainDate.from(date);
    return (
      zonedDateTimeAt(plainDate, wallMinutes, resolveScheduleTimezone(timezone), disambiguation)
        ?.toInstant()
        .toString() ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Derive exact query boundaries from consecutive local midnights.
 *
 * @param startDate - Bare ISO date of the first lane.
 * @param laneCount - Number of consecutive local dates in the range.
 * @param timezone - IANA timezone shared by the scheduling canvas.
 * @returns Inclusive start and exclusive end instants for the requested local dates.
 */
export function scheduleDateRange(
  startDate: string,
  laneCount: number,
  timezone: string,
): ScheduleDateRange {
  const date = Temporal.PlainDate.from(startDate);
  const zone = resolveScheduleTimezone(timezone);
  const count = Math.max(0, Math.floor(laneCount));
  const start = date.toZonedDateTime(zone).startOfDay();
  const end = date.add({ days: count }).toZonedDateTime(zone).startOfDay();
  return {
    startISO: start.toInstant().toString(),
    endISO: end.toInstant().toString(),
  };
}

/**
 * Select the smallest supported label interval that preserves 44 physical pixels.
 *
 * @param pixelsPerHour - Current continuous vertical zoom.
 * @returns A 15, 30, 60, or 120-minute interval.
 */
export function majorTickInterval(pixelsPerHour: number): number {
  const safePixelsPerHour = Math.max(1, pixelsPerHour);
  return (
    MAJOR_TICK_INTERVALS.find(
      (minutes) => (minutes / 60) * safePixelsPerHour >= MINIMUM_MAJOR_TICK_SEPARATION,
    ) ?? 120
  );
}

/** Classify a wall-clock position by round-tripping its earlier and later resolutions. */
function scheduleTickTransition(
  date: Temporal.PlainDate,
  wallMinutes: number,
  timezone: string,
): ScheduleTick['transition'] {
  if (zonedDateTimeAt(date, wallMinutes, timezone, 'reject')) return 'normal';

  const plainDateTime = plainDateTimeAt(date, wallMinutes);
  const earlier = zonedDateTimeAt(date, wallMinutes, timezone, 'earlier');
  const later = zonedDateTimeAt(date, wallMinutes, timezone, 'later');
  if (!plainDateTime || !earlier || !later) return 'skipped';

  return earlier.toPlainDateTime().equals(plainDateTime) &&
    later.toPlainDateTime().equals(plainDateTime)
    ? 'repeated'
    : 'skipped';
}

/** Format a requested wall time that has no corresponding instant. */
function formatSkippedWallTime(
  formatter: Intl.DateTimeFormat,
  plainDateTime: Temporal.PlainDateTime,
): string {
  return formatter.format(
    new Date(
      Date.UTC(
        plainDateTime.year,
        plainDateTime.month - 1,
        plainDateTime.day,
        plainDateTime.hour,
        plainDateTime.minute,
      ),
    ),
  );
}

/**
 * Emit locale-aware major and minor wall-clock ticks for one scheduling date.
 *
 * Every active snap interval is represented. Missing and ambiguous local times remain at their
 * familiar wall position and are annotated instead of stretching or collapsing the 24-hour grid.
 */
export function deriveScheduleTicks({
  date,
  timezone,
  pixelsPerHour,
  locale,
}: DeriveScheduleTicksOptions): ScheduleTick[] {
  const plainDate = Temporal.PlainDate.from(date);
  const zone = resolveScheduleTimezone(timezone);
  const snapMinutes = deriveSnapMinutes(pixelsPerHour);
  const majorMinutes = majorTickInterval(pixelsPerHour);
  const zonedFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const skippedFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  });
  const ticks: ScheduleTick[] = [];

  for (let wallMinutes = 0; wallMinutes <= MINUTES_PER_DAY; wallMinutes += snapMinutes) {
    const transition = scheduleTickTransition(plainDate, wallMinutes, zone);
    const plainDateTime = plainDateTimeAt(plainDate, wallMinutes);
    if (!plainDateTime) continue;
    const zonedDateTime = zonedDateTimeAt(plainDate, wallMinutes, zone, 'earlier');
    const label =
      transition === 'skipped' || !zonedDateTime
        ? formatSkippedWallTime(skippedFormatter, plainDateTime)
        : zonedFormatter.format(new Date(zonedDateTime.epochMilliseconds));

    ticks.push({
      wallMinutes,
      label,
      kind: wallMinutes % majorMinutes === 0 ? 'major' : 'minor',
      transition,
    });
  }

  return ticks;
}
