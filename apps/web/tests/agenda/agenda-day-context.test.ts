import { CalendarItemOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { partitionAgendaDay } from '@/components/agenda/agenda-day-context';
import { toAgendaEntryFromCalendarItem } from '@/components/agenda/agenda-model';

const LAYER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CONNECTION_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

function calendarEntry(id: string, title: string, providerEventType?: 'working_location') {
  const item = CalendarItemOut.parse({
    id,
    layerId: LAYER_ID,
    connectionId: CONNECTION_ID,
    kind: 'provider_event',
    provider: 'google',
    providerEventType,
    externalCalendarId: 'primary',
    externalEventId: `external-${id}`,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title,
    description: null,
    location: null,
    htmlLink: null,
    startsAt: null,
    endsAt: null,
    allDayStartDate: '2026-08-10',
    allDayEndDate: '2026-08-11',
    timezone: 'America/Los_Angeles',
    organizer: null,
    attendees: [],
    permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-08-10T08:00:00.000Z',
    updatedAt: '2026-08-10T08:00:00.000Z',
  });
  return toAgendaEntryFromCalendarItem(item, 0, '#2563eb');
}

describe('partitionAgendaDay', () => {
  it('separates semantic working-location records from scheduled entries', () => {
    const workingLocation = calendarEntry('01BX5ZZKBKACTAV9WEVGEMMVS0', 'Home', 'working_location');
    const eventNamedHome = calendarEntry('01BX5ZZKBKACTAV9WEVGEMMVS1', 'Home');

    expect(partitionAgendaDay([workingLocation, eventNamedHome])).toEqual({
      dayContext: [
        {
          id: workingLocation.id,
          kind: 'working_location',
          label: 'Home',
          color: '#2563eb',
        },
      ],
      entries: [eventNamedHome],
    });
  });

  it('leaves unsupported provider semantics in the schedule', () => {
    const ordinaryEvent = calendarEntry('01BX5ZZKBKACTAV9WEVGEMMVS2', 'Focus time');

    expect(partitionAgendaDay([ordinaryEvent])).toEqual({
      dayContext: [],
      entries: [ordinaryEvent],
    });
  });
});
