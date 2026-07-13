import { Temporal } from '@js-temporal/polyfill';

import { MINUTES_PER_DAY } from './scheduling-geometry';

/** How Temporal resolves a skipped or repeated wall-clock position. */
export type ScheduleTimeDisambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

/** One selectable occurrence of a repeated wall-clock time. */
export interface ScheduleWallTimeCandidate {
  readonly occurrence: 'earlier' | 'later';
  readonly instant: string;
  readonly offset: string;
  readonly zoneLabel: string;
}

/** Exact meaning of one requested wall-clock position in a timezone. */
export type ScheduleWallTimeResolution =
  | { readonly kind: 'normal'; readonly instant: string }
  | { readonly kind: 'skipped' }
  | {
      readonly kind: 'repeated';
      readonly candidates: readonly [ScheduleWallTimeCandidate, ScheduleWallTimeCandidate];
    };

/** A wall target resolved without silently choosing one repeated occurrence. */
export type ScheduleWallInstantResolution =
  | { readonly kind: 'resolved'; readonly instant: string }
  | { readonly kind: 'skipped' | 'repeated' | 'invalid' };

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

/** Resolve a preferred IANA timezone, falling back to the viewer runtime and then UTC. */
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

/** Convert an exact ISO instant to one canvas-zone wall-clock position. */
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

/** Measure signed physical duration between two exact ISO instants. */
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

/** Resolve one wall-clock position under an explicit Temporal ambiguity policy. */
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

/** Return a compact zone name for one candidate, falling back to its numeric offset. */
function candidateZoneLabel(candidate: Temporal.ZonedDateTime, timezone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
        .formatToParts(new Date(candidate.epochMilliseconds))
        .find((part) => part.type === 'timeZoneName')?.value ?? candidate.offset
    );
  } catch {
    return candidate.offset;
  }
}

/** Build one exact, labeled occurrence of a repeated wall-clock position. */
function repeatedCandidate(
  occurrence: ScheduleWallTimeCandidate['occurrence'],
  candidate: Temporal.ZonedDateTime,
  timezone: string,
): ScheduleWallTimeCandidate {
  return {
    occurrence,
    instant: candidate.toInstant().toString(),
    offset: candidate.offset,
    zoneLabel: candidateZoneLabel(candidate, timezone),
  };
}

/**
 * Resolve a wall-clock position without collapsing a skipped time and a repeated time together.
 *
 * @remarks
 * Exact instants remain canonical. Repeated times expose explicit Earlier/Later candidates with
 * their numeric offsets and compact zone labels; skipped times expose no candidate.
 */
export function resolveScheduleWallTime(
  date: string,
  wallMinutes: number,
  timezone: string,
): ScheduleWallTimeResolution | null {
  try {
    const plainDate = Temporal.PlainDate.from(date);
    const requested = plainDateTimeAt(plainDate, wallMinutes);
    if (!requested) return null;
    const zone = resolveScheduleTimezone(timezone);
    const exact = zonedDateTimeAt(plainDate, wallMinutes, zone, 'reject');
    if (exact) return { kind: 'normal', instant: exact.toInstant().toString() };

    const earlier = zonedDateTimeAt(plainDate, wallMinutes, zone, 'earlier');
    const later = zonedDateTimeAt(plainDate, wallMinutes, zone, 'later');
    if (
      !earlier ||
      !later ||
      !earlier.toPlainDateTime().equals(requested) ||
      !later.toPlainDateTime().equals(requested) ||
      earlier.toInstant().equals(later.toInstant())
    ) {
      return { kind: 'skipped' };
    }
    return {
      kind: 'repeated',
      candidates: [
        repeatedCandidate('earlier', earlier, zone),
        repeatedCandidate('later', later, zone),
      ],
    };
  } catch {
    return null;
  }
}

/** Identify the occurrence owned by an exact instant only when its source wall time repeats. */
function repeatedOccurrenceForInstant(
  instant: string,
  timezone: string,
): ScheduleWallTimeCandidate['occurrence'] | null {
  const position = scheduleWallPositionForInstant(instant, timezone);
  if (!position) return null;
  const resolution = resolveScheduleWallTime(position.date, position.wallMinutes, timezone);
  if (resolution?.kind !== 'repeated') return null;
  try {
    const offset = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone).offset;
    return (
      resolution.candidates.find((candidate) => candidate.offset === offset)?.occurrence ?? null
    );
  } catch {
    return null;
  }
}

/** Normalize an extended lane minute onto its actual local date and in-day wall minute. */
function normalizedWallTarget(
  date: string,
  wallMinutes: number,
): { readonly date: string; readonly wallMinutes: number } | null {
  if (!Number.isSafeInteger(wallMinutes)) return null;
  try {
    const dayOffset = Math.floor(wallMinutes / MINUTES_PER_DAY);
    return {
      date: Temporal.PlainDate.from(date).add({ days: dayOffset }).toString(),
      wallMinutes: wallMinutes - dayOffset * MINUTES_PER_DAY,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve one wall target while requiring an occurrence for repeated times.
 *
 * @remarks
 * An exact source instant may carry its earlier/later occurrence to another repeated target only
 * when the source itself occupies a repeated wall time. An ordinary source with a coincidentally
 * matching UTC offset is not an occurrence choice.
 */
export function resolveScheduleWallInstant(
  date: string,
  wallMinutes: number,
  timezone: string,
  occurrenceSourceInstant?: string,
): ScheduleWallInstantResolution {
  const zone = resolveScheduleTimezone(timezone);
  const target = normalizedWallTarget(date, wallMinutes);
  if (!target) return { kind: 'invalid' };
  const resolution = resolveScheduleWallTime(target.date, target.wallMinutes, zone);
  if (!resolution) return { kind: 'invalid' };
  if (resolution.kind === 'normal') return { kind: 'resolved', instant: resolution.instant };
  if (resolution.kind === 'skipped') return resolution;
  const occurrence = occurrenceSourceInstant
    ? repeatedOccurrenceForInstant(occurrenceSourceInstant, zone)
    : null;
  if (!occurrence) return { kind: 'repeated' };
  const candidate = resolution.candidates.find((value) => value.occurrence === occurrence);
  return candidate ? { kind: 'resolved', instant: candidate.instant } : { kind: 'repeated' };
}

/** Convert a lane wall-clock position to an exact instant under an explicit ambiguity policy. */
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
