import { describe, expect, it } from 'vitest';

import { CalendarItemCreate, CalendarItemUpdate } from '../../src/calendar';
import { SchedulingCommitmentInput } from '../../src/scheduling';
import {
  WorkLocationAssertionCreate,
  WorkLocationAssertionMutationOut,
  WorkLocationAssertionUpdate,
  WorkLocationObservationCreate,
  WorkLocationPointOut,
  WorkLocationProfileUpdate,
  WorkLocationRangeQuery,
  WorkLocationSyncAccountOut,
  WorkLocationSyncOut,
  WorkPlaceCreate,
  WorkPlaceOut,
  WorkPlaceUpdate,
} from '../../src/work-location';

const PLACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ASSERTION_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
const CONNECTION_ID = '01BX5ZZKBKACTAV9WEVGEMMVS0';

describe('WorkPlace', () => {
  it('models arbitrary regular places without a fixed home or office kind', () => {
    const place = WorkPlaceCreate.parse({
      name: 'Tuesday client site',
      address: '401 S 4th Street',
      geofence: null,
      providerMappings: [],
    });

    expect(place.name).toBe('Tuesday client site');
    expect(place.address).toBe('401 S 4th Street');
    expect(WorkPlaceCreate.shape).not.toHaveProperty('kind');
    expect(
      WorkPlaceCreate.safeParse({ name: 'Library', kind: 'custom', geofence: null }).success,
    ).toBe(false);
  });

  it('keeps an address optional and rejects oversized address text', () => {
    expect(WorkPlaceCreate.parse({ name: 'Train' }).address).toBeNull();
    expect(WorkPlaceCreate.safeParse({ name: 'Library', address: 'x'.repeat(241) }).success).toBe(
      false,
    );
  });

  it('requires saved-place updates to name at least one changed field', () => {
    expect(WorkPlaceUpdate.parse({ name: 'Thursday client site' })).toEqual({
      name: 'Thursday client site',
    });
    expect(WorkPlaceUpdate.safeParse({}).success).toBe(false);
  });

  it('keeps provider classifications in account-aware mappings', () => {
    const parsed = WorkPlaceOut.parse({
      id: PLACE_ID,
      name: 'Downtown office',
      address: '100 Main Street',
      geofence: { latitude: 36.1699, longitude: -115.1398, radiusMeters: 250 },
      providerMappings: [
        {
          provider: 'google',
          connectionId: CONNECTION_ID,
          classification: 'officeLocation',
          providerPlaceId: 'building-1',
          metadata: { floorId: '12', deskId: '1204' },
        },
      ],
      sort: 0,
      archivedAt: null,
      createdAt: '2026-08-13T08:00:00.000Z',
      updatedAt: '2026-08-13T08:00:00.000Z',
    });

    expect(parsed.providerMappings[0]?.classification).toBe('officeLocation');
    expect(parsed.address).toBe('100 Main Street');
    expect(parsed.geofence?.radiusMeters).toBe(250);
    expect(WorkPlaceOut.shape).not.toHaveProperty('hubId');
  });

  it('enforces the supported geofence radius without accepting observation coordinates', () => {
    expect(
      WorkPlaceCreate.safeParse({
        name: 'Library',
        geofence: { latitude: 36.1, longitude: -115.1, radiusMeters: 49 },
      }).success,
    ).toBe(false);
    expect(
      WorkPlaceCreate.safeParse({
        name: 'Library',
        geofence: { latitude: 36.1, longitude: -115.1, radiusMeters: 2_001 },
      }).success,
    ).toBe(false);
    expect(
      WorkLocationObservationCreate.safeParse({
        placeId: PLACE_ID,
        accuracyMeters: 20,
        latitude: 36.1,
        longitude: -115.1,
      }).success,
    ).toBe(false);
  });
});

describe('WorkLocationProfile', () => {
  it('designates at most one saved place as home independently of place identity', () => {
    expect(WorkLocationProfileUpdate.parse({ homePlaceId: PLACE_ID })).toEqual({
      homePlaceId: PLACE_ID,
    });
    expect(WorkLocationProfileUpdate.parse({ homePlaceId: null })).toEqual({ homePlaceId: null });
  });
});

