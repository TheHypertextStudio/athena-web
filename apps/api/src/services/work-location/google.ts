/** Pure Google Calendar working-location mapping and import normalization. */
import type { WorkLocationSchedule } from '@docket/types';

import { addCalendarDays, mondayWeekdayIndex } from '../../lib/recurrence/calendar-date';
import { instantAt, localDateString, localMinuteOfDay } from '../scheduling/zoned-time';
import type {
  WorkLocationProviderAssertion,
  WorkLocationProviderProjection,
} from './provider-contract';

const GOOGLE_WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** Google working-location properties preserved by the canonical provider binding. */
export interface GoogleWorkingLocationProperties {
  readonly type?: 'homeOffice' | 'officeLocation' | 'customLocation';
  readonly homeOffice?: Record<string, never>;
  readonly officeLocation?: {
    readonly buildingId?: string;
    readonly floorId?: string;
    readonly floorSectionId?: string;
    readonly deskId?: string;
    readonly label?: string;
  };
  readonly customLocation?: { readonly label?: string };
}

/** Subset of a Google Calendar Event used by the dedicated work-location feed. */
export interface GoogleWorkingLocationEvent {
  readonly id?: string;
  readonly eventType?: string;
  readonly status?: string;
  readonly updated?: string;
  readonly etag?: string;
  readonly start?: {
    readonly date?: string;
    readonly dateTime?: string;
    readonly timeZone?: string;
  };
  readonly end?: { readonly date?: string; readonly dateTime?: string; readonly timeZone?: string };
  readonly recurrence?: readonly string[];
  readonly recurringEventId?: string;
  readonly originalStartTime?: {
    readonly date?: string;
    readonly dateTime?: string;
    readonly timeZone?: string;
  };
  readonly workingLocationProperties?: GoogleWorkingLocationProperties;
}

/** Canonical place suggestion obtained from a Google working-location payload. */
export interface GoogleImportedPlace {
  readonly suggestedName: string;
  readonly classification: 'homeOffice' | 'officeLocation' | 'customLocation';
  readonly providerPlaceId: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Normalized result of one event from the dedicated primary-calendar location feed. */
export type NormalizedGoogleWorkingLocation =
  | {
      readonly kind: 'assertion' | 'exception';
      readonly externalEventId: string;
      readonly parentExternalEventId: string | null;
      readonly occurrenceKey: string | null;
      readonly etag: string | null;
      readonly updatedAt: Date | null;
      readonly place: GoogleImportedPlace;
      readonly schedule: WorkLocationSchedule;
    }
  | {
      readonly kind: 'delete';
      readonly externalEventId: string;
      readonly parentExternalEventId: string | null;
      readonly occurrenceKey: string | null;
      readonly etag: string | null;
      readonly updatedAt: Date | null;
    }
  | {
      readonly kind: 'unsupported';
      readonly externalEventId: string;
      readonly reason: 'unsupported_recurrence' | 'invalid_working_location';
    }
  | { readonly kind: 'ignored'; readonly externalEventId: string | null };

/** First selected weekday on or after an effective start date. */
function firstOccurrenceDate(effectiveFrom: string, weekdays: readonly number[]): string {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addCalendarDays(effectiveFrom, offset);
    if (weekdays.includes(mondayWeekdayIndex(date))) return date;
  }
  return effectiveFrom;
}

/** RFC 5545 recurrence suffix with an inclusive local effective end. */
function weeklyRecurrence(
  schedule: Extract<WorkLocationSchedule, { type: 'weekly_all_day' | 'weekly_timed' }>,
): string {
  const days = schedule.weekdays.map((weekday) => GOOGLE_WEEKDAYS[weekday]).join(',');
  const until =
    schedule.effectiveUntil === null
      ? ''
      : `;UNTIL=${instantAt(addCalendarDays(schedule.effectiveUntil, 1), 0, schedule.timezone)
          .toISOString()
          .replace(/[-:]/g, '')
          .replace('.000', '')}`;
  return `RRULE:FREQ=WEEKLY;BYDAY=${days}${until}`;
}

