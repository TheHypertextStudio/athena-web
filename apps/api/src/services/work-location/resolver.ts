/**
 * Canonical expected/current work-location resolution.
 *
 * @remarks
 * This module is intentionally pure. Persistence adapters supply user-owned places, assertions,
 * short-lived observations, location-bound work blocks, and active Time Ledger context; the
 * resolver applies one precedence policy to those facts for every product surface.
 */
import type {
  ResolvedCurrentWorkLocation,
  ResolvedExpectedWorkLocation,
  WorkLocationOccurrenceException,
  WorkLocationPointOut,
  WorkLocationRangeOut,
  WorkLocationSchedule,
  WorkPlaceSummary,
} from '@docket/types';

import {
  addCalendarDays,
  compareCalendarDates,
  mondayWeekdayIndex,
} from '../../lib/recurrence/calendar-date';
import { instantAt, localDateString } from '../scheduling/zoned-time';

/** Minimal saved-place identity required by the resolver. */
export interface ResolutionPlace {
  readonly id: string;
  readonly name: string;
}

/** One explicit canonical assertion and its occurrence exceptions. */
export interface ResolutionAssertion {
  readonly id: string;
  readonly placeId: string;
  readonly schedule: WorkLocationSchedule;
  readonly exceptions: readonly WorkLocationOccurrenceException[];
  readonly revision: number;
  readonly updatedAt: Date;
  /** Stable provider account id for exact bootstrap ties; local assertions fall back to id. */
  readonly tieBreaker?: string;
}

