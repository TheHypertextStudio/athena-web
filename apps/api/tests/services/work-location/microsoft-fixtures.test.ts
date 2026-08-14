import { describe, expect, it } from 'vitest';

import { MICROSOFT_WORK_LOCATION_CAPABILITIES } from '../../../src/services/work-location/provider-contract';
import {
  mapMicrosoftCurrentLocationFixture,
  normalizeMicrosoftWorkPlanFixture,
} from '../../../src/services/work-location/microsoft-fixtures';

describe('future Microsoft work-location adapter fixtures', () => {
  it('keeps scheduled occurrences and current presence as separate capabilities', () => {
    expect(MICROSOFT_WORK_LOCATION_CAPABILITIES).toMatchObject({
      scheduledIntervals: true,
      partialDays: true,
      weeklyRecurrence: true,
      currentPresence: true,
      providerPlaceIds: true,
    });
    expect(
      mapMicrosoftCurrentLocationFixture({
        type: 'office',
        providerPlaceId: 'hq-west-building',
        updateScope: 'currentDay',
      }),
    ).toEqual({
      updateScope: 'currentDay',
      workLocationType: 'office',
      placeId: 'hq-west-building',
    });
  });

  it('normalizes a work-plan recurrence to the portable weekly schedule shape', () => {
    expect(
      normalizeMicrosoftWorkPlanFixture({
        daysOfWeek: ['monday', 'wednesday'],
        startTime: '09:00:00',
        endTime: '17:00:00',
        startDate: '2026-08-10',
        endDate: null,
        timeZone: 'America/Los_Angeles',
        location: { type: 'office', displayName: 'HQ west', placeId: 'hq-west-building' },
      }),
    ).toEqual({
      place: {
        suggestedName: 'HQ west',
        classification: 'office',
        providerPlaceId: 'hq-west-building',
      },
      schedule: {
        type: 'weekly_timed',
        effectiveFrom: '2026-08-10',
        effectiveUntil: null,
        weekdays: [0, 2],
        startMinute: 540,
        endMinute: 1_020,
        timezone: 'America/Los_Angeles',
      },
    });
  });
});
