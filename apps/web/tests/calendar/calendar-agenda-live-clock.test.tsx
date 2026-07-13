import '@testing-library/jest-dom/vitest';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarSchedulingSurfaceProps } from '../../src/app/(app)/calendar/calendar-scheduling-surface';
import type { SchedulingCanvasProps } from '../../src/components/scheduling';

const calendarSurface = vi.hoisted<{
  props: CalendarSchedulingSurfaceProps | undefined;
}>(() => ({ props: undefined }));
const agendaCanvas = vi.hoisted<{ props: SchedulingCanvasProps | undefined }>(() => ({
  props: undefined,
}));
const agendaState = vi.hoisted(() => ({
  date: '2026-07-13',
  displayTimezone: 'UTC',
  pixelsPerHour: 72,
  view: 'timeline' as const,
  entries: [] as unknown[],
  setTimebox: vi.fn(),
  clearTimeboxFailure: vi.fn(),
  timeboxFailed: false,
}));
const mutation = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), isError: false }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('@/components/agenda/agenda-context', () => ({
  isTimeboxed: (entry: { startsAt?: string; endsAt?: string }) =>
    entry.startsAt !== undefined && entry.endsAt !== undefined,
  shiftISODate: (date: string, days: number) => {
    const shifted = new Date(`${date}T00:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return shifted.toISOString().slice(0, 10);
  },
  useAgenda: () => agendaState,
}));

vi.mock('@/components/scheduling', () => ({
  isInlineEditableScheduleItem: () => false,
  resolveScheduleTimezone: (timezone?: string) => timezone ?? 'UTC',
  scheduleInstantAt: () => null,
  SchedulingCanvas: (props: SchedulingCanvasProps) => {
    agendaCanvas.props = props;
    return <div data-testid="agenda-scheduling-canvas" />;
  },
  useScheduleDisplayDate: ({ now }: { readonly now: string }) => {
    const today = now.slice(0, 10);
    return { date: today, today, isToday: true, setDate: vi.fn() };
  },
}));

vi.mock('@/components/calendar/calendar-mutations', () => ({
  useLinkTaskToCalendarItem: () => mutation,
  useRelateCalendarItems: () => mutation,
  useUpdateCalendarItemById: () => mutation,
}));
vi.mock('@/components/calendar/calendar-item-drawer', () => ({ default: () => null }));
vi.mock('@/components/calendar/create-block-form', () => ({ default: () => null }));
vi.mock('@/components/agenda/agenda-entry-card', () => ({ default: () => null }));

vi.mock('@/lib/api', () => ({
  api: { v1: { hub: { preferences: { $get: vi.fn(), $patch: vi.fn() } } } },
}));
vi.mock('@/lib/query', () => ({
  apiQueryOptions: () => ({}),
  queryKeys: { hubPreferences: () => ['hub-preferences'] },
  STALE: { standard: 30_000 },
  unwrap: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn() }),
  useApiQuery: () => ({ data: { timezone: 'UTC', calendar: {} } }),
}));

vi.mock('../../src/app/(app)/calendar/calendar-scheduling-surface', () => ({
  CalendarSchedulingSurface: (props: CalendarSchedulingSurfaceProps) => {
    calendarSurface.props = props;
    return <div data-testid="calendar-scheduling-surface" />;
  },
}));
vi.mock('../../src/app/(app)/calendar/calendar-toolbar', () => ({
  CalendarToolbar: () => null,
}));
vi.mock('../../src/app/(app)/calendar/calendar-comparison-controls', () => ({
  CalendarComparisonControls: () => null,
}));
vi.mock('../../src/app/(app)/calendar/calendar-shared-item-details', () => ({
  CalendarSharedItemDetails: () => null,
}));
vi.mock('../../src/app/(app)/calendar/use-calendar-date-axis', () => ({
  useCalendarDateAxis: () => ({
    windowStartDate: '2026-07-13',
    windowLaneCount: 1,
    initialLaneIndex: 0,
    startISO: '2026-07-13T00:00:00Z',
    endISO: '2026-07-14T00:00:00Z',
    lanes: [],
    items: [],
    itemById: new Map(),
    layers: [],
    itemsPending: false,
    itemsError: false,
    layersError: false,
    conflictCount: 0,
    failedCount: 0,
  }),
}));
vi.mock('../../src/app/(app)/calendar/use-calendar-people-axis', () => ({
  useCalendarPeopleAxis: () => ({
    sharedWorkspaces: [],
    comparisonOrgId: '',
    selectedActorIds: [],
    activeMembers: [],
    lanes: [],
    detailByItemId: new Map(),
    membersPending: false,
    error: false,
    comparisonPending: false,
    selectWorkspace: vi.fn(),
    toggleActor: vi.fn(),
  }),
}));

import CalendarClient from '../../src/app/(app)/calendar/calendar-client';
import AgendaCanvas from '../../src/components/agenda/agenda-canvas';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-13T23:59:50.000Z'));
  calendarSurface.props = undefined;
  agendaCanvas.props = undefined;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Advance the shared 30-second clock across UTC midnight. */
function crossMidnight(): void {
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
}

describe('live scheduling clocks', () => {
  it('refreshes the Calendar current-time instant across midnight', () => {
    render(<CalendarClient />);
    expect(calendarSurface.props?.now).toBe('2026-07-13T23:59:50.000Z');

    crossMidnight();

    expect(calendarSurface.props?.now).toBe('2026-07-14T00:00:20.000Z');
  });

  it('refreshes the Agenda current-time instant across midnight', () => {
    render(<AgendaCanvas />);
    expect(agendaCanvas.props?.now).toBe('2026-07-13T23:59:50.000Z');

    crossMidnight();

    expect(agendaCanvas.props?.now).toBe('2026-07-14T00:00:20.000Z');
  });
});
