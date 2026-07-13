import '@testing-library/jest-dom/vitest';

import { CalendarItemId, type CalendarItemOut, CalendarLayerId } from '@docket/types';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarDateAxisState } from '../../src/app/(app)/calendar/use-calendar-date-axis';
import type { CalendarPeopleAxisState } from '../../src/app/(app)/calendar/use-calendar-people-axis';
import type * as SchedulingModule from '../../src/components/scheduling';
import type { ScheduleLane, SchedulingCanvasProps } from '../../src/components/scheduling';

const canvas = vi.hoisted<{ props: SchedulingCanvasProps | undefined }>(() => ({
  props: undefined,
}));
const update = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  isError: false,
}));

vi.mock('../../src/components/scheduling', async (importOriginal) => {
  const actual = await importOriginal<typeof SchedulingModule>();
  return {
    ...actual,
    SchedulingCanvas: (props: SchedulingCanvasProps) => {
      canvas.props = props;
      return <div aria-label="Schedule" />;
    },
  };
});

vi.mock('../../src/components/calendar/calendar-mutations', () => ({
  useUpdateCalendarItemById: () => update,
  useLinkTaskToCalendarItem: () => ({ reset: vi.fn(), isError: false, mutate: vi.fn() }),
  useRelateCalendarItems: () => ({ reset: vi.fn(), isError: false, mutate: vi.fn() }),
}));

vi.mock('../../src/components/calendar/calendar-layer-panel', () => ({
  default: () => null,
}));

import { CalendarSchedulingSurface } from '../../src/app/(app)/calendar/calendar-scheduling-surface';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');

function crossingFoldItem(): CalendarItemOut {
  return {
    id: ITEM_ID,
    layerId: LAYER_ID,
    connectionId: null,
    kind: 'native_event',
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Crossing fold',
    description: null,
    location: null,
    htmlLink: null,
    startsAt: '2026-11-01T07:30:00Z',
    endsAt: '2026-11-01T09:30:00Z',
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
    createdAt: '2026-11-01T07:00:00Z',
    updatedAt: '2026-11-01T07:00:00Z',
  };
}

function dateAxis(source: CalendarItemOut, lane: ScheduleLane): CalendarDateAxisState {
  return {
    windowStartDate: lane.date,
    windowLaneCount: 1,
    initialLaneIndex: 0,
    startISO: '2026-11-01T07:00:00Z',
    endISO: '2026-11-02T08:00:00Z',
    lanes: [lane],
    items: [source],
    itemById: new Map([[source.id, source]]),
    layers: [],
    itemsPending: false,
    itemsError: false,
    layersError: false,
    retrying: false,
    retry: vi.fn(),
    conflictCount: 0,
    failedCount: 0,
  };
}

const PEOPLE_AXIS: CalendarPeopleAxisState = {
  sharedWorkspaces: [],
  comparisonOrgId: '',
  selectedActorIds: [],
  activeMembers: [],
  lanes: [],
  detailByItemId: new Map(),
  membersPending: false,
  error: false,
  comparisonPending: false,
  retrying: false,
  retry: vi.fn(),
  selectWorkspace: vi.fn(),
  toggleActor: vi.fn(),
};

beforeEach(() => {
  canvas.props = undefined;
  update.mutate.mockReset();
});

