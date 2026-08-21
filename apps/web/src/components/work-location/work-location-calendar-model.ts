import type {
  ExpectedWorkLocationSource,
  WorkLocationAssertionOut,
  WorkLocationRangeOut,
  WorkLocationSyncAccountOut,
  WorkPlaceOut,
} from '@docket/types';

import { scheduleInstantAt } from '@/components/scheduling';

/** One normalized location region shared by Calendar and Agenda composition. */
export interface WorkLocationCalendarRegion {
  readonly id: string;
  readonly placeId: WorkPlaceOut['id'];
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly sourceStartsAt: string;
  readonly sourceEndsAt: string;
  readonly allDay: boolean;
  readonly source: ExpectedWorkLocationSource;
  readonly editable: boolean;
  readonly assertionId: WorkLocationAssertionOut['id'] | null;
  readonly occurrenceDate: string | null;
  readonly assertionKind: 'one_off' | 'weekly' | null;
  readonly ownsStart: boolean;
  readonly ownsEnd: boolean;
}

interface TimedOccurrenceBounds {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** One application-owned provider status line shown by the shared compact status control. */
export interface WorkLocationCalendarWarning {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

/** Shared region and provider-status model used by every schedule surface. */
export interface WorkLocationCalendarModel {
  readonly regions: readonly WorkLocationCalendarRegion[];
  readonly warnings: readonly WorkLocationCalendarWarning[];
}

/** Inputs needed to normalize canonical work-location reads for a schedule. */
export interface WorkLocationCalendarModelInput {
  readonly timezone: string;
  readonly range: WorkLocationRangeOut | null;
  readonly assertions: readonly WorkLocationAssertionOut[];
  readonly places: readonly WorkPlaceOut[];
  readonly accounts: readonly WorkLocationSyncAccountOut[];
}

interface LocalDayParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

/** Read stable local date and time fields without depending on the viewer locale. */
function localDayParts(instant: string, timezone: string): LocalDayParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

/** Return whether exact bounds cover one complete civil day in the display timezone. */
export function isFullWorkLocationCivilDay(
  startsAt: string,
  endsAt: string,
  timezone: string,
): boolean {
  const start = localDayParts(startsAt, timezone);
  const end = localDayParts(endsAt, timezone);
  if (start.hour !== 0 || start.minute !== 0 || end.hour !== 0 || end.minute !== 0) return false;
  const next = new Date(Date.UTC(start.year, start.month - 1, start.day + 1));
  return (
    end.year === next.getUTCFullYear() &&
    end.month === next.getUTCMonth() + 1 &&
    end.day === next.getUTCDate()
  );
}

/** Convert one account delivery state into application-owned copy. */
function warningMessage(account: WorkLocationSyncAccountOut): string | null {
  if (account.state === 'action_required' || account.state === 'unsupported') {
    return 'Location sync needs attention.';
  }
  if (account.state === 'retrying') return 'Location sync is retrying.';
  if (account.pendingWrites > 0) return 'Location changes are syncing.';
  return null;
}

/** Add one day to an ISO civil date without applying the host timezone. */
function nextCivilDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Resolve whether one assertion occurrence is all-day and which date it occupies after overrides. */
function allDayOccurrence(
  assertion: WorkLocationAssertionOut,
  occurrenceDate: string | null,
): { readonly date: string; readonly timezone: string } | null {
  const exception = occurrenceDate
    ? assertion.exceptions.find((candidate) => candidate.date === occurrenceDate)
    : undefined;
  const schedule = exception?.action === 'replace' ? exception.schedule : assertion.schedule;
  if (schedule.type === 'one_off_all_day') {
    return { date: schedule.date, timezone: schedule.timezone };
  }
  if (schedule.type === 'weekly_all_day' && occurrenceDate) {
    return { date: occurrenceDate, timezone: schedule.timezone };
  }
  return null;
}

/** Resolve the exact timed occurrence represented by one range provenance pair. */
function timedOccurrenceBounds(
  assertion: WorkLocationAssertionOut,
  occurrenceDate: string | null,
): TimedOccurrenceBounds | null {
  const exception = occurrenceDate
    ? assertion.exceptions.find((candidate) => candidate.date === occurrenceDate)
    : undefined;
  const schedule = exception?.action === 'replace' ? exception.schedule : assertion.schedule;
  if (schedule.type === 'one_off_timed') {
    return { startsAt: schedule.startsAt, endsAt: schedule.endsAt };
  }
  if (schedule.type !== 'weekly_timed' || !occurrenceDate) return null;
  const startsAt = scheduleInstantAt(occurrenceDate, schedule.startMinute, schedule.timezone);
  const endsAt = scheduleInstantAt(occurrenceDate, schedule.endMinute, schedule.timezone);
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

/** Compare exact instants without depending on equivalent ISO string serialization. */
function sameInstant(first: string, second: string): boolean {
  return Date.parse(first) === Date.parse(second);
}

/** Build the normalized work-location regions and shared provider status for schedule composition. */
export function buildWorkLocationCalendarModel(
  input: WorkLocationCalendarModelInput,
): WorkLocationCalendarModel {
  const assertionById = new Map(input.assertions.map((assertion) => [assertion.id, assertion]));
  const placeById = new Map(input.places.map((place) => [place.id, place]));
  const regions: WorkLocationCalendarRegion[] = [];
  const allDayRegionKeys = new Set<string>();

  for (const segment of input.range?.segments ?? []) {
    if (!segment.place) continue;
    const assertion = segment.assertionId ? assertionById.get(segment.assertionId) : undefined;
    const place = placeById.get(segment.place.id);
    const editable = segment.source === 'assertion' && assertion !== undefined;
    const assertionAllDay = assertion ? allDayOccurrence(assertion, segment.occurrenceDate) : null;
    const assertionTimed = assertion
      ? timedOccurrenceBounds(assertion, segment.occurrenceDate)
      : null;
    const allDay = assertionAllDay
      ? true
      : isFullWorkLocationCivilDay(segment.effectiveStart, segment.effectiveEnd, input.timezone);
    const allDayKey = assertionAllDay
      ? `${segment.assertionId ?? segment.source}:${segment.occurrenceDate ?? assertionAllDay.date}`
      : null;
    if (allDayKey && allDayRegionKeys.has(allDayKey)) continue;
    if (allDayKey) allDayRegionKeys.add(allDayKey);
    const allDayStart = assertionAllDay
      ? scheduleInstantAt(assertionAllDay.date, 0, assertionAllDay.timezone)
      : null;
    const allDayEnd = assertionAllDay
      ? scheduleInstantAt(nextCivilDate(assertionAllDay.date), 0, assertionAllDay.timezone)
      : null;
    const sourceStartsAt = assertionTimed?.startsAt ?? allDayStart ?? segment.effectiveStart;
    const sourceEndsAt = assertionTimed?.endsAt ?? allDayEnd ?? segment.effectiveEnd;
    regions.push({
      id: `${segment.assertionId ?? segment.source}:${segment.occurrenceDate ?? 'none'}:${segment.effectiveStart}`,
      placeId: segment.place.id,
      label: place?.name ?? segment.place.name,
      startsAt: allDayStart ? new Date(allDayStart).toISOString() : segment.effectiveStart,
      endsAt: allDayEnd ? new Date(allDayEnd).toISOString() : segment.effectiveEnd,
      sourceStartsAt: new Date(sourceStartsAt).toISOString(),
      sourceEndsAt: new Date(sourceEndsAt).toISOString(),
      allDay,
      source: segment.source,
      editable,
      assertionId: editable ? segment.assertionId : null,
      occurrenceDate: editable ? segment.occurrenceDate : null,
      assertionKind: assertion
        ? assertion.schedule.type.startsWith('weekly_')
          ? 'weekly'
          : 'one_off'
        : null,
      ownsStart:
        editable && assertionTimed !== null
          ? sameInstant(segment.effectiveStart, assertionTimed.startsAt)
          : false,
      ownsEnd:
        editable && assertionTimed !== null
          ? sameInstant(segment.effectiveEnd, assertionTimed.endsAt)
          : false,
    });
  }

  const warnings: WorkLocationCalendarWarning[] = [];
  const warningIds = new Set<string>();
  for (const account of input.accounts) {
    const message = warningMessage(account);
    if (!message) continue;
    const id = `${account.connectionId}:${account.state}:${account.reason ?? 'none'}:${String(account.pendingWrites)}`;
    if (warningIds.has(id)) continue;
    warningIds.add(id);
    warnings.push({
      id,
      label: account.accountLabel ?? (account.provider === 'google' ? 'Google' : account.provider),
      message,
    });
  }

  return { regions, warnings };
}
