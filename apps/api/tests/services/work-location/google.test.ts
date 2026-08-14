import { describe, expect, it } from 'vitest';

import {
  mapGoogleWorkingLocationAssertion,
  normalizeGoogleWorkingLocationEvent,
} from '../../../src/services/work-location/google';

const assertion = {
  assertionId: 'assertion-1',
  revision: 4,
  placeId: 'place-1',
  placeName: 'Downtown library',
  homeDesignated: false,
  classification: null,
  providerPlaceId: null,
  providerPlaceMetadata: {},
  schedule: {
    type: 'weekly_timed' as const,
    effectiveFrom: '2026-08-10',
    effectiveUntil: null,
    weekdays: [0, 2, 4],
    startMinute: 540,
    endMinute: 1_020,
    timezone: 'America/Los_Angeles',
  },
};

describe('Google working-location projection', () => {
  it('uses an explicit account mapping before the independent home designation', () => {
    const projected = mapGoogleWorkingLocationAssertion({
      ...assertion,
      homeDesignated: true,
      classification: 'officeLocation',
      providerPlaceId: 'building-1',
      providerPlaceMetadata: { floorId: '12', deskId: '1204' },
    });

    expect(projected.body).toMatchObject({
      eventType: 'workingLocation',
      transparency: 'transparent',
      visibility: 'public',
      workingLocationProperties: {
        type: 'officeLocation',
        officeLocation: {
          buildingId: 'building-1',
          floorId: '12',
          deskId: '1204',
          label: 'Downtown library',
        },
      },
    });
  });

  it('uses home as a projection default and custom for every other unmapped place', () => {
    expect(
      mapGoogleWorkingLocationAssertion({ ...assertion, homeDesignated: true }).body,
    ).toMatchObject({
      workingLocationProperties: { type: 'homeOffice', homeOffice: {} },
    });
    expect(mapGoogleWorkingLocationAssertion(assertion).body).toMatchObject({
      workingLocationProperties: {
        type: 'customLocation',
        customLocation: { label: 'Downtown library' },
      },
    });
  });

  it('projects weekly partial-day recurrence from the first selected local weekday', () => {
    const projected = mapGoogleWorkingLocationAssertion(assertion);

    expect(projected.body).toMatchObject({
      start: { dateTime: '2026-08-10T16:00:00.000Z', timeZone: 'America/Los_Angeles' },
      end: { dateTime: '2026-08-11T00:00:00.000Z', timeZone: 'America/Los_Angeles' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    });
  });

  it('projects all-day one-offs with an exclusive date end', () => {
    const projected = mapGoogleWorkingLocationAssertion({
      ...assertion,
      schedule: {
        type: 'one_off_all_day',
        date: '2026-08-14',
        timezone: 'America/Los_Angeles',
      },
    });

    expect(projected.body).toMatchObject({
      start: { date: '2026-08-14' },
      end: { date: '2026-08-15' },
    });
    expect(projected.body).not.toHaveProperty('recurrence');
  });
});

describe('Google working-location import', () => {
  it('normalizes a daily master to a weekly all-seven-days assertion', () => {
    const normalized = normalizeGoogleWorkingLocationEvent({
      id: 'google-daily',
      eventType: 'workingLocation',
      updated: '2026-08-14T18:00:00.000Z',
      etag: 'etag-1',
      start: { date: '2026-08-10' },
      end: { date: '2026-08-11' },
      recurrence: ['RRULE:FREQ=DAILY'],
      workingLocationProperties: {
        type: 'customLocation',
        customLocation: { label: 'Neighborhood library' },
      },
    });

    expect(normalized).toMatchObject({
      kind: 'assertion',
      externalEventId: 'google-daily',
      place: { suggestedName: 'Neighborhood library', classification: 'customLocation' },
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-08-10',
        effectiveUntil: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
      },
    });
  });

  it('preserves office building, floor, section, and desk identifiers', () => {
    const normalized = normalizeGoogleWorkingLocationEvent({
      id: 'google-office',
      eventType: 'workingLocation',
      start: { dateTime: '2026-08-14T16:00:00.000Z', timeZone: 'America/Los_Angeles' },
      end: { dateTime: '2026-08-14T20:00:00.000Z', timeZone: 'America/Los_Angeles' },
      workingLocationProperties: {
        type: 'officeLocation',
        officeLocation: {
          buildingId: 'building-1',
          floorId: '12',
          floorSectionId: 'west',
          deskId: '1204',
          label: 'HQ west',
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: 'assertion',
      place: {
        suggestedName: 'HQ west',
        classification: 'officeLocation',
        providerPlaceId: 'building-1',
        metadata: { floorId: '12', floorSectionId: 'west', deskId: '1204' },
      },
      schedule: { type: 'one_off_timed' },
    });
  });

  it('marks unsupported recurrence for action instead of materializing it', () => {
    expect(
      normalizeGoogleWorkingLocationEvent({
        id: 'google-monthly',
        eventType: 'workingLocation',
        start: { date: '2026-08-14' },
        end: { date: '2026-08-15' },
        recurrence: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=14'],
        workingLocationProperties: { type: 'homeOffice', homeOffice: {} },
      }),
    ).toEqual({
      kind: 'unsupported',
      externalEventId: 'google-monthly',
      reason: 'unsupported_recurrence',
    });
  });

  it('identifies recurring exceptions and remote deletes without expanding a bounded window', () => {
    expect(
      normalizeGoogleWorkingLocationEvent({
        id: 'google-exception',
        eventType: 'workingLocation',
        recurringEventId: 'google-master',
        originalStartTime: { date: '2026-08-14' },
        status: 'cancelled',
      }),
    ).toMatchObject({
      kind: 'delete',
      externalEventId: 'google-exception',
      parentExternalEventId: 'google-master',
      occurrenceKey: '2026-08-14',
    });
  });
});