describe('canonical place bindings', () => {
  it('binds native calendar items to a saved place without replacing display location text', () => {
    const created = CalendarItemCreate.parse({
      intent: 'timebox',
      title: 'Draft the launch brief',
      location: 'Second-floor reading room',
      workPlaceId: PLACE_ID,
      startsAt: '2026-08-13T16:00:00.000Z',
      endsAt: '2026-08-13T18:00:00.000Z',
    });

    expect(created.workPlaceId).toBe(PLACE_ID);
    expect(created.location).toBe('Second-floor reading room');
    expect(CalendarItemUpdate.parse({ workPlaceId: null })).toEqual({ workPlaceId: null });
  });

  it('binds standing scheduling commitments to any saved place', () => {
    const commitment = SchedulingCommitmentInput.parse({
      shape: 'deep_writing',
      title: 'Library writing session',
      organizationId: null,
      taskId: null,
      sessionsPerWeek: 2,
      minutesPerSession: 120,
      location: 'Main library',
      workPlaceId: PLACE_ID,
      attendees: [],
      active: true,
    });

    expect(commitment.workPlaceId).toBe(PLACE_ID);
    expect(commitment.location).toBe('Main library');
  });
});

describe('WorkLocationAssertion', () => {
  it('accepts a partial-day one-off assertion with half-open instant bounds', () => {
    const parsed = WorkLocationAssertionCreate.parse({
      placeId: PLACE_ID,
      schedule: {
        type: 'one_off_timed',
        startsAt: '2026-08-13T16:00:00.000Z',
        endsAt: '2026-08-13T20:00:00.000Z',
        timezone: 'America/Los_Angeles',
      },
    });

    expect(parsed.schedule.type).toBe('one_off_timed');
  });

  it('accepts a weekly schedule and rejects duplicate weekdays or reversed times', () => {
    expect(
      WorkLocationAssertionCreate.parse({
        placeId: PLACE_ID,
        schedule: {
          type: 'weekly_timed',
          effectiveFrom: '2026-08-10',
          effectiveUntil: null,
          weekdays: [0, 2, 4],
          startMinute: 540,
          endMinute: 1_020,
          timezone: 'America/Los_Angeles',
        },
      }).schedule.type,
    ).toBe('weekly_timed');
    expect(
      WorkLocationAssertionCreate.safeParse({
        placeId: PLACE_ID,
        schedule: {
          type: 'weekly_timed',
          effectiveFrom: '2026-08-10',
          effectiveUntil: null,
          weekdays: [1, 1],
          startMinute: 1_020,
          endMinute: 540,
          timezone: 'America/Los_Angeles',
        },
      }).success,
    ).toBe(false);
  });

  it('validates weekly effective ranges for all-day and timed schedules', () => {
    expect(
      WorkLocationAssertionCreate.safeParse({
        placeId: PLACE_ID,
        schedule: {
          type: 'weekly_all_day',
          effectiveFrom: '2026-08-10',
          effectiveUntil: null,
          weekdays: [1],
          timezone: 'America/Los_Angeles',
        },
      }).success,
    ).toBe(true);
    expect(
      WorkLocationAssertionCreate.safeParse({
        placeId: PLACE_ID,
        schedule: {
          type: 'weekly_all_day',
          effectiveFrom: '2026-08-10',
          effectiveUntil: '2026-08-09',
          weekdays: [1],
          timezone: 'America/Los_Angeles',
        },
      }).success,
    ).toBe(false);
    expect(
      WorkLocationAssertionCreate.safeParse({
        placeId: PLACE_ID,
        schedule: {
          type: 'weekly_timed',
          effectiveFrom: '2026-08-10',
          effectiveUntil: '2026-08-09',
          weekdays: [1],
          startMinute: 540,
          endMinute: 1_020,
          timezone: 'America/Los_Angeles',
        },
      }).success,
    ).toBe(false);
  });

  it('requires assertion updates to name a place or schedule change', () => {
    expect(WorkLocationAssertionUpdate.parse({ placeId: PLACE_ID })).toEqual({
      placeId: PLACE_ID,
    });
    expect(WorkLocationAssertionUpdate.safeParse({}).success).toBe(false);
  });

  it('requires expected-location ranges to move forward in time', () => {
    expect(
      WorkLocationRangeQuery.parse({
        start: '2026-08-13T16:00:00.000Z',
        end: '2026-08-13T20:00:00.000Z',
      }),
    ).toEqual({
      start: '2026-08-13T16:00:00.000Z',
      end: '2026-08-13T20:00:00.000Z',
    });
    expect(
      WorkLocationRangeQuery.safeParse({
        start: '2026-08-13T20:00:00.000Z',
        end: '2026-08-13T16:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('resolved work location and sync state', () => {
  it('keeps current and expected independent and labels expected fallback honestly', () => {
    const parsed = WorkLocationPointOut.parse({
      at: '2026-08-13T17:00:00.000Z',
      current: {
        place: { id: PLACE_ID, name: 'Downtown office' },
        source: 'inferred_from_expected',
        confidence: 'inferred',
        effectiveStart: '2026-08-13T16:00:00.000Z',
        effectiveEnd: '2026-08-13T20:00:00.000Z',
        observedAt: null,
        expiresAt: null,
      },
      expected: {
        place: { id: PLACE_ID, name: 'Downtown office' },
        source: 'assertion',
        confidence: 'declared',
        effectiveStart: '2026-08-13T16:00:00.000Z',
        effectiveEnd: '2026-08-13T20:00:00.000Z',
        observedAt: null,
        expiresAt: null,
      },
    });

    expect(parsed.current.source).toBe('inferred_from_expected');
    expect(parsed.expected.source).toBe('assertion');
  });

  it('represents provider capability and action-required state without provider error text', () => {
    const parsed = WorkLocationSyncAccountOut.parse({
      connectionId: CONNECTION_ID,
      provider: 'google',
      accountLabel: 'willie@example.com',
      state: 'action_required',
      reason: 'unsupported_recurrence',
      capabilities: {
        scheduledIntervals: true,
        partialDays: true,
        weeklyRecurrence: true,
        currentPresence: false,
        providerPlaceIds: true,
        inboundChanges: true,
        writes: true,
      },
      bootstrapCompletedAt: null,
      lastSucceededAt: null,
      pendingWrites: 0,
    });

    expect(parsed.state).toBe('action_required');
    expect(parsed.capabilities.currentPresence).toBe(false);
  });

  it('exposes whether canonical reads are ready to replace legacy provider context', () => {
    expect(WorkLocationSyncOut.parse({ ready: true, accounts: [] })).toEqual({
      ready: true,
      accounts: [],
    });
  });

  it('returns canonical mutations with per-account eventual-delivery state', () => {
    const parsed = WorkLocationAssertionMutationOut.parse({
      assertion: {
        id: ASSERTION_ID,
        placeId: PLACE_ID,
        schedule: {
          type: 'one_off_all_day',
          date: '2026-08-13',
          timezone: 'America/Los_Angeles',
        },
        exceptions: [],
        origin: 'docket',
        originProvider: null,
        originConnectionId: null,
        revision: 1,
        archivedAt: null,
        createdAt: '2026-08-13T08:00:00.000Z',
        updatedAt: '2026-08-13T08:00:00.000Z',
      },
      projections: [
        {
          connectionId: CONNECTION_ID,
          provider: 'google',
          state: 'pending',
          reason: null,
        },
      ],
    });

    expect(parsed.projections[0]?.state).toBe('pending');
  });

  it('uses branded assertion ids', () => {
    expect(
      WorkLocationAssertionCreate.safeParse({
        id: ASSERTION_ID,
        placeId: PLACE_ID,
        schedule: {
          type: 'one_off_all_day',
          date: '2026-08-13',
          timezone: 'America/Los_Angeles',
        },
      }).success,
    ).toBe(false);
  });
});
