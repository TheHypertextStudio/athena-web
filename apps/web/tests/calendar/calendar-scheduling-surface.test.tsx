import '@testing-library/jest-dom/vitest';

import {
  CalendarItemId,
  type CalendarItemOut,
  CalendarLayerId,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SchedulingModule from '../../src/components/scheduling';
import type {
  ScheduleItem,
  ScheduleLane,
  ScheduleRegionSelection,
  SchedulingCanvasProps,
} from '../../src/components/scheduling';
import type { WorkLocationCalendarComposition } from '../../src/components/work-location/use-work-location-calendar-composition';

const canvas = vi.hoisted<{ props: SchedulingCanvasProps | undefined }>(() => ({
  props: undefined,
}));
const mutationState = vi.hoisted(() => ({
  update: { mutate: vi.fn(), reset: vi.fn(), isError: false, error: null as Error | null },
  link: { mutate: vi.fn(), reset: vi.fn(), isError: false, error: null as Error | null },
  relate: { mutate: vi.fn(), reset: vi.fn(), isError: false, error: null as Error | null },
  create: { mutate: vi.fn(), reset: vi.fn(), isError: false, error: null as Error | null },
}));
const axisRetry = {
  dates: vi.fn(),
  people: vi.fn(),
};
// Backs the `renderItemAction` timer button: `TaskTimerButton` reads/writes the tracker
// through `@/lib/api` directly, independent of the calendar-mutations mock above.
const { activeGet, recordsPost } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
}));

vi.mock('../../src/components/scheduling', async (importOriginal) => {
  const actual = await importOriginal<typeof SchedulingModule>();
  return {
    ...actual,
    SchedulingCanvas: (props: SchedulingCanvasProps) => {
      canvas.props = props;
      return (
        <section aria-label="Schedule">
          {props.error ? <div role="alert">{props.error}</div> : null}
          {props.lanes.map((lane) => (
            <div key={lane.id} aria-label={`${lane.label} lane`}>
              {lane.items.map((item) => (
                <span key={item.id}>{item.title}</span>
              ))}
            </div>
          ))}
        </section>
      );
    },
  };
});

vi.mock('../../src/components/calendar/calendar-mutations', () => ({
  useUpdateCalendarItemById: () => mutationState.update,
  useLinkTaskToCalendarItem: () => mutationState.link,
  useRelateCalendarItems: () => mutationState.relate,
  useCreateCalendarItem: () => mutationState.create,
}));

vi.mock('../../src/components/calendar/calendar-layer-panel', () => ({
  default: () => <div>Layer controls</div>,
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: { $get: activeGet },
        records: { $post: recordsPost },
      },
    },
  },
}));

import { CalendarSchedulingSurface } from '../../src/app/(app)/calendar/calendar-scheduling-surface';
import {
  CalendarSharedItemDetails,
  type SharedCalendarItemDetail,
} from '../../src/app/(app)/calendar/calendar-shared-item-details';
import type { CalendarDateAxisState } from '../../src/app/(app)/calendar/use-calendar-date-axis';
import type { CalendarPeopleAxisState } from '../../src/app/(app)/calendar/use-calendar-people-axis';
import { assertDefined } from '@docket/test-utils';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const DISPLAY_TIMEZONE = 'America/Los_Angeles';

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Render children inside the providers `TaskTimerButton` needs (query client + tooltip root). */
function withTimerProviders(children: ReactNode): ReactNode {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

/** Build one normalized item shown by the date-axis fixture. */
function calendarItem(): CalendarItemOut {
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
    title: 'Planning session',
    description: null,
    location: null,
    workPlaceId: null,
    htmlLink: null,
    startsAt: '2026-07-13T16:00:00Z',
    endsAt: '2026-07-13T17:00:00Z',
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
    createdAt: '2026-07-13T15:00:00Z',
    updatedAt: '2026-07-13T15:00:00Z',
  };
}

/** Build one date lane and its underlying read model. */
function dateAxisState(
  source: CalendarItemOut = calendarItem(),
  laneDate = '2026-07-13',
): CalendarDateAxisState {
  const allDay = source.allDayStartDate !== null && source.allDayEndDate !== null;
  const item: ScheduleItem = {
    id: source.id,
    title: source.title,
    startsAt: source.startsAt ?? '2026-07-13T07:00:00Z',
    endsAt: source.endsAt ?? '2026-07-14T07:00:00Z',
    allDay,
    editable: true,
  };
  const lane: ScheduleLane = {
    id: `date:${laneDate}`,
    label: laneDate === '2026-07-13' ? 'Mon, Jul 13' : laneDate,
    date: laneDate,
    items: [item],
  };
  return {
    windowStartDate: lane.date,
    windowLaneCount: 1,
    initialLaneIndex: 0,
    startISO: '2026-07-13T07:00:00Z',
    endISO: '2026-07-14T07:00:00Z',
    lanes: [lane],
    items: [source],
    legacyWorkLocations: [],
    itemById: new Map([[source.id, source]]),
    duplicatesByItemId: new Map(),
    layers: [],
    itemsPending: false,
    itemsError: false,
    layersError: false,
    retrying: false,
    retry: axisRetry.dates,
  };
}

