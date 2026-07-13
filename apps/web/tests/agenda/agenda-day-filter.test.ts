import { AgendaOut, type AgendaOut as AgendaValue } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { filterAgendaForDisplayDate } from '@/components/agenda/agenda-day-filter';

const CONNECTION_ID = '01BX5ZZKBKACTAV9WEVGEMMVN1';
const CALENDAR_ID = '01BX5ZZKBKACTAV9WEVGEMMVN2';
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const ORG_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

function agenda(entries: unknown[]): AgendaValue {
  return AgendaOut.parse({ date: '2026-07-13', entries });
}

function timedEvent(id: string, title: string, startsAt: string, endsAt: string): unknown {
  return providerEvent(id, title, { startsAt, endsAt });
}

function allDayEvent(id: string, title: string, start: string, end: string): unknown {
  return providerEvent(id, title, {
    startsAt: null,
    endsAt: null,
    allDayStartDate: start,
    allDayEndDate: end,
  });
}

function providerEvent(
  id: string,
  title: string,
  bounds: {
    startsAt: string | null;
    endsAt: string | null;
    allDayStartDate?: string | null;
    allDayEndDate?: string | null;
  },
): unknown {
  return {
    kind: 'google_calendar_event',
    event: {
      id,
      connectionId: CONNECTION_ID,
      calendarId: CALENDAR_ID,
      externalCalendarId: 'primary',
      externalEventId: `external-${id}`,
      status: 'confirmed',
      title,
      description: null,
      location: null,
      htmlLink: null,
      allDayStartDate: null,
      allDayEndDate: null,
      organizer: null,
      attendees: [],
      updatedExternalAt: null,
      createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:00Z',
      ...bounds,
    },
    connection: { id: CONNECTION_ID, accountEmail: 'ada@example.com', accountName: 'Ada' },
    calendar: { id: CALENDAR_ID, title: 'Work', color: '#2563eb', timezone: 'UTC' },
  };
}

describe('filterAgendaForDisplayDate', () => {
  it('keeps only provider events overlapping the selected local calendar day', () => {
    const filtered = filterAgendaForDisplayDate(
      agenda([
        {
          kind: 'task_timebox',
          taskId: TASK_ID,
          organizationId: ORG_ID,
          title: 'Planned work',
          state: 'started',
          priority: 'medium',
          startsAt: '2026-07-13T16:00:00Z',
          endsAt: '2026-07-13T17:00:00Z',
        },
        timedEvent(
          '01BX5ZZKBKACTAV9WEVGEMMVA1',
          'Previous local day',
          '2026-07-13T02:00:00Z',
          '2026-07-13T03:00:00Z',
        ),
        timedEvent(
          '01BX5ZZKBKACTAV9WEVGEMMVA2',
          'Crosses local midnight',
          '2026-07-13T06:30:00Z',
          '2026-07-13T07:30:00Z',
        ),
        timedEvent(
          '01BX5ZZKBKACTAV9WEVGEMMVA3',
          'Selected local day',
          '2026-07-13T08:00:00Z',
          '2026-07-13T09:00:00Z',
        ),
        timedEvent(
          '01BX5ZZKBKACTAV9WEVGEMMVA4',
          'Next local day',
          '2026-07-14T07:00:00Z',
          '2026-07-14T08:00:00Z',
        ),
        allDayEvent('01BX5ZZKBKACTAV9WEVGEMMVA5', 'Selected all day', '2026-07-13', '2026-07-14'),
        allDayEvent('01BX5ZZKBKACTAV9WEVGEMMVA6', 'Previous all day', '2026-07-12', '2026-07-13'),
      ]),
      '2026-07-13',
      'America/Los_Angeles',
    );

    expect(
      filtered.entries.map((entry) =>
        entry.kind === 'task_timebox' ? entry.title : entry.event.title,
      ),
    ).toEqual(['Planned work', 'Crosses local midnight', 'Selected local day', 'Selected all day']);
  });
});
