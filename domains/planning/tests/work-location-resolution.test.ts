import { describe, expect, it } from 'vitest';
import { WorkPlaceId, WorkScheduleExceptionId, WorkSchedulePlanId } from '@docket/planning/ids';

import {
  resolveExpectedWorkLocationRange,
  resolveWorkLocationPoint,
  type WorkLocationResolutionState,
} from '../src/work-location-resolution';

const LIBRARY = {
  id: WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  name: 'Main library',
} as const;
const STUDIO = {
  id: WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
  name: 'Editing studio',
} as const;
const CLIENT = {
  id: WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVS0'),
  name: 'Tuesday client site',
} as const;
const MISSING_PLACE_ID = WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVS9');

function state(overrides: Partial<WorkLocationResolutionState> = {}): WorkLocationResolutionState {
  return {
    timezone: 'America/Los_Angeles',
    places: [LIBRARY, STUDIO, CLIENT],
    assertions: [],
    workBlocks: [],
    observations: [],
    activeTimeContexts: [],
    plans: [],
    ...overrides,
  };
}

function defaultPlan(
  cycleDays: WorkLocationResolutionState['plans'][number]['plan']['cycleDays'],
): NonNullable<WorkLocationResolutionState['plans']>[number] {
  return {
    plan: {
      id: WorkSchedulePlanId.parse('01BX5ZZKBKACTAV9WEVGEMMVT1'),
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays,
      revision: 1,
      createdAt: '2026-09-05T16:00:00.000Z',
      updatedAt: '2026-09-05T16:00:00.000Z',
    },
    exceptions: [],
  };
}

