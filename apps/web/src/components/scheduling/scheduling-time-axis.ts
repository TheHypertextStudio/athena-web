import { Temporal } from '@js-temporal/polyfill';

import { deriveSnapMinutes, MINUTES_PER_DAY } from './scheduling-geometry';
import { resolveScheduleTimezone, resolveScheduleWallTime } from './scheduling-wall-time';

export {
  resolveScheduleTimezone,
  resolveScheduleWallTime,
  scheduleElapsedMinutes,
  scheduleInstantAt,
  scheduleWallPositionForInstant,
  resolveScheduleWallInstant,
} from './scheduling-wall-time';
export type {
  ScheduleTimeDisambiguation,
  ScheduleWallInstantResolution,
  ScheduleWallTimeCandidate,
  ScheduleWallTimeResolution,
} from './scheduling-wall-time';

const MINIMUM_MAJOR_TICK_SEPARATION = 44;
const MAJOR_TICK_INTERVALS = [15, 30, 60, 120] as const;

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
    const resolution = resolveScheduleWallTime(date, wallMinutes, zone);
    const transition = resolution?.kind ?? 'skipped';
    const plainDateTime = plainDate.toPlainDateTime().add({ minutes: wallMinutes });
    const instant = resolution?.kind === 'normal' ? resolution.instant : null;
    const label =
      transition !== 'normal' || !instant
        ? formatSkippedWallTime(skippedFormatter, plainDateTime)
        : zonedFormatter.format(new Date(instant));

    ticks.push({
      wallMinutes,
      label,
      kind: wallMinutes % majorMinutes === 0 ? 'major' : 'minor',
      transition,
    });
  }

  return ticks;
}
