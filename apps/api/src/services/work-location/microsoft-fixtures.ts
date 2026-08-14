/** Tested Microsoft Graph mapping fixtures for a future, deliberately unconnected adapter. */
import type { WorkLocationSchedule } from '@docket/types';

const WEEKDAY = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
} as const;

/** Minimal work-plan recurrence fixture mirroring Graph's scheduled occurrence concepts. */
export interface MicrosoftWorkPlanFixture {
  readonly daysOfWeek: readonly (keyof typeof WEEKDAY)[];
  readonly startTime: string;
  readonly endTime: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly timeZone: string;
  readonly location: {
    readonly type: 'office' | 'remote';
    readonly displayName: string;
    readonly placeId?: string | null;
  };
}

/** Convert a Graph clock string to a minute-of-day. */
function minuteOfDay(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

/** Normalize a Microsoft work-plan fixture into the portable canonical schedule shape. */
export function normalizeMicrosoftWorkPlanFixture(input: MicrosoftWorkPlanFixture): {
  readonly place: {
    readonly suggestedName: string;
    readonly classification: 'office' | 'remote';
    readonly providerPlaceId: string | null;
  };
  readonly schedule: WorkLocationSchedule;
} {
  return {
    place: {
      suggestedName: input.location.displayName,
      classification: input.location.type,
      providerPlaceId: input.location.placeId ?? null,
    },
    schedule: {
      type: 'weekly_timed',
      effectiveFrom: input.startDate,
      effectiveUntil: input.endDate,
      weekdays: input.daysOfWeek.map((day) => WEEKDAY[day]),
      startMinute: minuteOfDay(input.startTime),
      endMinute: minuteOfDay(input.endTime),
      timezone: input.timeZone,
    },
  };
}

/** Build the body fixture the future adapter will pass to Graph's `setCurrentLocation` action. */
export function mapMicrosoftCurrentLocationFixture(input: {
  readonly type: 'office' | 'remote';
  readonly providerPlaceId: string | null;
  readonly updateScope: 'currentSegment' | 'currentDay';
}): {
  readonly updateScope: 'currentSegment' | 'currentDay';
  readonly workLocationType: 'office' | 'remote';
  readonly placeId?: string;
} {
  return {
    updateScope: input.updateScope,
    workLocationType: input.type,
    ...(input.type === 'office' && input.providerPlaceId ? { placeId: input.providerPlaceId } : {}),
  };
}
