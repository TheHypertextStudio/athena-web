import type { CalendarItemKind } from '@docket/planning/calendar-contract';
import { describe, expect, it } from 'vitest';

import { calendarScheduleItemAppearance } from '@/components/calendar/calendar-schedule-appearance';
import type { ScheduleItemAppearance } from '@/components/scheduling';

const EXPECTED_APPEARANCES = {
  provider_event: 'event',
  native_event: 'event',
  native_block: 'timebox',
  timebox: 'timebox',
  task_timebox: 'timebox',
  availability_block: 'availability',
} as const satisfies Record<CalendarItemKind, Exclude<ScheduleItemAppearance, 'busy'>>;

describe('calendarScheduleItemAppearance', () => {
  it.each(Object.entries(EXPECTED_APPEARANCES))('maps %s to %s', (kind, appearance) => {
    expect(calendarScheduleItemAppearance(kind as CalendarItemKind)).toBe(appearance);
  });
});
