import '@testing-library/jest-dom/vitest';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarSchedulingSurfaceProps } from '../../src/app/(app)/calendar/calendar-scheduling-surface';
import type { CalendarToolbarProps } from '../../src/app/(app)/calendar/calendar-toolbar';
import type { SchedulingCanvasProps } from '../../src/components/scheduling';

const calendarSurface = vi.hoisted<{
  props: CalendarSchedulingSurfaceProps | undefined;
}>(() => ({ props: undefined }));
const calendarToolbar = vi.hoisted<{ props: CalendarToolbarProps | undefined }>(() => ({
  props: undefined,
}));
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
const preferencesState = vi.hoisted<{
  data: { timezone: string; calendar: { pixelsPerHour?: number } } | undefined;
}>(() => ({ data: { timezone: 'UTC', calendar: {} } }));
const displayDateState = vi.hoisted(() => ({ setDate: vi.fn() }));

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
    return { date: today, today, isToday: true, setDate: displayDateState.setDate };
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
  useApiQuery: () => ({ data: preferencesState.data }),
}));

vi.mock('../../src/app/(app)/calendar/calendar-scheduling-surface', () => ({
  CalendarSchedulingSurface: (props: CalendarSchedulingSurfaceProps) => {
    calendarSurface.props = props;
    return <div data-testid="calendar-scheduling-surface" />;
  },
}));
vi.mock('../../src/app/(app)/calendar/calendar-toolbar', () => ({
  CalendarToolbar: (props: CalendarToolbarProps) => {
    calendarToolbar.props = props;
    return null;
  },
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
  calendarToolbar.props = undefined;
  agendaCanvas.props = undefined;
  displayDateState.setDate.mockReset();
  preferencesState.data = { timezone: 'UTC', calendar: {} };
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

describe('live calendar viewport heading', () => {
  it('requests a fresh viewport anchor when Today repeats the current date after scrolling', () => {
    render(<CalendarClient />);
    const initialAnchorKey = calendarSurface.props?.horizontalAnchorKey;
    act(() => {
      calendarSurface.props?.onVisibleDateRangeChange({
        startDate: '2026-07-16',
        endDate: '2026-07-17',
      });
    });
    expect(calendarToolbar.props?.heading).toBe('Jul 16, 2026 – Jul 17, 2026');

    act(() => {
      calendarToolbar.props?.onToday();
    });

    expect(calendarToolbar.props?.heading).toBe('Jul 13, 2026');
    expect(displayDateState.setDate).toHaveBeenCalledWith('2026-07-13');
    expect(calendarSurface.props?.horizontalAnchorKey).not.toBe(initialAnchorKey);
  });

  it('tracks the date lanes intersecting the horizontal viewport', () => {
    render(<CalendarClient />);
    expect(calendarToolbar.props?.heading).toBe('Jul 13, 2026');

    act(() => {
      calendarSurface.props?.onVisibleDateRangeChange({
        startDate: '2026-07-14',
        endDate: '2026-07-15',
      });
    });

    expect(calendarToolbar.props?.heading).toBe('Jul 14, 2026 – Jul 15, 2026');
  });

  it('pages from the visible range after horizontal scrolling', () => {
    render(<CalendarClient />);
    act(() => {
      calendarSurface.props?.onVisibleLaneCountChange(2);
      calendarSurface.props?.onVisibleDateRangeChange({
        startDate: '2026-07-14',
        endDate: '2026-07-15',
      });
    });
    displayDateState.setDate.mockClear();

    act(() => {
      calendarToolbar.props?.onNext();
    });

    const update = displayDateState.setDate.mock.calls[0]?.[0] as
      | string
      | ((current: string) => string);
    expect(typeof update === 'function' ? update('2026-07-13') : update).toBe('2026-07-16');
  });

  it('keeps the visible leading date anchored when lane geometry changes', () => {
    render(<CalendarClient />);
    act(() => {
      calendarSurface.props?.onVisibleDateRangeChange({
        startDate: '2026-07-14',
        endDate: '2026-07-16',
      });
    });
    displayDateState.setDate.mockClear();

    act(() => {
      calendarSurface.props?.onVisibleLaneCountChange(2);
    });

    const update = displayDateState.setDate.mock.calls[0]?.[0] as
      | string
      | ((current: string) => string);
    expect(typeof update === 'function' ? update('2026-07-13') : update).toBe('2026-07-14');
  });

  it.each([
    { direction: 'previous' as const, visibleStart: '2026-07-10' },
    { direction: 'next' as const, visibleStart: '2026-07-16' },
  ])(
    'rebases the $direction rolling boundary around the lanes already on screen',
    ({ direction, visibleStart }) => {
      render(<CalendarClient />);
      act(() => {
        calendarSurface.props?.onVisibleLaneCountChange(3);
        calendarSurface.props?.onVisibleDateRangeChange({
          startDate: visibleStart,
          endDate: direction === 'next' ? '2026-07-18' : '2026-07-12',
        });
      });
      displayDateState.setDate.mockClear();

      act(() => {
        calendarSurface.props?.onReachBoundary(direction);
      });

      const update = displayDateState.setDate.mock.calls[0]?.[0] as
        | string
        | ((current: string) => string);
      expect(typeof update === 'function' ? update('2026-07-13') : update).toBe(visibleStart);
    },
  );
});

describe('late calendar preference hydration', () => {
  it('hydrates zoom when the user has not changed it', () => {
    preferencesState.data = undefined;
    const result = render(<CalendarClient />);
    expect(calendarToolbar.props?.pixelsPerHour).toBe(72);

    preferencesState.data = { timezone: 'UTC', calendar: { pixelsPerHour: 144 } };
    result.rerender(<CalendarClient />);

    expect(calendarToolbar.props?.pixelsPerHour).toBe(144);
  });

  it('does not overwrite zoom changed before preferences arrive', () => {
    preferencesState.data = undefined;
    const result = render(<CalendarClient />);
    act(() => {
      calendarToolbar.props?.onZoomChange(116);
    });
    expect(calendarToolbar.props?.pixelsPerHour).toBe(116);

    preferencesState.data = { timezone: 'UTC', calendar: { pixelsPerHour: 144 } };
    result.rerender(<CalendarClient />);

    expect(calendarToolbar.props?.pixelsPerHour).toBe(116);
  });
});
