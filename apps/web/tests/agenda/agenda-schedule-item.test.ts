import { CalendarItemId, CalendarLayerId, type CalendarItemOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import type { AgendaEntry } from '@/components/agenda/agenda-model';
import { toAgendaScheduleItem } from '@/components/agenda/agenda-schedule-item';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');

function calendarItem(kind: CalendarItemOut['kind']): CalendarItemOut {
  return {
    id: ITEM_ID,
    layerId: LAYER_ID,
    connectionId: null,
    kind,
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Scheduled item',
    description: null,
    location: null,
    workPlaceId: null,
    htmlLink: null,
    startsAt: '2026-07-02T09:00:00Z',
    endsAt: '2026-07-02T10:00:00Z',
    allDayStartDate: null,
    allDayEndDate: null,
    timezone: null,
    organizer: null,
    attendees: [],
    permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
    syncState: 'clean',
    hasConflict: false,
    updatedExternalAt: null,
    archivedAt: null,
    linkedTasks: [],
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  };
}

function entry(overrides: Partial<AgendaEntry> = {}): AgendaEntry {
  return {
    id: 'entry-1',
    source: 'calendar_item',
    title: 'Scheduled item',
    startsAt: '2026-07-02T09:00:00Z',
    endsAt: '2026-07-02T10:00:00Z',
    sort: 0,
    done: false,
    ...overrides,
  };
}

describe('toAgendaScheduleItem', () => {
  it.each([
    ['provider_event', 'event'],
    ['native_event', 'event'],
    ['native_block', 'timebox'],
    ['timebox', 'timebox'],
    ['task_timebox', 'timebox'],
    ['availability_block', 'availability'],
  ] as const)('maps %s to the %s schedule appearance', (kind, appearance) => {
    expect(
      toAgendaScheduleItem(entry({ calendarItem: calendarItem(kind) }), '2026-07-02', 'UTC')
        ?.appearance,
    ).toBe(appearance);
  });

  it.each([
    ['task', 'timebox'],
    ['google_calendar_event', 'event'],
  ] as const)('maps an Agenda %s projection to the %s appearance', (source, appearance) => {
    expect(toAgendaScheduleItem(entry({ source }), '2026-07-02', 'UTC')?.appearance).toBe(
      appearance,
    );
  });
});