describe('expected work-location resolution', () => {
  it('prefers the default plan over a legacy assertion on the same instant', () => {
    const resolutionState = state({
      plans: [
        defaultPlan([
          {
            segments: [
              {
                startMinute: 540,
                durationMinutes: 480,
                location: { type: 'saved_place', placeId: STUDIO.id },
              },
            ],
          },
        ]),
      ],
      assertions: [
        {
          id: 'legacy-library',
          placeId: LIBRARY.id,
          schedule: {
            type: 'one_off_all_day',
            date: '2026-09-07',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 9,
          updatedAt: new Date('2026-09-06T00:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-07T18:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({
      place: STUDIO,
      source: 'schedule_plan',
      workState: 'scheduled',
    });
  });

  it('uses mobile work to block a legacy location without inventing a place', () => {
    const resolutionState = state({
      plans: [
        defaultPlan([
          {
            segments: [
              {
                startMinute: 540,
                durationMinutes: 480,
                location: { type: 'mobile' },
              },
            ],
          },
        ]),
      ],
      assertions: [
        {
          id: 'legacy-library',
          placeId: LIBRARY.id,
          schedule: {
            type: 'one_off_all_day',
            date: '2026-09-07',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-07T18:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({ place: null, source: 'schedule_plan', workState: 'mobile' });
  });

  it('keeps the canonical schedule when its saved place no longer exists', () => {
    const resolutionState = state({
      plans: [
        defaultPlan([
          {
            segments: [
              {
                startMinute: 540,
                durationMinutes: 480,
                location: { type: 'saved_place', placeId: MISSING_PLACE_ID },
              },
            ],
          },
        ]),
      ],
      assertions: [
        {
          id: 'legacy-library',
          placeId: LIBRARY.id,
          schedule: {
            type: 'one_off_all_day',
            date: '2026-09-07',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-07T18:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({
      place: null,
      source: 'schedule_plan',
      workState: 'scheduled',
      confidence: 'unknown',
    });
  });

  it('preserves an undecided schedule segment without inventing a place', () => {
    const resolutionState = state({
      plans: [
        defaultPlan([
          {
            segments: [
              {
                startMinute: 540,
                durationMinutes: 480,
                location: { type: 'undecided' },
              },
            ],
          },
        ]),
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-07T18:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({
      place: null,
      source: 'schedule_plan',
      workState: 'undecided',
      confidence: 'unknown',
    });
  });

  it('uses a dated day off to block a legacy location for the complete date', () => {
    const planned = defaultPlan([
      {
        segments: [
          {
            startMinute: 540,
            durationMinutes: 480,
            location: { type: 'saved_place', placeId: STUDIO.id },
          },
        ],
      },
    ]);
    const resolutionState = state({
      plans: [
        {
          ...planned,
          exceptions: [
            {
              id: WorkScheduleExceptionId.parse('01BX5ZZKBKACTAV9WEVGEMMVT2'),
              planVersionId: planned.plan.id,
              date: '2026-09-07',
              segments: [],
              origin: 'docket',
              createdAt: '2026-09-06T00:00:00.000Z',
              updatedAt: '2026-09-06T00:00:00.000Z',
            },
          ],
        },
      ],
      assertions: [
        {
          id: 'legacy-library',
          placeId: LIBRARY.id,
          schedule: {
            type: 'one_off_all_day',
            date: '2026-09-07',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-07T18:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({ place: null, source: 'schedule_plan', workState: 'not_working' });
  });

  it('switches plan versions at the effective civil-date boundary', () => {
    const first = defaultPlan([
      {
        segments: [
          {
            startMinute: 540,
            durationMinutes: 480,
            location: { type: 'saved_place', placeId: LIBRARY.id },
          },
        ],
      },
    ]);
    const resolutionState = state({
      plans: [
        { ...first, plan: { ...first.plan, effectiveUntil: '2026-09-07' } },
        {
          ...defaultPlan([
            {
              segments: [
                {
                  startMinute: 540,
                  durationMinutes: 480,
                  location: { type: 'saved_place', placeId: STUDIO.id },
                },
              ],
            },
          ]),
          plan: {
            ...defaultPlan([]).plan,
            id: WorkSchedulePlanId.parse('01BX5ZZKBKACTAV9WEVGEMMVT3'),
            anchorDate: '2026-09-08',
            effectiveFrom: '2026-09-08',
            cycleDays: [
              {
                segments: [
                  {
                    startMinute: 540,
                    durationMinutes: 480,
                    location: { type: 'saved_place', placeId: STUDIO.id },
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-07T18:00:00.000Z'),
        state: resolutionState,
      }).expected.place,
    ).toEqual(LIBRARY);
    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-08T18:00:00.000Z'),
        state: resolutionState,
      }).expected.place,
    ).toEqual(STUDIO);
  });

  it('does not let an expired plan govern a later date', () => {
    const expired = defaultPlan([{ segments: [] }]);
    const resolutionState = state({
      plans: [{ ...expired, plan: { ...expired.plan, effectiveUntil: '2026-09-07' } }],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-09-08T18:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({ source: 'unknown', workState: 'unknown' });
  });

  it('keeps plan provenance and non-working gaps in range results', () => {
    const planned = defaultPlan([
      {
        segments: [
          {
            startMinute: 540,
            durationMinutes: 480,
            location: { type: 'saved_place', placeId: STUDIO.id },
          },
        ],
      },
    ]);
    const result = resolveExpectedWorkLocationRange({
      start: new Date('2026-09-07T07:00:00.000Z'),
      end: new Date('2026-09-08T07:00:00.000Z'),
      state: state({ plans: [planned] }),
    });

    expect(result.segments.map(({ source, workState }) => [source, workState])).toEqual([
      ['schedule_plan', 'not_working'],
      ['schedule_plan', 'scheduled'],
      ['schedule_plan', 'not_working'],
    ]);
    expect(result.segments[1]).toMatchObject({
      planVersionId: planned.plan.id,
      scheduleExceptionId: null,
    });
  });
  it('uses half-open boundaries and expands an all-day assertion across a DST-short day', () => {
    const resolutionState = state({
      assertions: [
        {
          id: 'spring-forward',
          placeId: LIBRARY.id,
          schedule: {
            type: 'one_off_all_day',
            date: '2026-03-08',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const during = resolveWorkLocationPoint({
      at: new Date('2026-03-08T19:00:00.000Z'),
      state: resolutionState,
    });
    const atExclusiveEnd = resolveWorkLocationPoint({
      at: new Date('2026-03-09T07:00:00.000Z'),
      state: resolutionState,
    });

    expect(during.expected).toMatchObject({
      place: LIBRARY,
      source: 'assertion',
      effectiveStart: '2026-03-08T08:00:00.000Z',
      effectiveEnd: '2026-03-09T07:00:00.000Z',
    });
    expect(atExclusiveEnd.expected.source).toBe('unknown');
  });

  it('applies weekly weekday selection and cancel/replace occurrence exceptions', () => {
    const resolutionState = state({
      assertions: [
        {
          id: 'weekly-library',
          placeId: LIBRARY.id,
          schedule: {
            type: 'weekly_timed',
            effectiveFrom: '2026-08-03',
            effectiveUntil: null,
            weekdays: [0, 2],
            startMinute: 540,
            endMinute: 1_020,
            timezone: 'America/Los_Angeles',
          },
          exceptions: [
            { action: 'cancel', date: '2026-08-10' },
            {
              action: 'replace',
              date: '2026-08-12',
              placeId: CLIENT.id,
              schedule: {
                type: 'one_off_timed',
                startsAt: '2026-08-12T18:00:00.000Z',
                endsAt: '2026-08-12T22:00:00.000Z',
                timezone: 'America/Los_Angeles',
              },
            },
          ],
          revision: 3,
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-10T18:00:00.000Z'),
        state: resolutionState,
      }).expected.source,
    ).toBe('unknown');
    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-12T19:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({ place: CLIENT, source: 'assertion' });
  });

  it('honors both effective bounds and working hours for a finite weekly assertion', () => {
    const resolutionState = state({
      assertions: [
        {
          id: 'finite-weekly-library',
          placeId: LIBRARY.id,
          schedule: {
            type: 'weekly_timed',
            effectiveFrom: '2026-08-10',
            effectiveUntil: '2026-08-12',
            weekdays: [0, 2],
            startMinute: 540,
            endMinute: 1_020,
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    for (const at of [
      '2026-08-03T18:00:00.000Z',
      '2026-08-12T14:00:00.000Z',
      '2026-08-19T18:00:00.000Z',
    ]) {
      expect(
        resolveWorkLocationPoint({ at: new Date(at), state: resolutionState }).expected,
      ).toMatchObject({
        source: 'unknown',
      });
    }
  });

  it('finds a moved weekly replacement from its target date without the source date in range', () => {
    const resolutionState = state({
      assertions: [
        {
          id: 'weekly-moved',
          placeId: LIBRARY.id,
          schedule: {
            type: 'weekly_all_day',
            effectiveFrom: '2026-08-03',
            effectiveUntil: null,
            weekdays: [2],
            timezone: 'America/Los_Angeles',
          },
          exceptions: [
            {
              action: 'replace',
              date: '2026-08-12',
              placeId: CLIENT.id,
              schedule: {
                type: 'one_off_all_day',
                date: '2026-08-15',
                timezone: 'America/Los_Angeles',
              },
            },
          ],
          revision: 2,
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-15T19:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({ place: CLIENT, source: 'assertion' });
  });

  it('prefers timed assertions over all-day assertions and newest revisions at equal scope', () => {
    const resolutionState = state({
      assertions: [
        {
          id: 'all-day',
          placeId: LIBRARY.id,
          schedule: {
            type: 'one_off_all_day',
            date: '2026-08-13',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 99,
          updatedAt: new Date('2026-08-13T12:00:00.000Z'),
        },
        {
          id: 'older-timed',
          placeId: STUDIO.id,
          schedule: {
            type: 'one_off_timed',
            startsAt: '2026-08-13T16:00:00.000Z',
            endsAt: '2026-08-13T20:00:00.000Z',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-08-13T12:00:00.000Z'),
        },
        {
          id: 'newer-timed',
          placeId: CLIENT.id,
          schedule: {
            type: 'one_off_timed',
            startsAt: '2026-08-13T16:00:00.000Z',
            endsAt: '2026-08-13T20:00:00.000Z',
            timezone: 'America/Los_Angeles',
          },
          exceptions: [],
          revision: 2,
          updatedAt: new Date('2026-08-13T12:05:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-13T17:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({ place: CLIENT, source: 'assertion' });
  });

  it('uses the stable provider account id for an exact imported-assertion tie', () => {
    const sharedSchedule = {
      type: 'one_off_timed' as const,
      startsAt: '2026-08-13T16:00:00.000Z',
      endsAt: '2026-08-13T20:00:00.000Z',
      timezone: 'America/Los_Angeles',
    };
    const resolutionState = state({
      assertions: [
        {
          id: 'zzz-assertion',
          tieBreaker: 'account-b',
          placeId: STUDIO.id,
          schedule: sharedSchedule,
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-08-13T12:00:00.000Z'),
        },
        {
          id: 'aaa-assertion',
          tieBreaker: 'account-a',
          placeId: LIBRARY.id,
          schedule: sharedSchedule,
          exceptions: [],
          revision: 1,
          updatedAt: new Date('2026-08-13T12:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-13T17:00:00.000Z'),
        state: resolutionState,
      }).expected,
    ).toMatchObject({ place: LIBRARY, source: 'assertion' });
  });

  it('bridges only an otherwise empty same-day gap between consecutive same-place work blocks', () => {
    const baseBlocks = [
      {
        id: 'morning',
        placeId: LIBRARY.id,
        startsAt: new Date('2026-08-13T16:00:00.000Z'),
        endsAt: new Date('2026-08-13T17:00:00.000Z'),
      },
      {
        id: 'afternoon',
        placeId: LIBRARY.id,
        startsAt: new Date('2026-08-13T18:00:00.000Z'),
        endsAt: new Date('2026-08-13T19:00:00.000Z'),
      },
    ] as const;

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-13T17:30:00.000Z'),
        state: state({ workBlocks: baseBlocks }),
      }).expected,
    ).toMatchObject({ place: LIBRARY, source: 'bridged_work_blocks' });

    const withInterveningBlock = [
      baseBlocks[0],
      {
        id: 'remote-call',
        placeId: null,
        startsAt: new Date('2026-08-13T17:15:00.000Z'),
        endsAt: new Date('2026-08-13T17:45:00.000Z'),
      },
      baseBlocks[1],
    ] as const;
    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-13T17:30:00.000Z'),
        state: state({ workBlocks: withInterveningBlock }),
      }).expected.source,
    ).toBe('unknown');
  });

  it('does not resolve a work block whose saved place no longer exists', () => {
    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-13T17:00:00.000Z'),
        state: state({
          workBlocks: [
            {
              id: 'missing-place',
              placeId: MISSING_PLACE_ID,
              startsAt: new Date('2026-08-13T16:00:00.000Z'),
              endsAt: new Date('2026-08-13T20:00:00.000Z'),
            },
          ],
        }),
      }).expected,
    ).toMatchObject({ source: 'unknown', workState: 'unknown' });
  });

  it('returns ordered, non-overlapping segments that cover unknown portions of a range', () => {
    const result = resolveExpectedWorkLocationRange({
      start: new Date('2026-08-13T15:00:00.000Z'),
      end: new Date('2026-08-13T19:00:00.000Z'),
      state: state({
        workBlocks: [
          {
            id: 'work',
            placeId: STUDIO.id,
            startsAt: new Date('2026-08-13T16:00:00.000Z'),
            endsAt: new Date('2026-08-13T18:00:00.000Z'),
          },
        ],
      }),
    });

    expect(
      result.segments.map((segment) => [
        segment.effectiveStart,
        segment.effectiveEnd,
        segment.source,
      ]),
    ).toEqual([
      ['2026-08-13T15:00:00.000Z', '2026-08-13T16:00:00.000Z', 'unknown'],
      ['2026-08-13T16:00:00.000Z', '2026-08-13T18:00:00.000Z', 'work_block'],
      ['2026-08-13T18:00:00.000Z', '2026-08-13T19:00:00.000Z', 'unknown'],
    ]);
  });
});

describe('current work-location resolution', () => {
  it('uses manual, fresh device, active Time Ledger, then expected evidence in order', () => {
    const at = new Date('2026-08-13T17:00:00.000Z');
    const resolutionState = state({
      workBlocks: [
        {
          id: 'expected-studio',
          placeId: STUDIO.id,
          startsAt: new Date('2026-08-13T16:00:00.000Z'),
          endsAt: new Date('2026-08-13T20:00:00.000Z'),
        },
      ],
      activeTimeContexts: [
        {
          placeId: CLIENT.id,
          startsAt: new Date('2026-08-13T16:30:00.000Z'),
          endsAt: null,
        },
      ],
      observations: [
        {
          source: 'device',
          placeId: LIBRARY.id,
          accuracyMeters: 30,
          observedAt: new Date('2026-08-13T16:50:00.000Z'),
          expiresAt: new Date('2026-08-13T17:05:00.000Z'),
        },
        {
          source: 'manual',
          placeId: STUDIO.id,
          accuracyMeters: null,
          observedAt: new Date('2026-08-13T16:55:00.000Z'),
          expiresAt: new Date('2026-08-13T18:00:00.000Z'),
        },
      ],
    });

    expect(resolveWorkLocationPoint({ at, state: resolutionState }).current).toMatchObject({
      place: STUDIO,
      source: 'manual',
      confidence: 'declared',
    });
    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-13T18:00:00.000Z'),
        state: resolutionState,
      }).current,
    ).toMatchObject({ place: CLIENT, source: 'time_ledger' });
  });

  it('expires observations at their exclusive end and labels expected fallback as inferred', () => {
    const resolutionState = state({
      observations: [
        {
          source: 'device',
          placeId: LIBRARY.id,
          accuracyMeters: 25,
          observedAt: new Date('2026-08-13T16:45:00.000Z'),
          expiresAt: new Date('2026-08-13T17:00:00.000Z'),
        },
      ],
      workBlocks: [
        {
          id: 'expected-studio',
          placeId: STUDIO.id,
          startsAt: new Date('2026-08-13T16:00:00.000Z'),
          endsAt: new Date('2026-08-13T20:00:00.000Z'),
        },
      ],
    });

    expect(
      resolveWorkLocationPoint({
        at: new Date('2026-08-13T17:00:00.000Z'),
        state: resolutionState,
      }).current,
    ).toMatchObject({
      place: STUDIO,
      source: 'inferred_from_expected',
      confidence: 'inferred',
    });
  });
});
