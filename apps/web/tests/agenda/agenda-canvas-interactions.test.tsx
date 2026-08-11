import '@testing-library/jest-dom/vitest';

import {
  CalendarItemId,
  type CalendarItemOut,
  CalendarLayerId,
  DailyPlanItemId,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgendaEntry } from '../../src/components/agenda/agenda-model';
import type * as SchedulingModule from '../../src/components/scheduling';
import type { SchedulingCanvasProps } from '../../src/components/scheduling';
import type { CreateBlockFormProps } from '../../src/components/calendar/create-block-form';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const mediaState = vi.hoisted(() => ({ isDesktop: true }));
const canvas = vi.hoisted<{ props: SchedulingCanvasProps | undefined }>(() => ({
  props: undefined,
}));
const quickCreate = vi.hoisted<{ props: CreateBlockFormProps | undefined }>(() => ({
  props: undefined,
}));
const agendaState = vi.hoisted<{
  date: string;
  displayTimezone: string;
  pixelsPerHour: number;
  view: 'timeline' | 'list';
  entries: unknown[];
  setTimebox: ReturnType<typeof vi.fn>;
  clearTimeboxFailure: ReturnType<typeof vi.fn>;
  registerNavigationGuard: ReturnType<typeof vi.fn>;
  timeboxFailed: boolean;
}>(() => ({
  date: '2026-07-13',
  displayTimezone: 'America/Los_Angeles',
  pixelsPerHour: 72,
  view: 'timeline',
  entries: [],
  setTimebox: vi.fn(),
  clearTimeboxFailure: vi.fn(),
  registerNavigationGuard: vi.fn(() => () => undefined),
  timeboxFailed: false,
}));
const mutationState = vi.hoisted(() => ({
  update: { mutate: vi.fn(), reset: vi.fn(), isError: false, error: null as Error | null },
  link: { mutate: vi.fn(), reset: vi.fn(), isError: false, error: null as Error | null },
  relate: { mutate: vi.fn(), reset: vi.fn(), isError: false, error: null as Error | null },
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@docket/ui/hooks', () => ({ useMediaQuery: () => mediaState.isDesktop }));

vi.mock('../../src/components/agenda/agenda-context', () => ({
  isTimeboxed: (entry: { startsAt?: string; endsAt?: string }) =>
    entry.startsAt != null && entry.endsAt != null,
  shiftISODate: (date: string, days: number) => {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  },
  useAgenda: () => agendaState,
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
                <article key={item.id} data-agenda-item={item.id}>
                  <button
                    type="button"
                    aria-label={`Open ${item.title}`}
                    onClick={() => props.onOpenItem?.({ item, lane })}
                  >
                    {item.title}
                  </button>
                  {item.editable && (item.allDay ? props.onMoveAllDayItem : props.onMoveItem) ? (
                    <button type="button" aria-label={`Move ${item.title}`}>
                      Move
                    </button>
                  ) : null}
                  {item.editable &&
                  (item.allDay ? props.onResizeAllDayItem : props.onResizeItem) ? (
                    <button type="button" aria-label={`Resize ${item.title}`}>
                      Resize
                    </button>
                  ) : null}
                </article>
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
}));

vi.mock('../../src/components/calendar/calendar-item-drawer', () => ({
  default: ({ itemId }: { itemId: string | null }) =>
    itemId ? <div aria-label="Calendar item drawer">{itemId}</div> : null,
}));

vi.mock('../../src/components/calendar/create-block-form', () => ({
  default: (props: CreateBlockFormProps) => {
    quickCreate.props = props;
    return props.selection ? <div aria-label="Agenda quick create">Draft open</div> : null;
  },
}));

vi.mock('../../src/components/agenda/agenda-entry-card', () => ({
  default: () => <div>Agenda list item</div>,
}));

import AgendaCanvas from '../../src/components/agenda/agenda-canvas';

const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const TASK_ID = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0');
const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const PLAN_ITEM_ID = DailyPlanItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS9');

/** Build one normalized calendar item for Agenda consumer-policy tests. */
function calendarItem(
  id: string,
  title: string,
  overrides: Partial<CalendarItemOut> = {},
): CalendarItemOut {
  return {
    id: CalendarItemId.parse(id),
    layerId: LAYER_ID,
    connectionId: null,
    kind: 'provider_event',
    provider: 'google',
    externalCalendarId: 'primary',
    externalEventId: `external-${id}`,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title,
    description: null,
    location: null,
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
    ...overrides,
  };
}

/** Attach a normalized calendar item to the portable Agenda entry model. */
function calendarEntry(item: CalendarItemOut, sort = 0): AgendaEntry {
  return {
    id: item.id,
    source: 'calendar_item',
    title: item.title,
    startsAt: item.startsAt ?? undefined,
    endsAt: item.endsAt ?? undefined,
    sort,
    done: false,
    calendarItem: item,
    layerColor: '#2563eb',
  };
}

/** Build one editable daily-plan timebox. */
function planTimebox(): AgendaEntry {
  return {
    id: TASK_ID,
    source: 'task',
    taskId: TASK_ID,
    organizationId: ORG_ID,
    planItemId: PLAN_ITEM_ID,
    title: 'Draft launch memo',
    startsAt: '2026-07-13T16:00:00Z',
    endsAt: '2026-07-13T17:00:00Z',
    sort: 0,
    done: false,
  };
}

/** Render one timeline arrangement with a deterministic context. */
function renderTimeline(entries: readonly AgendaEntry[]): void {
  agendaState.entries = [...entries];
  render(<AgendaCanvas />);
}

/** Return the latest props received by the callback-driven scheduling canvas mock. */
function canvasProps(): SchedulingCanvasProps {
  return canvas.props!;
}

beforeEach(() => {
  canvas.props = undefined;
  mediaState.isDesktop = true;
  quickCreate.props = undefined;
  agendaState.date = '2026-07-13';
  agendaState.entries = [];
  agendaState.view = 'timeline';
  agendaState.setTimebox.mockReset();
  agendaState.clearTimeboxFailure.mockReset();
  agendaState.registerNavigationGuard.mockReset().mockImplementation(() => () => undefined);
  agendaState.timeboxFailed = false;
  router.push.mockReset();
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
});

afterEach(() => {
  cleanup();
});

describe('Agenda scheduling interactions', () => {
  it('projects a click-or-drag time selection and opens one local quick-create draft', () => {
    renderTimeline([]);
    const props = canvasProps();
    const lane = props.lanes[0]!;

    act(() => {
      props.onSelectRegion?.({ lane, startMinutes: 9 * 60, endMinutes: 9 * 60 + 30 });
    });

    expect(props.onSelectRegion).toBeDefined();
    expect(canvasProps().selectedRegion).toMatchObject({
      startMinutes: 540,
      endMinutes: 570,
    });
    expect(screen.getByLabelText('Agenda quick create')).toBeInTheDocument();
    expect(quickCreate.props?.selection).toEqual({
      startsAt: '2026-07-13T16:00:00Z',
      endsAt: '2026-07-13T16:30:00Z',
    });
    expect(quickCreate.props?.presentation).toBe('agenda');
    expect(quickCreate.props?.trigger).toBe('hidden');
    expect(quickCreate.props?.selectionAnchorRef).toBe(canvasProps().selectedRegionAnchorRef);
  });

  it('keeps the controlled draft callback stable while projecting edited bounds', () => {
    renderTimeline([]);
    const lane = canvasProps().lanes[0]!;

    act(() => {
      canvasProps().onSelectRegion?.({ lane, startMinutes: 9 * 60, endMinutes: 9 * 60 + 30 });
    });

    const initialDraftChange = quickCreate.props?.onDraftChange;
    expect(initialDraftChange).toBeDefined();
    act(() => {
      initialDraftChange?.({
        startsAt: '2026-07-13T16:10:00Z',
        endsAt: '2026-07-13T16:40:00Z',
      });
    });

    expect(quickCreate.props?.onDraftChange).toBe(initialDraftChange);
    expect(canvasProps().selectedRegion).toMatchObject({
      startMinutes: 550,
      endMinutes: 580,
    });
  });

  it('opens an all-day draft for the selected Agenda date', () => {
    renderTimeline([]);
    const props = canvasProps();
    const lane = props.lanes[0]!;
    const anchor = document.createElement('button');

    act(() => {
      props.onSelectAllDayRegion?.(lane, anchor);
    });

    expect(props.onSelectAllDayRegion).toBeDefined();
    expect(quickCreate.props?.selection).toEqual({
      allDayStartDate: '2026-07-13',
      allDayEndDate: '2026-07-14',
    });
    expect(quickCreate.props?.selectionAnchorRef?.current).toBe(anchor);
  });

  it('replaces the mobile timeline with an Agenda-owned sibling create host', () => {
    mediaState.isDesktop = false;
    renderTimeline([]);
    const props = canvasProps();
    const lane = props.lanes[0]!;

    act(() => {
      props.onSelectRegion?.({ lane, startMinutes: 9 * 60, endMinutes: 9 * 60 + 30 });
    });

    const host = document.querySelector<HTMLElement>('[data-agenda-create-host]');
    expect(host).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(quickCreate.props?.agendaMobileHost).toBe(host);
  });

  it('keeps the list view informative when the day has no entries', () => {
    agendaState.view = 'list';
    render(<AgendaCanvas />);

    // The instruction became a control. `Use the calendar to plan this day` named a destination
    // and then left the reader to find it, which is a dead empty state.
    expect(screen.getByRole('status')).toHaveTextContent('Nothing scheduled.');
    expect(screen.getByRole('link', { name: 'Plan in the calendar' })).toHaveAttribute(
      'href',
      '/calendar',
    );
  });

  it('teaches the next action when the timeline has no entries', () => {
    render(<AgendaCanvas />);

    // The sentence used to carry the whole instruction — `Use the calendar to plan this day` —
    // which named a destination and left the reader to go find it. The action is a control now,
    // so the prose only has to state the situation.
    expect(canvasProps().emptyMessage).toBe('Nothing scheduled.');
    expect(canvasProps().emptyAction).not.toBeNull();
  });

  it('converts a Jul 13 plan timebox proposal through the LA display timezone', () => {
    const entry = planTimebox();
    renderTimeline([entry]);
    const props = canvasProps();
    const lane = props.lanes[0]!;

    act(() => {
      props.onMoveItem?.({
        item: lane.items[0]!,
        fromLane: lane,
        toLane: lane,
        startMinutes: 540,
        endMinutes: 600,
      });
    });

    expect(agendaState.setTimebox).toHaveBeenCalledWith(
      entry,
      '2026-07-13T16:00:00Z',
      '2026-07-13T17:00:00Z',
    );
    expect(mutationState.update.mutate).not.toHaveBeenCalled();
  });

  it('uses the shared policy for writable, provider-denied, conflict, and derived items', () => {
    const entries = [
      calendarEntry(
        calendarItem('01BX5ZZKBKACTAV9WEVGEMMVA1', 'Native event', {
          kind: 'native_event',
          provider: null,
        }),
      ),
      calendarEntry(calendarItem('01BX5ZZKBKACTAV9WEVGEMMVA2', 'Provider event')),
      calendarEntry(
        calendarItem('01BX5ZZKBKACTAV9WEVGEMMVA3', 'Timebox', {
          kind: 'timebox',
          provider: null,
        }),
      ),
      calendarEntry(
        calendarItem('01BX5ZZKBKACTAV9WEVGEMMVA4', 'Provider read only', {
          permissions: {
            canEditCore: false,
            canDelete: false,
            readOnlyReason: 'provider_scope',
          },
        }),
      ),
      calendarEntry(calendarItem('01BX5ZZKBKACTAV9WEVGEMMVA5', 'Conflict', { hasConflict: true })),
      calendarEntry(
        calendarItem('01BX5ZZKBKACTAV9WEVGEMMVA6', 'Derived task timebox', {
          kind: 'task_timebox',
          provider: null,
        }),
      ),
      calendarEntry(
        calendarItem('01BX5ZZKBKACTAV9WEVGEMMVA7', 'Availability', {
          kind: 'availability_block',
          provider: null,
        }),
      ),
    ];

    renderTimeline(entries);

    const editable = new Map(
      canvasProps().lanes[0]!.items.map((item) => [item.title, item.editable]),
    );
    expect(editable).toEqual(
      new Map([
        ['Native event', true],
        ['Provider event', true],
        ['Timebox', true],
        ['Provider read only', false],
        ['Conflict', false],
        ['Derived task timebox', false],
        ['Availability', false],
      ]),
    );
    const readOnlyLabels = new Map(
      canvasProps().lanes[0]!.items.map((item) => [
        item.title,
        (item as typeof item & { readonly readOnlyLabel?: string }).readOnlyLabel,
      ]),
    );
    expect(readOnlyLabels).toEqual(
      new Map([
        ['Native event', undefined],
        ['Provider event', undefined],
        ['Timebox', undefined],
        ['Provider read only', 'Read-only'],
        ['Conflict', 'Read-only'],
        ['Derived task timebox', undefined],
        ['Availability', undefined],
      ]),
    );
  });

  it('moves a writable cross-midnight provider item through its exact calendar PATCH path', () => {
    const item = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVB1', 'Overnight provider event', {
      startsAt: '2026-07-14T06:30:00Z',
      endsAt: '2026-07-14T08:30:00Z',
    });
    renderTimeline([calendarEntry(item)]);
    const scheduleItem = canvasProps().lanes[0]!.items[0]!;

    expect(scheduleItem).toMatchObject({
      editable: true,
      dropTarget: true,
      readOnlyLabel: undefined,
    });

    act(() => {
      const props = canvasProps();
      const lane = props.lanes[0]!;
      props.onMoveItem?.({
        item: lane.items[0]!,
        fromLane: lane,
        toLane: lane,
        startMinutes: 540,
        endMinutes: 600,
      });
    });
    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: item.id,
      patch: {
        startsAt: '2026-07-13T16:00:00Z',
        endsAt: '2026-07-13T18:00:00Z',
      },
    });
  });

  it('keeps single-day all-day items useful without exposing inert date controls', () => {
    const item = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVB2', 'Provider offsite', {
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-07-13',
      allDayEndDate: '2026-07-14',
    });
    renderTimeline([calendarEntry(item)]);
    const props = canvasProps();
    const lane = props.lanes[0]!;
    const scheduleItem = lane.items[0]!;

    expect(scheduleItem).toMatchObject({
      allDay: true,
      editable: false,
      dropTarget: true,
      readOnlyLabel: undefined,
      dragObject: {
        kind: 'calendar_item',
        itemId: item.id,
        title: item.title,
      },
    });
    expect(props.onMoveAllDayItem).toBeUndefined();
    expect(props.onResizeAllDayItem).toBeUndefined();
    expect(screen.queryByRole('button', { name: `Move ${item.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Resize ${item.title}` })).not.toBeInTheDocument();

    act(() => {
      props.onDropObjectOnItem?.({
        object: {
          kind: 'task',
          taskId: TASK_ID,
          organizationId: ORG_ID,
          title: 'Draft launch memo',
        },
        targetItem: scheduleItem,
        targetLane: lane,
      });
    });
    expect(mutationState.link.mutate).toHaveBeenCalledWith({
      itemId: item.id,
      taskId: TASK_ID,
      organizationId: ORG_ID,
      role: 'related',
    });
    fireEvent.click(screen.getByRole('button', { name: `Open ${item.title}` }));
    expect(screen.getByLabelText('Calendar item drawer')).toHaveTextContent(item.id);
  });

  it('keeps malformed items read-only while allowing exact repeated-fold bounds', () => {
    renderTimeline([
      calendarEntry(
        calendarItem('01BX5ZZKBKACTAV9WEVGEMMVC1', 'Malformed', { startsAt: 'hostile' }),
      ),
      calendarEntry(
        calendarItem('01BX5ZZKBKACTAV9WEVGEMMVC2', 'Fold crossing', {
          startsAt: '2026-11-01T08:45:00Z',
          endsAt: '2026-11-01T09:15:00Z',
        }),
      ),
    ]);

    expect(canvasProps().lanes[0]!.items.map((item) => item.editable)).toEqual([false, true]);
  });

  it('preserves exact elapsed duration when moving across the fall-back transition', () => {
    const crossingFold = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVC3', 'Crossing fold', {
      startsAt: '2026-11-01T07:30:00Z',
      endsAt: '2026-11-01T09:30:00Z',
    });
    agendaState.date = '2026-11-01';
    renderTimeline([calendarEntry(crossingFold)]);
    const props = canvasProps();
    const lane = props.lanes[0]!;

    act(() => {
      props.onMoveItem?.({
        item: lane.items[0]!,
        fromLane: lane,
        toLane: lane,
        startMinutes: 45,
        endMinutes: 165,
      });
    });

    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: crossingFold.id,
      patch: { startsAt: '2026-11-01T07:45:00Z', endsAt: '2026-11-01T09:45:00Z' },
    });
  });

  it('preserves a later-fold untouched edge and rejects a skipped changed edge', () => {
    const laterFold = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVD1', 'Later fold', {
      startsAt: '2026-11-01T09:30:00Z',
      endsAt: '2026-11-01T10:30:00Z',
    });
    agendaState.date = '2026-11-01';
    renderTimeline([calendarEntry(laterFold)]);
    let props = canvasProps();
    let lane = props.lanes[0]!;
    act(() => {
      props.onResizeItem?.({
        item: lane.items[0]!,
        lane,
        edge: 'end',
        startMinutes: 90,
        endMinutes: 180,
      });
    });
    expect(mutationState.update.mutate).toHaveBeenCalledWith({
      itemId: laterFold.id,
      patch: { startsAt: '2026-11-01T09:30:00Z', endsAt: '2026-11-01T11:00:00Z' },
    });

    cleanup();
    mutationState.update.mutate.mockReset();
    const spring = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVD2', 'Spring gap', {
      startsAt: '2026-03-08T09:00:00Z',
      endsAt: '2026-03-08T10:00:00Z',
    });
    agendaState.date = '2026-03-08';
    renderTimeline([calendarEntry(spring)]);
    props = canvasProps();
    lane = props.lanes[0]!;
    act(() => {
      props.onResizeItem?.({
        item: lane.items[0]!,
        lane,
        edge: 'start',
        startMinutes: 150,
        endMinutes: 180,
      });
    });
    expect(mutationState.update.mutate).not.toHaveBeenCalled();
  });

  it('rejects ambiguous Agenda moves and resize edges instead of choosing a fold occurrence', () => {
    const ordinary = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVD3', 'Before fold', {
      startsAt: '2026-11-01T07:30:00Z',
      endsAt: '2026-11-01T07:50:00Z',
    });
    agendaState.date = '2026-11-01';
    renderTimeline([calendarEntry(ordinary)]);
    const props = canvasProps();
    const lane = props.lanes[0]!;

    act(() => {
      props.onMoveItem?.({
        item: lane.items[0]!,
        fromLane: lane,
        toLane: lane,
        startMinutes: 60,
        endMinutes: 80,
      });
      props.onResizeItem?.({
        item: lane.items[0]!,
        lane,
        edge: 'end',
        startMinutes: 30,
        endMinutes: 60,
      });
    });

    expect(mutationState.update.mutate).not.toHaveBeenCalled();
  });

  it('clears every stale inline failure before a plan timebox write', () => {
    const entry = planTimebox();
    renderTimeline([entry]);
    agendaState.clearTimeboxFailure.mockClear();
    mutationState.update.reset.mockClear();
    mutationState.link.reset.mockClear();
    mutationState.relate.reset.mockClear();
    const props = canvasProps();
    const lane = props.lanes[0]!;

    act(() => {
      props.onMoveItem?.({
        item: lane.items[0]!,
        fromLane: lane,
        toLane: lane,
        startMinutes: 600,
        endMinutes: 660,
      });
    });

    expect(agendaState.clearTimeboxFailure).toHaveBeenCalledOnce();
    expect(mutationState.update.reset).toHaveBeenCalledOnce();
    expect(mutationState.link.reset).toHaveBeenCalledOnce();
    expect(mutationState.relate.reset).toHaveBeenCalledOnce();
    expect(agendaState.setTimebox).toHaveBeenCalledWith(
      entry,
      '2026-07-13T17:00:00Z',
      '2026-07-13T18:00:00Z',
    );
  });

  it('rejects derived relationship targets and calendar-item self drops', () => {
    const derived = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVE1', 'Availability', {
      kind: 'availability_block',
      provider: null,
    });
    renderTimeline([calendarEntry(derived)]);
    let props = canvasProps();
    act(() => {
      props.onDropObjectOnItem?.({
        object: {
          kind: 'task',
          taskId: TASK_ID,
          organizationId: ORG_ID,
          title: 'Draft launch memo',
        },
        targetItem: props.lanes[0]!.items[0]!,
        targetLane: props.lanes[0]!,
      });
    });
    expect(mutationState.link.mutate).not.toHaveBeenCalled();

    cleanup();
    const target = calendarItem('01BX5ZZKBKACTAV9WEVGEMMVE2', 'Provider event');
    renderTimeline([calendarEntry(target)]);
    props = canvasProps();
    act(() => {
      props.onDropObjectOnItem?.({
        object: { kind: 'calendar_item', itemId: target.id, title: target.title },
        targetItem: props.lanes[0]!.items[0]!,
        targetLane: props.lanes[0]!,
      });
    });
    expect(mutationState.relate.mutate).not.toHaveBeenCalled();
  });

  it.each(['timebox', 'calendar', 'link', 'relate'] as const)(
    'keeps the axis, lane, and item mounted under fixed safe %s failure copy',
    (failure) => {
      const hostile = new Error('Provider leaked hostile payload calendar-secret-7');
      if (failure === 'timebox') agendaState.timeboxFailed = true;
      if (failure === 'calendar') {
        mutationState.update.isError = true;
        mutationState.update.error = hostile;
      }
      if (failure === 'link') {
        mutationState.link.isError = true;
        mutationState.link.error = hostile;
      }
      if (failure === 'relate') {
        mutationState.relate.isError = true;
        mutationState.relate.error = hostile;
      }

      renderTimeline([planTimebox()]);

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not update this item. Your previous time has been restored.',
      );
      expect(screen.queryByText(/calendar-secret-7/i)).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Schedule' })).toBeInTheDocument();
      expect(screen.getByLabelText('Mon, Jul 13 lane')).toBeInTheDocument();
      expect(screen.getByText('Draft launch memo')).toBeInTheDocument();
    },
  );
});