describe('CalendarSchedulingSurface DST moves', () => {
  it('preserves the source item elapsed duration across fall back', () => {
    const source = crossingFoldItem();
    const scheduleItem = {
      id: source.id,
      title: source.title,
      startsAt: source.startsAt!,
      endsAt: source.endsAt!,
      editable: true,
    };
    const lane: ScheduleLane = {
      id: 'date:2026-11-01',
      label: 'Sun, Nov 1',
      date: '2026-11-01',
      items: [scheduleItem],
    };

    render(
      <CalendarSchedulingSurface
        axis="dates"
        visibleLaneCount={1}
        pixelsPerHour={72}
        displayTimezone="America/Los_Angeles"
        dateAxis={dateAxis(source, lane)}
        peopleAxis={PEOPLE_AXIS}
        onVisibleLaneCountChange={vi.fn()}
        onVisibleDateRangeChange={vi.fn()}
        onReachBoundary={vi.fn()}
        onSelectRegion={vi.fn()}
        onOpenItem={vi.fn()}
        onOpenSharedItem={vi.fn()}
      />,
    );

    act(() => {
      canvas.props?.onMoveItem?.({
        item: scheduleItem,
        fromLane: lane,
        toLane: lane,
        startMinutes: 45,
        endMinutes: 165,
      });
    });

    expect(update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: { startsAt: '2026-11-01T07:45:00Z', endsAt: '2026-11-01T09:45:00Z' },
    });
  });

  it('applies a positive exact end-edge delta across spring forward', () => {
    const source = {
      ...crossingFoldItem(),
      title: 'Crossing spring gap',
      startsAt: '2026-03-08T09:30:00Z',
      endsAt: '2026-03-08T10:30:00Z',
    };
    const scheduleItem = {
      id: source.id,
      title: source.title,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      editable: true,
    };
    const lane: ScheduleLane = {
      id: 'date:2026-03-08',
      label: 'Sun, Mar 8',
      date: '2026-03-08',
      items: [scheduleItem],
    };
    render(
      <CalendarSchedulingSurface
        axis="dates"
        visibleLaneCount={1}
        pixelsPerHour={72}
        displayTimezone="America/Los_Angeles"
        dateAxis={dateAxis(source, lane)}
        peopleAxis={PEOPLE_AXIS}
        onVisibleLaneCountChange={vi.fn()}
        onVisibleDateRangeChange={vi.fn()}
        onReachBoundary={vi.fn()}
        onSelectRegion={vi.fn()}
        onOpenItem={vi.fn()}
        onOpenSharedItem={vi.fn()}
      />,
    );

    act(() => {
      canvas.props?.onResizeItem?.({
        item: scheduleItem,
        lane,
        edge: 'end',
        startMinutes: 90,
        endMinutes: 240,
      });
    });

    expect(update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: { startsAt: '2026-03-08T09:30:00Z', endsAt: '2026-03-08T11:00:00Z' },
    });
  });

  it('persists the requested wall edge instead of an elapsed-delta shift across spring forward', () => {
    const source = {
      ...crossingFoldItem(),
      title: 'Resize across spring gap',
      startsAt: '2026-03-08T09:30:00Z',
      endsAt: '2026-03-08T11:30:00Z',
    };
    const scheduleItem = {
      id: source.id,
      title: source.title,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      editable: true,
    };
    const lane: ScheduleLane = {
      id: 'date:2026-03-08',
      label: 'Sun, Mar 8',
      date: '2026-03-08',
      items: [scheduleItem],
    };
    render(
      <CalendarSchedulingSurface
        axis="dates"
        visibleLaneCount={1}
        pixelsPerHour={72}
        displayTimezone="America/Los_Angeles"
        dateAxis={dateAxis(source, lane)}
        peopleAxis={PEOPLE_AXIS}
        onVisibleLaneCountChange={vi.fn()}
        onVisibleDateRangeChange={vi.fn()}
        onReachBoundary={vi.fn()}
        onSelectRegion={vi.fn()}
        onOpenItem={vi.fn()}
        onOpenSharedItem={vi.fn()}
      />,
    );

    act(() => {
      canvas.props?.onResizeItem?.({
        item: scheduleItem,
        lane,
        edge: 'start',
        startMinutes: 180,
        endMinutes: 270,
      });
    });

    expect(update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: { startsAt: '2026-03-08T10:00:00Z', endsAt: '2026-03-08T11:30:00Z' },
    });
  });

  it('persists the requested end wall across fall back', () => {
    const source = crossingFoldItem();
    const scheduleItem = {
      id: source.id,
      title: source.title,
      startsAt: source.startsAt!,
      endsAt: source.endsAt!,
      editable: true,
    };
    const lane: ScheduleLane = {
      id: 'date:2026-11-01',
      label: 'Sun, Nov 1',
      date: '2026-11-01',
      items: [scheduleItem],
    };
    render(
      <CalendarSchedulingSurface
        axis="dates"
        visibleLaneCount={1}
        pixelsPerHour={72}
        displayTimezone="America/Los_Angeles"
        dateAxis={dateAxis(source, lane)}
        peopleAxis={PEOPLE_AXIS}
        onVisibleLaneCountChange={vi.fn()}
        onVisibleDateRangeChange={vi.fn()}
        onReachBoundary={vi.fn()}
        onSelectRegion={vi.fn()}
        onOpenItem={vi.fn()}
        onOpenSharedItem={vi.fn()}
      />,
    );

    act(() => {
      canvas.props?.onResizeItem?.({
        item: scheduleItem,
        lane,
        edge: 'end',
        startMinutes: 30,
        endMinutes: 165,
      });
    });

    expect(update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: { startsAt: '2026-11-01T07:30:00Z', endsAt: '2026-11-01T10:45:00Z' },
    });
  });
});