/** Build an inert read-only people axis. */
function peopleAxisState(): CalendarPeopleAxisState {
  return {
    sharedWorkspaces: [],
    comparisonOrgId: '',
    selectedActorIds: ['actor-1'],
    activeMembers: [],
    lanes: [
      {
        id: 'person:actor-1',
        label: 'Grace',
        date: '2026-07-13',
        editable: false,
        items: [
          {
            id: ITEM_ID,
            title: 'Shared detail',
            startsAt: '2026-07-13T16:00:00Z',
            endsAt: '2026-07-13T17:00:00Z',
            editable: false,
          },
          {
            id: 'busy:actor-1:2026-07-13T18:00:00Z',
            title: 'Busy',
            startsAt: '2026-07-13T18:00:00Z',
            endsAt: '2026-07-13T19:00:00Z',
            editable: false,
          },
        ],
      },
    ],
    detailByItemId: new Map([
      [
        ITEM_ID,
        {
          personName: 'Grace',
          personTimezone: 'America/Chicago',
          item: {
            access: 'details' as const,
            itemId: ITEM_ID,
            layerId: LAYER_ID,
            kind: 'native_event' as const,
            title: 'Shared detail',
            startsAt: '2026-07-13T16:00:00Z',
            endsAt: '2026-07-13T17:00:00Z',
            allDayStartDate: null,
            allDayEndDate: null,
          },
        },
      ],
    ]),
    membersPending: false,
    error: false,
    comparisonPending: false,
    retrying: false,
    retry: axisRetry.people,
    selectWorkspace: vi.fn(),
    toggleActor: vi.fn(),
  };
}

/** Render the consumer surface with one deterministic item and lane. */
function renderSurface(
  axis: 'dates' | 'people' = 'dates',
  source: CalendarItemOut = calendarItem(),
  laneDate = '2026-07-13',
  selectionOptions: {
    readonly selectedRegion?: ScheduleRegionSelection | null;
    readonly selectedRegionAnchorRef?: React.RefObject<HTMLDivElement | null>;
    readonly dateItemsError?: boolean;
    readonly peopleError?: boolean;
    readonly workLocationComposition?: WorkLocationCalendarComposition;
  } = {},
): {
  readonly onOpenItem: ReturnType<typeof vi.fn>;
  readonly onOpenSharedItem: ReturnType<typeof vi.fn>;
  readonly onSelectRegion: ReturnType<typeof vi.fn>;
} {
  const onOpenItem = vi.fn();
  const onOpenSharedItem = vi.fn();
  const onSelectRegion = vi.fn();
  function TestSurface(): React.JSX.Element {
    const [openSharedItem, setOpenSharedItem] = useState<SharedCalendarItemDetail | null>(null);
    return (
      <>
        <CalendarSchedulingSurface
          axis={axis}
          visibleLaneCount={1}
          pixelsPerHour={72}
          displayTimezone={DISPLAY_TIMEZONE}
          dateAxis={{
            ...dateAxisState(source, laneDate),
            itemsError: selectionOptions.dateItemsError ?? false,
          }}
          peopleAxis={{
            ...peopleAxisState(),
            error: selectionOptions.peopleError ?? false,
          }}
          workLocationComposition={selectionOptions.workLocationComposition}
          selectedRegion={selectionOptions.selectedRegion}
          selectedRegionAnchorRef={selectionOptions.selectedRegionAnchorRef}
          onVisibleLaneCountChange={vi.fn()}
          onVisibleDateRangeChange={vi.fn()}
          onReachBoundary={vi.fn()}
          onSelectRegion={onSelectRegion}
          onOpenItem={onOpenItem}
          onOpenSharedItem={(detail) => {
            onOpenSharedItem(detail);
            setOpenSharedItem(detail);
          }}
        />
        <CalendarSharedItemDetails
          detail={openSharedItem}
          displayTimezone={DISPLAY_TIMEZONE}
          onClose={() => {
            setOpenSharedItem(null);
          }}
        />
      </>
    );
  }
  render(<TestSurface />);
  return { onOpenItem, onOpenSharedItem, onSelectRegion };
}

/** Return the latest props received by the callback-driven canvas mock. */
function canvasProps(): SchedulingCanvasProps {
  return assertDefined(canvas.props);
}