/** Build Google-native location properties without leaking Google vocabulary into core places. */
function projectedProperties(
  assertion: WorkLocationProviderAssertion,
): GoogleWorkingLocationProperties {
  const classification =
    assertion.classification ?? (assertion.homeDesignated ? 'homeOffice' : 'customLocation');
  if (classification === 'homeOffice') return { type: 'homeOffice', homeOffice: {} };
  if (classification === 'officeLocation') {
    const metadata = assertion.providerPlaceMetadata;
    return {
      type: 'officeLocation',
      officeLocation: {
        ...(assertion.providerPlaceId ? { buildingId: assertion.providerPlaceId } : {}),
        ...(metadata['floorId'] ? { floorId: metadata['floorId'] } : {}),
        ...(metadata['floorSectionId'] ? { floorSectionId: metadata['floorSectionId'] } : {}),
        ...(metadata['deskId'] ? { deskId: metadata['deskId'] } : {}),
        label: assertion.placeName,
      },
    };
  }
  return {
    type: 'customLocation',
    customLocation: { label: assertion.placeName },
  };
}

/** Map a canonical assertion into one individual Google Calendar working-location request. */
export function mapGoogleWorkingLocationAssertion(
  assertion: WorkLocationProviderAssertion,
): WorkLocationProviderProjection {
  const schedule = assertion.schedule;
  const body: Record<string, unknown> = {
    eventType: 'workingLocation',
    transparency: 'transparent',
    visibility: 'public',
    summary: assertion.placeName,
    workingLocationProperties: projectedProperties(assertion),
  };
  if (schedule.type === 'one_off_all_day') {
    body['start'] = { date: schedule.date };
    body['end'] = { date: addCalendarDays(schedule.date, 1) };
  } else if (schedule.type === 'one_off_timed') {
    body['start'] = { dateTime: schedule.startsAt, timeZone: schedule.timezone };
    body['end'] = { dateTime: schedule.endsAt, timeZone: schedule.timezone };
  } else {
    const date = firstOccurrenceDate(schedule.effectiveFrom, schedule.weekdays);
    if (schedule.type === 'weekly_all_day') {
      body['start'] = { date };
      body['end'] = { date: addCalendarDays(date, 1) };
    } else {
      body['start'] = {
        dateTime: instantAt(date, schedule.startMinute, schedule.timezone).toISOString(),
        timeZone: schedule.timezone,
      };
      body['end'] = {
        dateTime: instantAt(date, schedule.endMinute, schedule.timezone).toISOString(),
        timeZone: schedule.timezone,
      };
    }
    body['recurrence'] = [weeklyRecurrence(schedule)];
  }
  return { externalEventId: null, body };
}

/** Extract an occurrence identity in the exact form Google uses for recurring exceptions. */
function occurrenceKey(event: GoogleWorkingLocationEvent): string | null {
  return event.originalStartTime?.date ?? event.originalStartTime?.dateTime ?? null;
}

/** Normalize Google location properties while preserving office identifiers. */
function importedPlace(
  properties: GoogleWorkingLocationProperties | undefined,
): GoogleImportedPlace | null {
  switch (properties?.type) {
    case 'homeOffice':
      return {
        suggestedName: 'Home',
        classification: 'homeOffice',
        providerPlaceId: null,
        metadata: {},
      };
    case 'officeLocation': {
      const office = properties.officeLocation ?? {};
      const label = office.label?.trim();
      const metadata: Record<string, string> = {};
      if (office.floorId) metadata['floorId'] = office.floorId;
      if (office.floorSectionId) metadata['floorSectionId'] = office.floorSectionId;
      if (office.deskId) metadata['deskId'] = office.deskId;
      return {
        suggestedName: label && label.length > 0 ? label : 'Office',
        classification: 'officeLocation',
        providerPlaceId: office.buildingId ?? null,
        metadata,
      };
    }
    case 'customLocation': {
      const label = properties.customLocation?.label?.trim();
      return {
        suggestedName: label && label.length > 0 ? label : 'Work location',
        classification: 'customLocation',
        providerPlaceId: null,
        metadata: {},
      };
    }
    default:
      return null;
  }
}

/** Parse an RFC 5545 rule into uppercase key/value components. */
function recurrenceParts(rule: string): Map<string, string> | null {
  if (!rule.startsWith('RRULE:')) return null;
  const entries = rule
    .slice('RRULE:'.length)
    .split(';')
    .map((part) => part.split('=', 2) as [string, string]);
  return new Map(entries);
}