/** One calendar item or generated work block carrying a canonical saved-place binding. */
export interface ResolutionWorkBlock {
  readonly id: string;
  readonly placeId: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** One time-bounded manual or foreground-device observation. */
export interface ResolutionObservation {
  readonly source: 'manual' | 'device';
  readonly placeId: string;
  readonly accuracyMeters: number | null;
  readonly observedAt: Date;
  readonly expiresAt: Date;
}

/** Active Time Ledger evidence whose planning context is bound to a saved place. */
export interface ResolutionTimeContext {
  readonly placeId: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
}

/** All evidence available for one user's point/range resolution. */
export interface WorkLocationResolutionState {
  readonly timezone: string;
  readonly places: readonly ResolutionPlace[];
  readonly assertions: readonly ResolutionAssertion[];
  readonly workBlocks: readonly ResolutionWorkBlock[];
  readonly observations: readonly ResolutionObservation[];
  readonly activeTimeContexts: readonly ResolutionTimeContext[];
}

interface AssertionInterval {
  readonly assertionId: string;
  readonly occurrenceDate: string;
  readonly placeId: string;
  readonly start: Date;
  readonly end: Date;
  readonly timed: boolean;
  readonly revision: number;
  readonly updatedAt: Date;
  readonly tieBreaker: string;
}

/** Convert an arbitrary place id into the safe embedded place summary returned by public DTOs. */
function placeSummary(
  state: WorkLocationResolutionState,
  placeId: string,
): WorkPlaceSummary | null {
  const place = state.places.find((candidate) => candidate.id === placeId);
  return place ? ({ id: place.id, name: place.name } as WorkPlaceSummary) : null;
}

/** Whether `at` belongs to the half-open interval `[start, end)`. */
function contains(at: Date, start: Date, end: Date): boolean {
  return start.getTime() <= at.getTime() && at.getTime() < end.getTime();
}

/** Convert one one-off schedule into its exact half-open instant interval. */
function oneOffInterval(
  schedule: Extract<WorkLocationSchedule, { type: 'one_off_all_day' | 'one_off_timed' }>,
): { start: Date; end: Date; timed: boolean } {
  if (schedule.type === 'one_off_timed') {
    return { start: new Date(schedule.startsAt), end: new Date(schedule.endsAt), timed: true };
  }
  return {
    start: instantAt(schedule.date, 0, schedule.timezone),
    end: instantAt(addCalendarDays(schedule.date, 1), 0, schedule.timezone),
    timed: false,
  };
}

/** Iterate civil dates touched by a bounded instant window in a schedule timezone. */
function datesForWindow(start: Date, end: Date, timezone: string): string[] {
  const first = addCalendarDays(localDateString(start, timezone), -1);
  const last = addCalendarDays(localDateString(end, timezone), 1);
  const dates: string[] = [];
  for (let date = first; compareCalendarDates(date, last) <= 0; date = addCalendarDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** Expand one assertion only far enough to answer the requested instant window. */
function assertionIntervals(
  assertion: ResolutionAssertion,
  windowStart: Date,
  windowEnd: Date,
): AssertionInterval[] {
  const schedule = assertion.schedule;
  if (schedule.type === 'one_off_all_day' || schedule.type === 'one_off_timed') {
    const interval = oneOffInterval(schedule);
    return interval.end > windowStart && interval.start < windowEnd
      ? [
          {
            assertionId: assertion.id,
            occurrenceDate:
              schedule.type === 'one_off_all_day'
                ? schedule.date
                : localDateString(interval.start, schedule.timezone),
            placeId: assertion.placeId,
            ...interval,
            revision: assertion.revision,
            updatedAt: assertion.updatedAt,
            tieBreaker: assertion.tieBreaker ?? assertion.id,
          },
        ]
      : [];
  }

  const intervals: AssertionInterval[] = [];
  for (const date of datesForWindow(windowStart, windowEnd, schedule.timezone)) {
    if (
      compareCalendarDates(date, schedule.effectiveFrom) < 0 ||
      (schedule.effectiveUntil !== null &&
        compareCalendarDates(date, schedule.effectiveUntil) > 0) ||
      !schedule.weekdays.includes(mondayWeekdayIndex(date))
    ) {
      continue;
    }

    const exception = assertion.exceptions.find((candidate) => candidate.date === date);
    if (exception?.action === 'cancel') continue;

    const replacement = exception?.action === 'replace' ? oneOffInterval(exception.schedule) : null;
    const interval =
      replacement ??
      (schedule.type === 'weekly_timed'
        ? {
            start: instantAt(date, schedule.startMinute, schedule.timezone),
            end: instantAt(date, schedule.endMinute, schedule.timezone),
            timed: true,
          }
        : {
            start: instantAt(date, 0, schedule.timezone),
            end: instantAt(addCalendarDays(date, 1), 0, schedule.timezone),
            timed: false,
          });
    if (interval.end <= windowStart || interval.start >= windowEnd) continue;
    intervals.push({
      assertionId: assertion.id,
      occurrenceDate: date,
      placeId: exception?.action === 'replace' ? exception.placeId : assertion.placeId,
      ...interval,
      revision: assertion.revision,
      updatedAt: assertion.updatedAt,
      tieBreaker: assertion.tieBreaker ?? assertion.id,
    });
  }
  return intervals;
}

interface ExpectedResolution extends ResolvedExpectedWorkLocation {
  readonly assertionId: string | null;
  readonly occurrenceDate: string | null;
}

/** Resolve explicit assertions, including timed/all-day and equal-scope precedence. */
function resolveAssertion(at: Date, state: WorkLocationResolutionState): ExpectedResolution | null {
  const pointEnd = new Date(at.getTime() + 1);
  const active = state.assertions
    .flatMap((assertion) => assertionIntervals(assertion, at, pointEnd))
    .filter((interval) => contains(at, interval.start, interval.end))
    .sort((left, right) => {
      if (left.timed !== right.timed) return left.timed ? -1 : 1;
      if (left.revision !== right.revision) return right.revision - left.revision;
      if (left.updatedAt.getTime() !== right.updatedAt.getTime()) {
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      }
      return left.tieBreaker.localeCompare(right.tieBreaker);
    });
  const winner = active[0];
  if (!winner) return null;
  const place = placeSummary(state, winner.placeId);
  if (!place) return null;
  return {
    place,
    source: 'assertion',
    confidence: 'declared',
    effectiveStart: winner.start.toISOString(),
    effectiveEnd: winner.end.toISOString(),
    observedAt: null,
    expiresAt: null,
    assertionId: winner.assertionId,
    occurrenceDate: winner.occurrenceDate,
  };
}

/** Resolve an active location-bound work block or a conservative gap between two such blocks. */
function resolveWorkBlock(at: Date, state: WorkLocationResolutionState): ExpectedResolution | null {
  const ordered = [...state.workBlocks].sort(
    (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
  );
  const activeBlocks = ordered.filter((block) => contains(at, block.startsAt, block.endsAt));
  const locatedActive = [...activeBlocks].reverse().find((block) => block.placeId !== null);
  if (locatedActive?.placeId) {
    const place = placeSummary(state, locatedActive.placeId);
    if (!place) return null;
    return {
      place,
      source: 'work_block',
      confidence: 'declared',
      effectiveStart: locatedActive.startsAt.toISOString(),
      effectiveEnd: locatedActive.endsAt.toISOString(),
      observedAt: null,
      expiresAt: null,
      assertionId: null,
      occurrenceDate: null,
    };
  }

  // Any active unlocated block is real intervening work and makes a location gap ambiguous.
  if (activeBlocks.length > 0) return null;
  const before = [...ordered].reverse().find((block) => block.endsAt.getTime() <= at.getTime());
  const after = ordered.find((block) => block.startsAt.getTime() > at.getTime());
  if (!before?.placeId || !after?.placeId || before.placeId !== after.placeId) return null;

  const localDate = localDateString(at, state.timezone);
  const beforeDate = localDateString(new Date(before.endsAt.getTime() - 1), state.timezone);
  const afterDate = localDateString(after.startsAt, state.timezone);
  if (beforeDate !== localDate || afterDate !== localDate) return null;

  const place = placeSummary(state, before.placeId);
  if (!place) return null;
  return {
    place,
    source: 'bridged_work_blocks',
    confidence: 'inferred',
    effectiveStart: before.endsAt.toISOString(),
    effectiveEnd: after.startsAt.toISOString(),
    observedAt: null,
    expiresAt: null,
    assertionId: null,
    occurrenceDate: null,
  };
}

/** The canonical unknown expected-location result. */
function unknownExpected(): ExpectedResolution {
  return {
    place: null,
    source: 'unknown',
    confidence: 'unknown',
    effectiveStart: null,
    effectiveEnd: null,
    observedAt: null,
    expiresAt: null,
    assertionId: null,
    occurrenceDate: null,
  };
}

/** Resolve expected location with the range-only assertion occurrence provenance retained. */
function resolveExpectedWithProvenance(
  at: Date,
  state: WorkLocationResolutionState,
): ExpectedResolution {
  return resolveAssertion(at, state) ?? resolveWorkBlock(at, state) ?? unknownExpected();
}

/** Resolve expected location at one instant using the documented domain precedence. */
export function resolveExpectedWorkLocation(
  at: Date,
  state: WorkLocationResolutionState,
): ResolvedExpectedWorkLocation {
  const {
    assertionId: _assertionId,
    occurrenceDate: _occurrenceDate,
    ...resolution
  } = resolveExpectedWithProvenance(at, state);
  return resolution;
}

/** Resolve current location from manual, device, Time Ledger, and expected evidence. */
export function resolveCurrentWorkLocation(
  at: Date,
  state: WorkLocationResolutionState,
  expected: ResolvedExpectedWorkLocation,
): ResolvedCurrentWorkLocation {
  for (const source of ['manual', 'device'] as const) {
    const observation = state.observations
      .filter(
        (candidate) =>
          candidate.source === source && contains(at, candidate.observedAt, candidate.expiresAt),
      )
      .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0];
    if (!observation) continue;
    const place = placeSummary(state, observation.placeId);
    if (!place) continue;
    return {
      place,
      source,
      confidence: source === 'manual' ? 'declared' : 'observed',
      effectiveStart: observation.observedAt.toISOString(),
      effectiveEnd: observation.expiresAt.toISOString(),
      observedAt: observation.observedAt.toISOString(),
      expiresAt: observation.expiresAt.toISOString(),
    };
  }

  const timeContext = state.activeTimeContexts
    .filter(
      (candidate) =>
        candidate.startsAt.getTime() <= at.getTime() &&
        (candidate.endsAt === null || at.getTime() < candidate.endsAt.getTime()),
    )
    .sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())[0];
  if (timeContext) {
    const place = placeSummary(state, timeContext.placeId);
    if (place) {
      return {
        place,
        source: 'time_ledger',
        confidence: 'observed',
        effectiveStart: timeContext.startsAt.toISOString(),
        effectiveEnd: timeContext.endsAt?.toISOString() ?? null,
        observedAt: null,
        expiresAt: null,
      };
    }
  }

  if (expected.place) {
    return {
      ...expected,
      source: 'inferred_from_expected',
      confidence: 'inferred',
    };
  }
  return {
    place: null,
    source: 'unknown',
    confidence: 'unknown',
    effectiveStart: null,
    effectiveEnd: null,
    observedAt: null,
    expiresAt: null,
  };
}

/** Resolve the independent current and expected answers at one instant. */
export function resolveWorkLocationPoint(input: {
  readonly at: Date;
  readonly state: WorkLocationResolutionState;
}): WorkLocationPointOut {
  const expected = resolveExpectedWorkLocation(input.at, input.state);
  return {
    at: input.at.toISOString(),
    expected,
    current: resolveCurrentWorkLocation(input.at, input.state, expected),
  };
}

/** Equality used to coalesce adjacent range fragments without hiding a provenance change. */
function sameResolution(
  left: WorkLocationRangeOut['segments'][number],
  right: ExpectedResolution,
): boolean {
  return (
    left.place?.id === right.place?.id &&
    left.source === right.source &&
    left.confidence === right.confidence &&
    left.observedAt === right.observedAt &&
    left.expiresAt === right.expiresAt &&
    left.assertionId === right.assertionId &&
    left.occurrenceDate === right.occurrenceDate
  );
}

/** Resolve a fully covered, ordered, non-overlapping expected-location range. */
export function resolveExpectedWorkLocationRange(input: {
  readonly start: Date;
  readonly end: Date;
  readonly state: WorkLocationResolutionState;
}): WorkLocationRangeOut {
  if (input.end.getTime() <= input.start.getTime()) {
    throw new RangeError('Work-location range must end after it starts');
  }

  const boundaries = new Set<number>([input.start.getTime(), input.end.getTime()]);
  for (const assertion of input.state.assertions) {
    for (const interval of assertionIntervals(assertion, input.start, input.end)) {
      boundaries.add(Math.max(interval.start.getTime(), input.start.getTime()));
      boundaries.add(Math.min(interval.end.getTime(), input.end.getTime()));
    }
  }
  for (const block of input.state.workBlocks) {
    if (block.endsAt > input.start && block.startsAt < input.end) {
      boundaries.add(Math.max(block.startsAt.getTime(), input.start.getTime()));
      boundaries.add(Math.min(block.endsAt.getTime(), input.end.getTime()));
    }
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const segments: WorkLocationRangeOut['segments'] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const startMs = ordered[index];
    const endMs = ordered[index + 1];
    if (startMs === undefined || endMs === undefined || endMs <= startMs) continue;
    const resolution = resolveExpectedWithProvenance(new Date(startMs), input.state);
    const previous = segments.at(-1);
    if (
      previous?.effectiveEnd === new Date(startMs).toISOString() &&
      sameResolution(previous, resolution)
    ) {
      previous.effectiveEnd = new Date(endMs).toISOString();
      continue;
    }
    segments.push({
      ...resolution,
      assertionId:
        resolution.assertionId as WorkLocationRangeOut['segments'][number]['assertionId'],
      occurrenceDate: resolution.occurrenceDate,
      effectiveStart: new Date(startMs).toISOString(),
      effectiveEnd: new Date(endMs).toISOString(),
    });
  }
  return { start: input.start.toISOString(), end: input.end.toISOString(), segments };
}
