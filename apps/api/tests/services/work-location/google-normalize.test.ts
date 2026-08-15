/**
 * `normalizeGoogleWorkingLocationEvent` — the decisions that turn a Google calendar event into
 * something Docket will store, ignore, or refuse.
 *
 * @remarks
 * Every one of these is a place where being wrong is silent. Accepting a recurrence Docket cannot
 * actually represent would materialize a bounded approximation of an unbounded rule and quietly
 * misreport where somebody works; refusing one it *can* represent drops the assertion with no
 * error anyone sees. The existing suite covers the happy paths — this covers the refusals, the
 * fallbacks, and the label handling that decides what a place ends up called.
 */
import { describe, expect, it } from 'vitest';

import { normalizeGoogleWorkingLocationEvent } from '../../../src/services/work-location/google';

/** A minimal working-location master, overridable per case. */
function event(over: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    eventType: 'workingLocation',
    status: 'confirmed',
    workingLocationProperties: { type: 'homeOffice' },
    start: { date: '2026-08-10' },
    end: { date: '2026-08-11' },
    ...over,
  } as never;
}

describe('events Docket declines to interpret', () => {
  it('ignores an event with no id, since nothing could be reconciled against it later', () => {
    const result = normalizeGoogleWorkingLocationEvent(event({ id: undefined }));
    expect(result).toEqual({ kind: 'ignored', externalEventId: null });
  });

  it('ignores an event that is not a working location at all', () => {
    const result = normalizeGoogleWorkingLocationEvent(event({ eventType: 'default' }));
    expect(result).toMatchObject({ kind: 'ignored', externalEventId: 'evt-1' });
  });

  it('refuses a working location whose properties name no recognizable type', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({ workingLocationProperties: { type: 'somethingNew' } }),
    );
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'invalid_working_location' });
  });

  it('refuses a working location carrying no properties', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({ workingLocationProperties: undefined }),
    );
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'invalid_working_location' });
  });

  it('refuses an event whose start and end shapes do not agree', () => {
    // A dated start with a timed end is not a shape Docket has a canonical schedule for.
    const result = normalizeGoogleWorkingLocationEvent(
      event({ start: { date: '2026-08-10' }, end: { dateTime: '2026-08-10T17:00:00Z' } }),
    );
    expect(result).toMatchObject({ kind: 'unsupported', reason: 'unsupported_recurrence' });
  });
});

describe('deletes and exceptions', () => {
  it('reports a cancelled event as a delete, carrying what identifies the occurrence', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({
        status: 'cancelled',
        recurringEventId: 'master-1',
        originalStartTime: { date: '2026-08-12' },
        etag: 'etag-3',
        updated: '2026-08-01T00:00:00.000Z',
      }),
    );
    expect(result).toMatchObject({
      kind: 'delete',
      externalEventId: 'evt-1',
      parentExternalEventId: 'master-1',
      occurrenceKey: '2026-08-12',
      etag: 'etag-3',
    });
  });

  it('reports a cancelled standalone event with no parent and no occurrence key', () => {
    const result = normalizeGoogleWorkingLocationEvent(event({ status: 'cancelled' }));
    expect(result).toMatchObject({
      kind: 'delete',
      parentExternalEventId: null,
      occurrenceKey: null,
      etag: null,
      updatedAt: null,
    });
  });

  it('keys a timed exception by its original start instant', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({
        recurringEventId: 'master-1',
        originalStartTime: { dateTime: '2026-08-12T16:00:00Z' },
      }),
    );
    expect(result).toMatchObject({ kind: 'exception', occurrenceKey: '2026-08-12T16:00:00Z' });
  });

  it('calls a master with no parent an assertion rather than an exception', () => {
    expect(normalizeGoogleWorkingLocationEvent(event())).toMatchObject({ kind: 'assertion' });
  });
});

