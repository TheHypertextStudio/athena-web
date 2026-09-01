import type { CalendarItemKind } from '@docket/planning/calendar-contract';

import type { ScheduleItemAppearance } from '@/components/scheduling';

/** Map one calendar-domain item kind into the shared scheduling appearance vocabulary. */
export function calendarScheduleItemAppearance(
  kind: CalendarItemKind,
): Exclude<ScheduleItemAppearance, 'busy'> {
  switch (kind) {
    case 'provider_event':
    case 'native_event':
      return 'event';
    case 'native_block':
    case 'timebox':
    case 'task_timebox':
      return 'timebox';
    case 'availability_block':
      return 'availability';
  }
}
