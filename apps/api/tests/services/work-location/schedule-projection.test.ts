import { describe, expect, it } from 'vitest';

import { planWorkScheduleProjection } from '../../../src/services/work-location/schedule-projection';
import type { WorkScheduleOut, WorkSchedulePlanOut } from '@docket/planning/work-location-contract';
import { WorkPlaceId, WorkScheduleExceptionId, WorkSchedulePlanId } from '@docket/planning/ids';

const PLAN_ID = WorkSchedulePlanId.parse('01BX5ZZKBKACTAV9WEVGEMMVS0');
const PLACE_ID = WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');

function plan(overrides: Partial<WorkSchedulePlanOut> = {}): WorkSchedulePlanOut {
  return {
    id: PLAN_ID,
    anchorDate: '2026-09-07',
    timezone: 'America/Los_Angeles',
    effectiveFrom: '2026-09-07',
    effectiveUntil: null,
    cycleDays: Array.from({ length: 7 }, (_, index) => ({
      segments:
        index < 5
          ? [
              {
                startMinute: 540,
                durationMinutes: 480,
                location: { type: 'saved_place' as const, placeId: PLACE_ID },
              },
            ]
          : [],
    })),
    revision: 1,
    createdAt: '2026-09-05T16:00:00.000Z',
    updatedAt: '2026-09-05T16:00:00.000Z',
    ...overrides,
  };
}

function schedule(
  planValue: WorkSchedulePlanOut,
  exceptions: WorkScheduleOut['exceptions'] = [],
): WorkScheduleOut {
  return { plans: [planValue], exceptions };
}

describe('work-schedule provider projection', () => {
  it('uses one weekly provider rule for matching weekdays in a seven-day plan', () => {
    const projection = planWorkScheduleProjection({
      schedule: schedule(plan()),
      startDate: '2026-09-07',
      endDate: '2026-12-05',
    });

    expect(projection).toEqual([
      expect.objectContaining({
        key: `${PLAN_ID}:weekly:540:480:${PLACE_ID}`,
        planVersionId: PLAN_ID,
        occurrenceDate: null,
        placeId: PLACE_ID,
        schedule: {
          type: 'weekly_timed',
          effectiveFrom: '2026-09-07',
          effectiveUntil: null,
          weekdays: [0, 1, 2, 3, 4],
          startMinute: 540,
          endMinute: 1_020,
          timezone: 'America/Los_Angeles',
        },
      }),
    ]);

    const shiftedWindow = planWorkScheduleProjection({
      schedule: schedule(plan()),
      startDate: '2026-09-08',
      endDate: '2026-12-06',
    });
    expect(shiftedWindow[0]?.schedule).toEqual(projection[0]?.schedule);
  });

  it('expands a rotating plan into stable dated provider items', () => {
    const rotation = plan({
      cycleDays: Array.from({ length: 9 }, (_, index) => ({
        segments:
          index === 0 || index === 4
            ? [
                {
                  startMinute: 360,
                  durationMinutes: 720,
                  location: { type: 'saved_place' as const, placeId: PLACE_ID },
                },
              ]
            : [],
      })),
    });

    const projection = planWorkScheduleProjection({
      schedule: schedule(rotation),
      startDate: '2026-09-07',
      endDate: '2026-09-16',
    });

    expect(projection.map((item) => item.key)).toEqual([
      `${PLAN_ID}:2026-09-07:0`,
      `${PLAN_ID}:2026-09-11:0`,
      `${PLAN_ID}:2026-09-16:0`,
    ]);
  });

  it('uses dated items when an exception changes one day', () => {
    const exceptionId = WorkScheduleExceptionId.parse('01BX5ZZKBKACTAV9WEVGEMMVT1');
    const projection = planWorkScheduleProjection({
      schedule: schedule(plan(), [
        {
          id: exceptionId,
          planVersionId: PLAN_ID,
          date: '2026-09-08',
          segments: [
            {
              startMinute: 600,
              durationMinutes: 120,
              location: { type: 'saved_place', placeId: PLACE_ID },
            },
          ],
          origin: 'docket',
          createdAt: '2026-09-05T16:00:00.000Z',
          updatedAt: '2026-09-05T16:00:00.000Z',
        },
      ]),
      startDate: '2026-09-07',
      endDate: '2026-09-09',
    });

    expect(projection.map((item) => item.key)).toEqual([
      `${PLAN_ID}:2026-09-07:0`,
      `${PLAN_ID}:2026-09-08:0`,
      `${PLAN_ID}:2026-09-09:0`,
    ]);
    expect(projection[1]).toMatchObject({
      exceptionId,
      schedule: {
        type: 'one_off_timed',
        startsAt: '2026-09-08T17:00:00.000Z',
        endsAt: '2026-09-08T19:00:00.000Z',
      },
    });
  });

  it('omits mobile and undecided work from place projections', () => {
    const projection = planWorkScheduleProjection({
      schedule: schedule(
        plan({
          cycleDays: [
            {
              segments: [
                { startMinute: 480, durationMinutes: 120, location: { type: 'mobile' } },
                { startMinute: 660, durationMinutes: 120, location: { type: 'undecided' } },
              ],
            },
          ],
        }),
      ),
      startDate: '2026-09-07',
      endDate: '2026-09-08',
    });

    expect(projection).toEqual([]);
  });
});