describe('what a place ends up called', () => {
  it('names a home office Home', () => {
    const result = normalizeGoogleWorkingLocationEvent(event());
    expect(result).toMatchObject({
      place: { suggestedName: 'Home', classification: 'homeOffice', providerPlaceId: null },
    });
  });

  it('prefers the office label and keeps the building as the provider place id', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({
        workingLocationProperties: {
          type: 'officeLocation',
          officeLocation: { label: '  Pier 70  ', buildingId: 'bldg-9' },
        },
      }),
    );
    expect(result).toMatchObject({
      place: { suggestedName: 'Pier 70', providerPlaceId: 'bldg-9' },
    });
  });

  it('falls back to Office when the label is blank rather than storing an empty name', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({
        workingLocationProperties: { type: 'officeLocation', officeLocation: { label: '   ' } },
      }),
    );
    expect(result).toMatchObject({ place: { suggestedName: 'Office', providerPlaceId: null } });
  });

  it('falls back to Office when Google sends no office detail at all', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({ workingLocationProperties: { type: 'officeLocation' } }),
    );
    expect(result).toMatchObject({ place: { suggestedName: 'Office', metadata: {} } });
  });

  it('keeps only the office identifiers Google actually sent', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({
        workingLocationProperties: {
          type: 'officeLocation',
          officeLocation: { deskId: 'desk-2' },
        },
      }),
    );
    expect(result).toMatchObject({ place: { metadata: { deskId: 'desk-2' } } });
    const metadata = (result as { place: { metadata: Record<string, string> } }).place.metadata;
    expect(Object.keys(metadata)).toEqual(['deskId']);
  });

  it('names a custom location by its label, or Work location when it has none', () => {
    const labelled = normalizeGoogleWorkingLocationEvent(
      event({
        workingLocationProperties: { type: 'customLocation', customLocation: { label: ' Cafe ' } },
      }),
    );
    expect(labelled).toMatchObject({ place: { suggestedName: 'Cafe' } });

    const bare = normalizeGoogleWorkingLocationEvent(
      event({ workingLocationProperties: { type: 'customLocation' } }),
    );
    expect(bare).toMatchObject({
      place: { suggestedName: 'Work location', classification: 'customLocation' },
    });
  });
});

describe('one-off schedules', () => {
  it('reads an all-day event in the timezone Google stated', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({
        start: { date: '2026-08-10', timeZone: 'Europe/Berlin' },
        end: { date: '2026-08-11' },
      }),
    );
    expect(result).toMatchObject({
      schedule: { type: 'one_off_all_day', date: '2026-08-10', timezone: 'Europe/Berlin' },
    });
  });

  it('defaults an all-day event with no stated timezone to UTC', () => {
    expect(normalizeGoogleWorkingLocationEvent(event())).toMatchObject({
      schedule: { type: 'one_off_all_day', timezone: 'UTC' },
    });
  });

  it('normalizes a timed event to instants', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      event({
        start: { dateTime: '2026-08-10T16:00:00Z', timeZone: 'America/Los_Angeles' },
        end: { dateTime: '2026-08-11T00:00:00Z' },
      }),
    );
    expect(result).toMatchObject({
      schedule: {
        type: 'one_off_timed',
        startsAt: '2026-08-10T16:00:00.000Z',
        endsAt: '2026-08-11T00:00:00.000Z',
      },
    });
  });
});

