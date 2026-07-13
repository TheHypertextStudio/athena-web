import { describe, expect, it } from 'vitest';

import {
  isInlineEditableScheduleItem,
  scheduleItemEditCapabilities,
} from '@/components/scheduling/scheduling-date-lanes';
import type { ScheduleItem, ScheduleLane } from '@/components/scheduling/scheduling-types';

const crossMidnight: ScheduleItem = {
  id: 'overnight',
  title: 'Overnight work',
  startsAt: '2026-07-14T06:30:00Z',
  endsAt: '2026-07-14T08:30:00Z',
  editable: true,
};

/** Build one date lane for edit-capability policy tests. */
function lane(date: string, editable = true): ScheduleLane {
  return {
    id: `date:${date}`,
    label: date,
    date,
    editable,
    items: [crossMidnight],
  };
}

describe('direct schedule edit policy', () => {
  it('accepts exact positive timed ranges across midnight and multiple dates', () => {
    for (const endsAt of ['2026-07-14T08:30:00Z', '2026-07-16T08:30:00Z']) {
      expect(
        isInlineEditableScheduleItem({
          canPersistBounds: true,
          allDay: false,
          startsAt: crossMidnight.startsAt,
          endsAt,
          displayTimezone: 'America/Los_Angeles',
        }),
      ).toBe(true);
    }
  });

  it('accepts an exact positive event spanning the repeated fall-back hour', () => {
    expect(
      isInlineEditableScheduleItem({
        canPersistBounds: true,
        allDay: false,
        startsAt: '2026-11-01T08:45:00Z',
        endsAt: '2026-11-01T09:15:00Z',
        displayTimezone: 'America/Los_Angeles',
      }),
    ).toBe(true);
  });

  it('places move/start controls on the true start segment and the end control on the true end', () => {
    expect(
      scheduleItemEditCapabilities(crossMidnight, lane('2026-07-13'), 'America/Los_Angeles'),
    ).toEqual({ canMove: true, canResizeStart: true, canResizeEnd: false });
    expect(
      scheduleItemEditCapabilities(crossMidnight, lane('2026-07-14'), 'America/Los_Angeles'),
    ).toEqual({ canMove: false, canResizeStart: false, canResizeEnd: true });
  });

  it('keeps an exact following-midnight end handle on the visible start-date segment', () => {
    const endingAtMidnight = {
      ...crossMidnight,
      startsAt: '2026-07-14T06:00:00Z',
      endsAt: '2026-07-14T07:00:00Z',
    };

    expect(
      scheduleItemEditCapabilities(endingAtMidnight, lane('2026-07-13'), 'America/Los_Angeles'),
    ).toEqual({ canMove: true, canResizeStart: true, canResizeEnd: true });
  });

  it('removes every direct manipulation control when item or lane policy is read-only', () => {
    expect(
      scheduleItemEditCapabilities(
        { ...crossMidnight, editable: false },
        lane('2026-07-13'),
        'America/Los_Angeles',
      ),
    ).toEqual({ canMove: false, canResizeStart: false, canResizeEnd: false });
    expect(
      scheduleItemEditCapabilities(crossMidnight, lane('2026-07-13', false), 'America/Los_Angeles'),
    ).toEqual({ canMove: false, canResizeStart: false, canResizeEnd: false });
  });
});
