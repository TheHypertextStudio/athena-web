import { describe, expect, it } from 'vitest';
import { CalendarEventOut, CalendarItemOut } from '../src/contracts/calendar';

const id = '01BX5ZZKBKACTAV9WEVGEMMVS0';
const event = {
  id,
  connectionId: id,
  calendarId: id,
  layerId: id,
  kind: 'provider_event',
  provider: 'google',
  externalCalendarId: 'primary',
  externalEventId: 'context',
  recurringEventId: null,
  recurrenceInstanceKey: null,
  status: 'confirmed',
  title: 'Visible context',
  description: null,
  location: null,
  htmlLink: null,
  startsAt: null,
  endsAt: null,
  allDayStartDate: '2026-10-07',
  allDayEndDate: '2026-10-08',
  timezone: null,
  organizer: null,
  attendees: [],
  permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
  syncState: 'clean',
  hasConflict: false,
  updatedExternalAt: null,
  archivedAt: null,
  linkedTasks: [],
  createdAt: '2026-10-07T00:00:00Z',
  updatedAt: '2026-10-07T00:00:00Z',
};

describe('calendar availability contracts', () => {
  it.each([undefined, false, true])('preserves optional availability (%s)', (blocksTime) => {
    const value = { ...event, ...(blocksTime === undefined ? {} : { blocksTime }) };
    expect(CalendarItemOut.parse(value).blocksTime).toBe(blocksTime);
    expect(CalendarEventOut.parse(value).blocksTime).toBe(blocksTime);
  });
  it('rejects availability text in both contracts', () => {
    expect(CalendarItemOut.safeParse({ ...event, blocksTime: 'free' }).success).toBe(false);
    expect(CalendarEventOut.safeParse({ ...event, blocksTime: 'free' }).success).toBe(false);
  });
});