describe('recurrences Docket refuses rather than approximates', () => {
  /** A recurring master carrying one rule. */
  function recurring(rule: string, over: Record<string, unknown> = {}) {
    return event({ recurrence: [rule], ...over });
  }

  const unsupported = { kind: 'unsupported', reason: 'unsupported_recurrence' };

  it('refuses more than one rule, which it has no combined representation for', () => {
    expect(
      normalizeGoogleWorkingLocationEvent(
        event({ recurrence: ['RRULE:FREQ=DAILY', 'EXDATE:20260811'] }),
      ),
    ).toMatchObject(unsupported);
  });

  it('refuses a recurrence line that is not an RRULE', () => {
    expect(normalizeGoogleWorkingLocationEvent(recurring('EXDATE:20260811'))).toMatchObject(
      unsupported,
    );
  });

  it('refuses a bounded COUNT, which would need expanding to store', () => {
    expect(
      normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO')),
    ).toMatchObject(unsupported);
  });

  it('refuses an interval other than every period', () => {
    expect(
      normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')),
    ).toMatchObject(unsupported);
  });

  it('refuses a frequency outside daily and weekly', () => {
    expect(normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=MONTHLY'))).toMatchObject(
      unsupported,
    );
  });

  it('refuses a weekday token it cannot map', () => {
    expect(
      normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=WEEKLY;BYDAY=XX')),
    ).toMatchObject(unsupported);
  });

  it('refuses an UNTIL it cannot parse rather than treating the rule as unbounded', () => {
    // Silently dropping the bound would keep somebody "working from home" forever.
    expect(
      normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=DAILY;UNTIL=not-a-date')),
    ).toMatchObject(unsupported);
  });
});

describe('recurrences Docket accepts', () => {
  function recurring(rule: string, over: Record<string, unknown> = {}) {
    return event({ recurrence: [rule], ...over });
  }

  it('treats a daily rule as all seven weekdays', () => {
    expect(normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=DAILY'))).toMatchObject({
      schedule: { type: 'weekly_all_day', weekdays: [0, 1, 2, 3, 4, 5, 6], effectiveUntil: null },
    });
  });

  it('reads an explicit weekday list', () => {
    expect(
      normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR')),
    ).toMatchObject({ schedule: { type: 'weekly_all_day', weekdays: [0, 2, 4] } });
  });

  it('infers the weekday from the start date when the rule names none', () => {
    // 2026-08-10 is a Monday.
    expect(normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=WEEKLY'))).toMatchObject({
      schedule: { weekdays: [0] },
    });
  });

  it('reads a date-only UNTIL as the inclusive local end', () => {
    expect(
      normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=DAILY;UNTIL=20261231')),
    ).toMatchObject({ schedule: { effectiveUntil: '2026-12-31' } });
  });

  it('reads a UTC timestamp UNTIL in the schedule timezone', () => {
    expect(
      normalizeGoogleWorkingLocationEvent(recurring('RRULE:FREQ=DAILY;UNTIL=20261231T235959Z')),
    ).toMatchObject({ schedule: { effectiveUntil: '2026-12-31' } });
  });

  it('converts a timed weekly rule into local minutes of the day', () => {
    const result = normalizeGoogleWorkingLocationEvent(
      recurring('RRULE:FREQ=WEEKLY;BYDAY=MO', {
        start: { dateTime: '2026-08-10T16:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-08-10T20:00:00Z', timeZone: 'UTC' },
      }),
    );
    expect(result).toMatchObject({
      schedule: { type: 'weekly_timed', startMinute: 960, endMinute: 1_200 },
    });
  });

  it('carries an end that lands exactly on the next local midnight', () => {
    // The day-crossing arm: `endMinute` rolls past 1440 only up to midnight itself, which is what
    // lets an evening block end at 00:00 without being read as a zero-length morning block.
    const result = normalizeGoogleWorkingLocationEvent(
      recurring('RRULE:FREQ=WEEKLY;BYDAY=MO', {
        start: { dateTime: '2026-08-10T22:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-08-11T00:00:00Z', timeZone: 'UTC' },
      }),
    );
    expect(result).toMatchObject({ schedule: { startMinute: 1_320, endMinute: 1_440 } });
  });

  it('refuses a timed rule that runs past the next local midnight', () => {
    // A weekly block is a within-day span; anything longer cannot be stored as start/end minutes
    // without silently truncating it.
    expect(
      normalizeGoogleWorkingLocationEvent(
        recurring('RRULE:FREQ=WEEKLY;BYDAY=MO', {
          start: { dateTime: '2026-08-10T22:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-08-11T02:00:00Z', timeZone: 'UTC' },
        }),
      ),
    ).toMatchObject({ kind: 'unsupported', reason: 'unsupported_recurrence' });
  });
});