beforeEach(() => {
  canvas.props = undefined;
  mutationState.update.mutate.mockReset();
  mutationState.update.reset.mockReset();
  mutationState.update.isError = false;
  mutationState.update.error = null;
  mutationState.link.mutate.mockReset();
  mutationState.link.reset.mockReset();
  mutationState.link.isError = false;
  mutationState.link.error = null;
  mutationState.relate.mutate.mockReset();
  mutationState.relate.reset.mockReset();
  mutationState.relate.isError = false;
  mutationState.relate.error = null;
  axisRetry.dates.mockReset();
  axisRetry.people.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('CalendarSchedulingSurface persistence', () => {
  it('mounts the shared work-location composition slots and editor overlays on date lanes', () => {
    const renderAllDayLaneContext = vi.fn(() => null);
    const renderTimedLaneContext = vi.fn(() => null);
    const renderTimedItemDecoration = vi.fn(() => null);
    renderSurface('dates', calendarItem(), '2026-07-13', {
      workLocationComposition: {
        canvasProps: {
          renderAllDayLaneContext,
          renderTimedLaneContext,
          renderTimedItemDecoration,
        },
        overlays: <div>Location editor</div>,
      },
    });

    expect(canvasProps()).toMatchObject({
      renderAllDayLaneContext,
      renderTimedLaneContext,
      renderTimedItemDecoration,
    });
    expect(screen.getByText('Location editor')).toBeInTheDocument();
  });

  it('teaches the next action when the date grid is empty', () => {
    renderSurface();

    expect(canvasProps().emptyMessage).toBe(
      'Nothing scheduled. Drag on the grid or choose New to plan time.',
    );
  });

  it('keeps read failures inside the fixed canvas instead of adding a status band', () => {
    renderSurface('dates', calendarItem(), '2026-07-13', { dateItemsError: true });

    expect(screen.getByRole('region', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByLabelText('Mon, Jul 13 lane')).toBeInTheDocument();
    expect(screen.getByText('Planning session')).toBeInTheDocument();
    expect(document.querySelector('[data-calendar-status-row]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(canvasProps().error).toBe(
      'Calendar updates are temporarily unavailable. Showing what we have.',
    );
    expect(screen.getByRole('region', { name: 'Schedule' })).toBeInTheDocument();
  });

  it('keeps shared-lane read failures inside the fixed canvas', () => {
    renderSurface('people', calendarItem(), '2026-07-13', { peopleError: true });

    expect(screen.getByLabelText('Grace lane')).toBeInTheDocument();
    expect(document.querySelector('[data-calendar-status-row]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(canvasProps().error).toBe(
      'Calendar updates are temporarily unavailable. Showing what we have.',
    );
  });

  it('fills and can shrink to the shell-owned remaining height', () => {
    renderSurface();

    expect(canvasProps().viewportHeight).toBe('100%');
    // `min-h-0` lets the host fit the available page height. The canvas then owns vertical scroll
    // instead of forcing the hidden page root to clip a hard minimum.
    const wrapper = screen.getByRole('region', { name: 'Schedule' }).parentElement;
    expect(wrapper).toHaveClass('flex-1', 'min-w-0', 'min-h-0');
    expect(wrapper).not.toHaveClass('min-h-[max(16rem,45dvh)]');
  });

  it('targets a seven-day desktop week with compact readable lanes', () => {
    renderSurface();

    expect(canvasProps().minimumLaneWidth).toBe(160);
    expect(canvasProps().maximumVisibleLaneCount).toBe(7);
  });

  it('never renders provider sync state as calendar chrome', () => {
    renderSurface('dates', calendarItem(), '2026-07-13', {
      dateItemsError: true,
    });

    expect(document.querySelector('[data-calendar-status-row]')).toBeNull();
    expect(screen.queryByText(/sync conflict|sync error/i)).not.toBeInTheDocument();
  });

  it('renders exactly one schedule region and no side column beside it', () => {
    renderSurface();

    expect(screen.getAllByRole('region', { name: 'Schedule' })).toHaveLength(1);
    // Layer controls belong in the toolbar's popover; a permanent 16rem column that usually said
    // "No calendar layers yet." was costing the schedule a fifth of its width.
    expect(document.querySelector('aside')).toBeNull();
  });

  it.each(['push_pending', 'provider_error'] as const)(
    'keeps the %s provider state out of event blocks',
    (syncState) => {
      const source = { ...calendarItem(), syncState };
      renderSurface('dates', source);
      const props = canvasProps();
      const lane = assertDefined(props.lanes[0]);
      const content = props.renderItem?.({
        item: assertDefined(lane.items[0]),
        lane,
        allDay: false,
        density: 'full',
      });

      render(<div data-testid="full-item-content">{content}</div>);

      expect(screen.getByTestId('full-item-content').textContent).toBe(source.title);
      expect(screen.queryByText(/Saving…|Sync issue/)).not.toBeInTheDocument();
    },
  );

  it('gives a healthy card its whole line, with no per-card kind label', () => {
    // The kind label (`Block`, `Calendar event`) took a fixed 32px of a 154px card and never
    // truncated, while the title it sat beside was cut off at 98px. Chrome does not get to outrank
    // the content on the surface whose entire job is showing events.
    const source = { ...calendarItem(), syncState: 'clean' as const };
    renderSurface('dates', source);
    const props = canvasProps();
    const lane = assertDefined(props.lanes[0]);
    const content = props.renderItem?.({
      item: assertDefined(lane.items[0]),
      lane,
      allDay: false,
      density: 'full',
    });

    render(<div data-testid="full-item-content">{content}</div>);
    const fullContent = within(screen.getByTestId('full-item-content'));

    expect(fullContent.getByText(source.title)).toBeInTheDocument();
    expect(screen.getByTestId('full-item-content').textContent).toBe(source.title);
  });

  it('keeps sync metadata out of compact collided cards', () => {
    const source = { ...calendarItem(), syncState: 'provider_error' as const };
    renderSurface('dates', source);
    const props = canvasProps();
    const lane = assertDefined(props.lanes[0]);
    const content = props.renderItem?.({
      item: assertDefined(lane.items[0]),
      lane,
      allDay: false,
      density: 'compact',
    });

    render(<div data-testid="compact-item-content">{content}</div>);
    const compactContent = within(screen.getByTestId('compact-item-content'));

    expect(compactContent.getByText(source.title)).toBeInTheDocument();
    expect(compactContent.queryByText('Sync issue')).not.toBeInTheDocument();
  });

  describe('the renderItemAction extension point for the start-timer affordance', () => {
    // `CalendarItemCard` (which already grows a `TaskTimerButton` for a task-shaped item) is
    // never mounted by the live /calendar timeline — it renders through `SchedulingCanvas`
    // instead — so this surface has to reach the timer control through the generic canvas's
    // opt-in `renderItemAction` prop. These tests pin that wiring directly, the same way the
    // `renderItem` tests above call `canvasProps().renderItem` themselves.
    const LINKED_TASK = {
      taskId: TaskId.parse('01BX5ZZKBKACTAV9WEVGEMMVT1'),
      organizationId: OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVR1'),
      role: 'contained' as const,
      sort: 0,
      note: null,
      title: 'Draft the release notes',
      state: 'in_progress',
      done: false,
    };

    beforeEach(() => {
      activeGet.mockReset();
      recordsPost.mockReset();
      activeGet.mockResolvedValue(
        jsonResponse({
          record: null,
          serverNow: new Date().toISOString(),
          suggestion: null,
          activeAgentExecutions: [],
        }),
      );
    });

    it('renders the timer button for a first-class timebox item with a contained task link', async () => {
      // This is the shape the live app's own drag-a-task-onto-the-grid flow produces
      // (`onDropObjectOnGrid` below creates `intent: 'timebox'` then links with
      // `role: 'contained'`) — checking only the legacy `task_timebox` kind would leave this
      // control unreachable from every block the real UI creates.
      const source: CalendarItemOut = {
        ...calendarItem(),
        kind: 'timebox',
        linkedTasks: [LINKED_TASK],
      };
      renderSurface('dates', source);
      const props = canvasProps();
      const lane = assertDefined(props.lanes[0]);

      const action = props.renderItemAction?.({
        item: assertDefined(lane.items[0]),
        lane,
        allDay: false,
        density: 'full',
      });
      render(withTimerProviders(<div data-testid="action">{action}</div>));

      expect(await screen.findByTestId(`task-timer-${LINKED_TASK.taskId}`)).toBeInTheDocument();
    });

    it('renders the timer button for the legacy task_timebox item with a linked task', async () => {
      const source: CalendarItemOut = {
        ...calendarItem(),
        kind: 'task_timebox',
        linkedTasks: [LINKED_TASK],
      };
      renderSurface('dates', source);
      const props = canvasProps();
      const lane = assertDefined(props.lanes[0]);

      const action = props.renderItemAction?.({
        item: assertDefined(lane.items[0]),
        lane,
        allDay: false,
        density: 'full',
      });
      render(withTimerProviders(<div data-testid="action">{action}</div>));

      expect(await screen.findByTestId(`task-timer-${LINKED_TASK.taskId}`)).toBeInTheDocument();
    });

    it('renders no timer control for a non-task-shaped item, a task-shaped item with no linked task, or a link that is not contained', () => {
      renderSurface(); // default fixture is a plain native_event
      let props = canvasProps();
      let lane = assertDefined(props.lanes[0]);
      expect(
        props.renderItemAction?.({
          item: assertDefined(lane.items[0]),
          lane,
          allDay: false,
          density: 'full',
        }),
      ).toBeNull();

      cleanup();
      const timeboxNoTask: CalendarItemOut = {
        ...calendarItem(),
        kind: 'timebox',
        linkedTasks: [],
      };
      renderSurface('dates', timeboxNoTask);
      props = canvasProps();
      lane = assertDefined(props.lanes[0]);
      expect(
        props.renderItemAction?.({
          item: assertDefined(lane.items[0]),
          lane,
          allDay: false,
          density: 'full',
        }),
      ).toBeNull();

      cleanup();
      const relatedOnly: CalendarItemOut = {
        ...calendarItem(),
        kind: 'timebox',
        linkedTasks: [{ ...LINKED_TASK, role: 'related' }],
      };
      renderSurface('dates', relatedOnly);
      props = canvasProps();
      lane = assertDefined(props.lanes[0]);
      expect(
        props.renderItemAction?.({
          item: assertDefined(lane.items[0]),
          lane,
          allDay: false,
          density: 'full',
        }),
      ).toBeNull();
    });

    it('starts the linked task timer when clicked, without also opening the calendar item', async () => {
      recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
      const source: CalendarItemOut = {
        ...calendarItem(),
        kind: 'timebox',
        linkedTasks: [LINKED_TASK],
      };
      const { onOpenItem } = renderSurface('dates', source);
      const props = canvasProps();
      const lane = assertDefined(props.lanes[0]);
      const action = props.renderItemAction?.({
        item: assertDefined(lane.items[0]),
        lane,
        allDay: false,
        density: 'full',
      });
      render(withTimerProviders(<div data-testid="action">{action}</div>));

      const timerButton = await screen.findByTestId(`task-timer-${LINKED_TASK.taskId}`);
      fireEvent.click(timerButton);

      await waitFor(() => {
        expect(recordsPost).toHaveBeenCalledWith({
          json: { context: { label: LINKED_TASK.title, taskId: LINKED_TASK.taskId } },
        });
      });
      // Verifies there is nothing here for a stray click/drag to trigger: the calendar's own item
      // activation (`onOpenItem`) and the canvas's move/resize plumbing never fire from a click on
      // this control.
      expect(onOpenItem).not.toHaveBeenCalled();
      expect(mutationState.update.mutate).not.toHaveBeenCalled();
    });
  });

  it('forwards an arbitrary controlled region and its anchor ref to the scheduling canvas', () => {
    const selectedRegion: ScheduleRegionSelection = {
      lane: {
        id: 'date:2026-07-13',
        label: 'Mon, Jul 13',
        date: '2026-07-13',
        items: [],
      },
      startMinutes: 540,
      endMinutes: 600,
    };
    const selectedRegionAnchorRef = createRef<HTMLDivElement>();

    renderSurface('dates', calendarItem(), '2026-07-13', {
      selectedRegion,
      selectedRegionAnchorRef,
    });

    expect(canvasProps().selectedRegion).toBe(selectedRegion);
    expect(canvasProps().selectedRegionAnchorRef).toBe(selectedRegionAnchorRef);
  });

  it('converts exact LA move and both resize payloads through the display timezone', () => {
    renderSurface();
    const props = canvasProps();
    const item = assertDefined(assertDefined(props.lanes[0]).items[0]);
    const july13 = assertDefined(props.lanes[0]);
    const july14: ScheduleLane = { ...july13, id: 'date:2026-07-14', date: '2026-07-14' };

    act(() => {
      props.onMoveItem?.({
        item,
        fromLane: july13,
        toLane: july14,
        startMinutes: 600,
        endMinutes: 660,
      });
      props.onResizeItem?.({
        item,
        lane: july13,
        edge: 'start',
        startMinutes: 510,
        endMinutes: 600,
      });
      props.onResizeItem?.({
        item,
        lane: july13,
        edge: 'end',
        startMinutes: 540,
        endMinutes: 690,
      });
    });

    expect(mutationState.update.mutate.mock.calls).toEqual([
      [
        {
          itemId: ITEM_ID,
          patch: { startsAt: '2026-07-14T17:00:00Z', endsAt: '2026-07-14T18:00:00Z' },
        },
      ],
      [
        {
          itemId: ITEM_ID,
          patch: { startsAt: '2026-07-13T15:30:00Z', endsAt: '2026-07-13T17:00:00Z' },
        },
      ],
      [
        {
          itemId: ITEM_ID,
          patch: { startsAt: '2026-07-13T16:00:00Z', endsAt: '2026-07-13T18:30:00Z' },
        },
      ],
    ]);
  });

  it('opens authorized people details read-only without requesting the owned item endpoint', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { onOpenItem, onOpenSharedItem } = renderSurface('people');

    expect(canvasProps().onMoveItem).toBeUndefined();
    expect(canvasProps().onResizeItem).toBeUndefined();

    act(() => {
      const lane = assertDefined(canvasProps().lanes[0]);
      canvasProps().onOpenItem?.({ item: assertDefined(lane.items[0]), lane });
    });

    const dialog = screen.getByRole('dialog', { name: 'Shared detail' });
    expect(dialog).toHaveTextContent('Grace');
    expect(dialog).toHaveTextContent('Read-only');
    expect(dialog).toHaveTextContent('Native event');
    expect(dialog).toHaveTextContent('Jul 13, 2026');
    expect(dialog).not.toHaveTextContent('01BX5ZZKBKACTAV9WEVGEMMVN1');
    expect(dialog.querySelector('input, textarea, select')).toBeNull();
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onOpenSharedItem).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps busy-only people items opaque and non-openable', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { onOpenItem, onOpenSharedItem } = renderSurface('people');

    act(() => {
      const lane = assertDefined(canvasProps().lanes[0]);
      canvasProps().onOpenItem?.({ item: assertDefined(lane.items[1]), lane });
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onOpenSharedItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('disambiguates repeated-hour instants in shared read-only details', () => {
    render(
      <CalendarSharedItemDetails
        displayTimezone="America/Los_Angeles"
        onClose={vi.fn()}
        detail={{
          personName: 'Grace',
          personTimezone: 'America/Chicago',
          item: {
            access: 'details',
            itemId: ITEM_ID,
            layerId: LAYER_ID,
            kind: 'native_event',
            title: 'Fold planning',
            startsAt: '2026-11-01T08:30:00Z',
            endsAt: '2026-11-01T09:30:00Z',
            allDayStartDate: null,
            allDayEndDate: null,
          },
        }}
      />,
    );

    expect(screen.getByText(/1:30 AM PDT.*1:30 AM PST/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('2:30 AM');
  });

  it('formats cross-day shared details from exact Date values', () => {
    render(
      <CalendarSharedItemDetails
        displayTimezone="UTC"
        onClose={vi.fn()}
        detail={{
          personName: 'Grace',
          personTimezone: 'America/Chicago',
          item: {
            access: 'details',
            itemId: ITEM_ID,
            layerId: LAYER_ID,
            kind: 'native_event',
            title: 'Overnight planning',
            startsAt: '2026-07-13T23:30:00Z',
            endsAt: '2026-07-14T00:30:00Z',
            allDayStartDate: null,
            allDayEndDate: null,
          },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Jul 13, 2026');
    expect(dialog).toHaveTextContent('Jul 14, 2026');
    expect(dialog).not.toHaveTextContent('Shared time unavailable');
  });

  it('provides a visible close action in shared read-only details', () => {
    const onClose = vi.fn();
    render(
      <CalendarSharedItemDetails
        displayTimezone="UTC"
        onClose={onClose}
        detail={{
          personName: 'Grace',
          personTimezone: 'America/Chicago',
          item: {
            access: 'details',
            itemId: ITEM_ID,
            layerId: LAYER_ID,
            kind: 'native_event',
            title: 'Shared planning',
            startsAt: '2026-07-13T16:00:00Z',
            endsAt: '2026-07-13T17:00:00Z',
            allDayStartDate: null,
            allDayEndDate: null,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close shared calendar item' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves clipped timed items exactly and persists all-day edits only through date callbacks', () => {
    const multiDay = calendarItem();
    multiDay.startsAt = '2026-07-14T06:30:00Z';
    multiDay.endsAt = '2026-07-14T08:30:00Z';
    renderSurface('dates', multiDay);
    let props = canvasProps();
    let lane = assertDefined(props.lanes[0]);
    act(() => {
      props.onMoveItem?.({
        item: assertDefined(lane.items[0]),
        fromLane: lane,
        toLane: lane,
        startMinutes: 600,
        endMinutes: 660,
      });
    });
    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: {
        startsAt: '2026-07-13T17:00:00Z',
        endsAt: '2026-07-13T19:00:00Z',
      },
    });

    cleanup();
    mutationState.update.mutate.mockClear();
    const allDay = calendarItem();
    allDay.startsAt = null;
    allDay.endsAt = null;
    allDay.allDayStartDate = '2026-07-13';
    allDay.allDayEndDate = '2026-07-14';
    renderSurface('dates', allDay);
    props = canvasProps();
    lane = assertDefined(props.lanes[0]);
    act(() => {
      props.onResizeItem?.({
        item: assertDefined(lane.items[0]),
        lane,
        edge: 'end',
        startMinutes: 0,
        endMinutes: 600,
      });
    });
    expect(mutationState.update.mutate).not.toHaveBeenCalled();

    act(() => {
      props.onMoveAllDayItem?.({
        item: assertDefined(lane.items[0]),
        fromLane: lane,
        toLane: { ...lane, id: 'date:2026-07-14', date: '2026-07-14' },
        startDate: '2026-07-14',
        endDate: '2026-07-15',
      });
    });
    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: {
        allDayStartDate: '2026-07-14',
        allDayEndDate: '2026-07-15',
      },
    });
  });

  it('rejects all-day date callbacks when the source cannot be edited', () => {
    const allDay = calendarItem();
    allDay.startsAt = null;
    allDay.endsAt = null;
    allDay.allDayStartDate = '2026-07-13';
    allDay.allDayEndDate = '2026-07-14';
    allDay.permissions = {
      canEditCore: false,
      canDelete: false,
      readOnlyReason: 'provider_scope',
    };
    renderSurface('dates', allDay);
    const props = canvasProps();
    const lane = assertDefined(props.lanes[0]);

    act(() => {
      props.onMoveAllDayItem?.({
        item: assertDefined(lane.items[0]),
        fromLane: lane,
        toLane: { ...lane, id: 'date:2026-07-14', date: '2026-07-14' },
        startDate: '2026-07-14',
        endDate: '2026-07-15',
      });
    });

    expect(mutationState.update.mutate).not.toHaveBeenCalled();
  });

  it('resizes the true end segment of a cross-midnight item in place', () => {
    const overnight = calendarItem();
    overnight.startsAt = '2026-07-14T06:30:00Z';
    overnight.endsAt = '2026-07-14T08:30:00Z';
    renderSurface('dates', overnight, '2026-07-14');
    const props = canvasProps();
    const lane = assertDefined(props.lanes[0]);

    act(() => {
      props.onResizeItem?.({
        item: assertDefined(lane.items[0]),
        lane,
        edge: 'end',
        startMinutes: 0,
        endMinutes: 120,
      });
    });

    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: {
        startsAt: '2026-07-14T06:30:00Z',
        endsAt: '2026-07-14T09:00:00Z',
      },
    });
  });

  it('persists a valid move that ends exactly at the following local midnight', () => {
    const endingAtMidnight = calendarItem();
    endingAtMidnight.startsAt = '2026-07-14T05:00:00Z';
    endingAtMidnight.endsAt = '2026-07-14T06:00:00Z';
    renderSurface('dates', endingAtMidnight);
    const props = canvasProps();
    const lane = assertDefined(props.lanes[0]);

    act(() => {
      props.onMoveItem?.({
        item: assertDefined(lane.items[0]),
        fromLane: lane,
        toLane: lane,
        startMinutes: 23 * 60,
        endMinutes: 24 * 60,
      });
    });

    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: {
        startsAt: '2026-07-14T06:00:00Z',
        endsAt: '2026-07-14T07:00:00Z',
      },
    });
  });

  it('preserves a later-fold untouched start edge when resizing the end', () => {
    const laterFold = calendarItem();
    laterFold.startsAt = '2026-11-01T09:30:00Z';
    laterFold.endsAt = '2026-11-01T10:30:00Z';
    renderSurface('dates', laterFold, '2026-11-01');
    const props = canvasProps();
    const lane = assertDefined(props.lanes[0]);

    act(() => {
      props.onResizeItem?.({
        item: assertDefined(lane.items[0]),
        lane,
        edge: 'end',
        startMinutes: 90,
        endMinutes: 180,
      });
    });

    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: { startsAt: '2026-11-01T09:30:00Z', endsAt: '2026-11-01T11:00:00Z' },
    });
  });

  it('preserves the source occurrence for repeated-hour moves and rejects skipped resize edges', () => {
    const fold = calendarItem();
    fold.startsAt = '2026-11-01T09:30:00Z';
    fold.endsAt = '2026-11-01T10:30:00Z';
    renderSurface('dates', fold, '2026-11-01');
    let props = canvasProps();
    let lane = assertDefined(props.lanes[0]);
    act(() => {
      props.onMoveItem?.({
        item: assertDefined(lane.items[0]),
        fromLane: lane,
        toLane: lane,
        startMinutes: 75,
        endMinutes: 135,
      });
    });
    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      patch: { startsAt: '2026-11-01T09:15:00Z', endsAt: '2026-11-01T10:15:00Z' },
    });

    cleanup();
    mutationState.update.mutate.mockClear();
    const spring = calendarItem();
    spring.startsAt = '2026-03-08T09:00:00Z';
    spring.endsAt = '2026-03-08T10:00:00Z';
    renderSurface('dates', spring, '2026-03-08');
    props = canvasProps();
    lane = assertDefined(props.lanes[0]);
    act(() => {
      props.onResizeItem?.({
        item: assertDefined(lane.items[0]),
        lane,
        edge: 'start',
        startMinutes: 150,
        endMinutes: 180,
      });
    });
    expect(mutationState.update.mutate).not.toHaveBeenCalled();
  });

  it('rejects a repeated-hour move when an ordinary source supplies no occurrence', () => {
    const ordinary = calendarItem();
    ordinary.startsAt = '2026-11-01T07:30:00Z';
    ordinary.endsAt = '2026-11-01T08:00:00Z';
    renderSurface('dates', ordinary, '2026-11-01');
    const props = canvasProps();
    const lane = assertDefined(props.lanes[0]);

    act(() => {
      props.onMoveItem?.({
        item: assertDefined(lane.items[0]),
        fromLane: lane,
        toLane: lane,
        startMinutes: 90,
        endMinutes: 120,
      });
    });

    expect(mutationState.update.mutate).not.toHaveBeenCalled();
  });

  it('rejects skipped and repeated selection walls instead of inventing exact instants', () => {
    const { onSelectRegion } = renderSurface();
    let props = canvasProps();
    act(() => {
      props.onSelectRegion?.({
        lane: assertDefined(props.lanes[0]),
        startMinutes: 540,
        endMinutes: 600,
      });
    });
    expect(onSelectRegion).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: '2026-07-13T16:00:00Z',
        endsAt: '2026-07-13T17:00:00Z',
        canvasRegion: expect.objectContaining({
          lane: expect.objectContaining({ id: 'date:2026-07-13' }),
          startMinutes: 540,
          endMinutes: 600,
        }),
      }),
    );

    cleanup();
    const spring = renderSurface('dates', calendarItem(), '2026-03-08');
    props = canvasProps();
    act(() => {
      props.onSelectRegion?.({
        lane: assertDefined(props.lanes[0]),
        startMinutes: 150,
        endMinutes: 180,
      });
    });
    expect(spring.onSelectRegion).not.toHaveBeenCalled();

    cleanup();
    const fold = renderSurface('dates', calendarItem(), '2026-11-01');
    props = canvasProps();
    act(() => {
      props.onSelectRegion?.({
        lane: assertDefined(props.lanes[0]),
        startMinutes: 90,
        endMinutes: 150,
      });
    });
    expect(fold.onSelectRegion).not.toHaveBeenCalled();
  });

  it('clears stale mutation failures before a different relationship action', () => {
    renderSurface();
    mutationState.update.reset.mockClear();
    mutationState.link.reset.mockClear();
    mutationState.relate.reset.mockClear();
    const props = canvasProps();
    act(() => {
      props.onDropObjectOnItem?.({
        object: {
          kind: 'task',
          taskId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
          organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
          title: 'Draft launch memo',
        },
        targetItem: assertDefined(assertDefined(props.lanes[0]).items[0]),
        targetLane: assertDefined(props.lanes[0]),
      });
    });

    expect(mutationState.update.reset).toHaveBeenCalledOnce();
    expect(mutationState.link.reset).toHaveBeenCalledOnce();
    expect(mutationState.relate.reset).toHaveBeenCalledOnce();
    expect(mutationState.link.mutate).toHaveBeenCalledOnce();
  });

  it('rejects derived relationship targets and calendar-item self drops', () => {
    const derived = calendarItem();
    derived.kind = 'availability_block';
    renderSurface('dates', derived);
    let props = canvasProps();
    act(() => {
      props.onDropObjectOnItem?.({
        object: {
          kind: 'task',
          taskId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
          organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
          title: 'Draft launch memo',
        },
        targetItem: assertDefined(assertDefined(props.lanes[0]).items[0]),
        targetLane: assertDefined(props.lanes[0]),
      });
    });
    expect(mutationState.link.mutate).not.toHaveBeenCalled();

    cleanup();
    renderSurface();
    props = canvasProps();
    act(() => {
      props.onDropObjectOnItem?.({
        object: { kind: 'calendar_item', itemId: ITEM_ID, title: 'Planning session' },
        targetItem: assertDefined(assertDefined(props.lanes[0]).items[0]),
        targetLane: assertDefined(props.lanes[0]),
      });
    });
    expect(mutationState.relate.mutate).not.toHaveBeenCalled();
  });

  it.each(['update', 'link', 'relate'] as const)(
    'keeps the grid, lane, and item mounted under fixed safe %s failure copy',
    (failure) => {
      mutationState[failure].isError = true;
      mutationState[failure].error = new Error('Provider exploded with secret token hostile-42');

      renderSurface();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not update this item. Your previous time has been restored.',
      );
      expect(screen.queryByText(/hostile-42/i)).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.getByLabelText('Mon, Jul 13 lane')).toBeInTheDocument();
      expect(screen.getByText('Planning session')).toBeInTheDocument();
    },
  );
});