/** Convert a Google UNTIL value into the canonical inclusive local effective date. */
function effectiveUntil(value: string | undefined, timezone: string): string | null {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) return null;
  const instant = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`,
  );
  return localDateString(instant, timezone);
}

/** Create a one-off canonical schedule from a Google event's start/end shape. */
function oneOffSchedule(event: GoogleWorkingLocationEvent): WorkLocationSchedule | null {
  if (event.start?.date && event.end?.date) {
    return {
      type: 'one_off_all_day',
      date: event.start.date,
      timezone: event.start.timeZone ?? 'UTC',
    };
  }
  if (event.start?.dateTime && event.end?.dateTime) {
    return {
      type: 'one_off_timed',
      startsAt: new Date(event.start.dateTime).toISOString(),
      endsAt: new Date(event.end.dateTime).toISOString(),
      timezone: event.start.timeZone ?? 'UTC',
    };
  }
  return null;
}

/** Normalize a supported Google master recurrence without expanding a bounded approximation. */
function recurringSchedule(event: GoogleWorkingLocationEvent): WorkLocationSchedule | null {
  const [rule] = event.recurrence ?? [];
  if (!rule || event.recurrence?.length !== 1) return null;
  const parts = recurrenceParts(rule);
  if (!parts || parts.has('COUNT') || (parts.get('INTERVAL') ?? '1') !== '1') return null;
  const frequency = parts.get('FREQ');
  if (frequency !== 'DAILY' && frequency !== 'WEEKLY') return null;
  const timezone = event.start?.timeZone ?? 'UTC';
  const startDate =
    event.start?.date ??
    (event.start?.dateTime ? localDateString(new Date(event.start.dateTime), timezone) : null);
  if (!startDate) return null;
  const weekdays =
    frequency === 'DAILY'
      ? [0, 1, 2, 3, 4, 5, 6]
      : (parts
          .get('BYDAY')
          ?.split(',')
          .map((day) => GOOGLE_WEEKDAYS.indexOf(day as never)) ?? [mondayWeekdayIndex(startDate)]);
  if (weekdays.some((weekday) => weekday < 0)) return null;
  const until = effectiveUntil(parts.get('UNTIL'), timezone);
  if (parts.has('UNTIL') && until === null) return null;
  if (event.start?.date && event.end?.date) {
    return {
      type: 'weekly_all_day',
      effectiveFrom: startDate,
      effectiveUntil: until,
      weekdays,
      timezone,
    };
  }
  if (!event.start?.dateTime || !event.end?.dateTime) return null;
  const startInstant = new Date(event.start.dateTime);
  const endInstant = new Date(event.end.dateTime);
  let endMinute = localMinuteOfDay(endInstant, timezone);
  if (localDateString(endInstant, timezone) > localDateString(startInstant, timezone))
    endMinute += 1_440;
  if (endMinute > 1_440) return null;
  return {
    type: 'weekly_timed',
    effectiveFrom: startDate,
    effectiveUntil: until,
    weekdays,
    startMinute: localMinuteOfDay(startInstant, timezone),
    endMinute,
    timezone,
  };
}

/** Normalize one primary-calendar Google working-location master, exception, or tombstone. */
export function normalizeGoogleWorkingLocationEvent(
  event: GoogleWorkingLocationEvent,
): NormalizedGoogleWorkingLocation {
  const externalEventId = event.id ?? null;
  if (!externalEventId) return { kind: 'ignored', externalEventId: null };
  if (event.status === 'cancelled') {
    return {
      kind: 'delete',
      externalEventId,
      parentExternalEventId: event.recurringEventId ?? null,
      occurrenceKey: occurrenceKey(event),
      etag: event.etag ?? null,
      updatedAt: event.updated ? new Date(event.updated) : null,
    };
  }
  if (event.eventType !== 'workingLocation') return { kind: 'ignored', externalEventId };
  const place = importedPlace(event.workingLocationProperties);
  if (!place) return { kind: 'unsupported', externalEventId, reason: 'invalid_working_location' };
  const schedule = event.recurrence ? recurringSchedule(event) : oneOffSchedule(event);
  if (!schedule) {
    return { kind: 'unsupported', externalEventId, reason: 'unsupported_recurrence' };
  }
  return {
    kind: event.recurringEventId ? 'exception' : 'assertion',
    externalEventId,
    parentExternalEventId: event.recurringEventId ?? null,
    occurrenceKey: occurrenceKey(event),
    etag: event.etag ?? null,
    updatedAt: event.updated ? new Date(event.updated) : null,
    place,
    schedule,
  };
}
