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

const router = vi.hoisted(() => ({ push: vi.fn() }));
const canvas = vi.hoisted<{ props: SchedulingCanvasProps | undefined }>(() => ({
  props: undefined,
}));
const agendaState = vi.hoisted(() => ({
  date: '2026-07-13',
  displayTimezone: 'America/Los_Angeles',
  pixelsPerHour: 72,
  view: 'timeline' as const,
  entries: [] as unknown[],
  setTimebox: vi.fn(),
  timeboxFailed: false,
}));
const mutationState = vi.hoisted(() => ({
  update: { mutate: vi.fn(), isError: false, error: null as Error | null },
  link: { mutate: vi.fn(), isError: false, error: null as Error | null },
  relate: { mutate: vi.fn(), isError: false, error: null as Error | null },
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('../../src/components/agenda/agenda-context', () => ({
  isTimeboxed: (entry: { startsAt?: string; endsAt?: string }) =>
    entry.startsAt != null && entry.endsAt != null,
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
                  {item.editable && props.onMoveItem ? (
                    <button type="button" aria-label={`Move ${item.title}`}>
                      Move
                    </button>
                  ) : null}
                  {item.editable && props.onResizeItem ? (
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
  agendaState.date = '2026-07-13';
  agendaState.entries = [];
  agendaState.setTimebox.mockReset();
  agendaState.timeboxFailed = false;
  router.push.mockReset();
  mutationState.update.mutate.mockReset();
  mutationState.update.isError = false;
  mutationState.update.error = null;
  mutationState.link.mutate.mockReset();
  mutationState.link.isError = false;
  mutationState.link.error = null;
  mutationState.relate.mutate.mockReset();
  mutationState.relate.isError = false;
  mutationState.relate.error = null;
});

afterEach(() => {
  cleanup();
});

describe('Agenda scheduling interactions', () => {
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
  });

  it.each([
    {
      label: 'multi-day',
      item: calendarItem('01BX5ZZKBKACTAV9WEVGEMMVB1', 'Overnight provider event', {
        startsAt: '2026-07-14T06:30:00Z',
        endsAt: '2026-07-14T08:30:00Z',
      }),
    },
    {
      label: 'all-day',
      item: calendarItem('01BX5ZZKBKACTAV9WEVGEMMVB2', 'Provider offsite', {
        startsAt: null,
        endsAt: null,
        allDayStartDate: '2026-07-13',
        allDayEndDate: '2026-07-14',
      }),
    },
  ])('keeps a $label provider item openable and drop-capable without a PATCH path', ({ item }) => {
    renderTimeline([calendarEntry(item)]);
    const scheduleItem = canvasProps().lanes[0]!.items[0]!;

    expect(scheduleItem).toMatchObject({ editable: false, dropTarget: true });
    expect(screen.queryByRole('button', { name: `Move ${item.title}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Resize ${item.title}` })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Open ${item.title}` }));

    expect(screen.getByLabelText('Calendar item drawer')).toHaveTextContent(item.id);

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
      props.onResizeItem?.({
        item: lane.items[0]!,
        lane,
        edge: 'end',
        startMinutes: 540,
        endMinutes: 600,
      });
    });
    expect(mutationState.update.mutate).not.toHaveBeenCalled();
  });

  it('keeps malformed and repeated-fold-crossing items read-only', () => {
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

    expect(canvasProps().lanes[0]!.items.map((item) => item.editable)).toEqual([false, false]);
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
