import type { CalendarItemOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { itemTimeLabel } from '../../src/components/calendar/item-drawer/presentation';

describe('calendar item presentation', () => {
  it('renders instant ranges in the selected display timezone', () => {
    const item = {
      startsAt: '2026-07-01T16:00:00.000Z',
      endsAt: '2026-07-01T17:00:00.000Z',
      allDayStartDate: null,
      allDayEndDate: null,
    } as CalendarItemOut;

    expect(itemTimeLabel(item, 'Asia/Tokyo')).toBe('Jul 2, 2026 · 1:00 AM – 2:00 AM');
  });

  it('disambiguates both occurrences of a repeated wall-clock hour', () => {
    const item = {
      startsAt: '2026-11-01T08:30:00Z',
      endsAt: '2026-11-01T09:30:00Z',
      allDayStartDate: null,
      allDayEndDate: null,
    } as CalendarItemOut;

    expect(itemTimeLabel(item, 'America/Los_Angeles')).toBe(
      'Nov 1, 2026 · 1:30 AM PDT – 1:30 AM PST',
    );
  });
});
