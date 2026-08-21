/**
 * Behavior tests for {@link import('../../src/components/calendar/calendar-item-card')}.
 *
 * @remarks
 * Pins the contract other Task 9 surfaces (the full calendar timeline, the agenda rail's
 * `calendar_item` seam) depend on:
 *
 * - every item kind renders through the same card, with a kind-appropriate label;
 * - a read-only item (`permissions.canEditCore: false`) never renders a drag/resize handle, but
 *   does surface a labeled read-only indicator instead of silently doing nothing;
 * - an editable item renders the move handle (and, in `block` layout, the resize handle) when the
 *   caller supplies the corresponding gesture callback;
 * - clicking the card's body calls `onOpen` with the item id;
 * - a non-`clean` sync state (and a conflict) surfaces a labeled badge;
 * - a `task_timebox` with a linked task grows the {@link TaskTimerButton}, and clicking it
 *   starts that task's timer without also calling `onOpen` (the "open" button and the timer
 *   button are siblings, not nested, so there is nothing to stop-propagate against — but a
 *   regression that nested them would make one click do both).
 */
import '@testing-library/jest-dom/vitest';

import {
  CalendarItemId,
  type CalendarItemKind,
  type CalendarItemOut,
  CalendarLayerId,
  type CalendarLayerOut,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, recordsPost } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
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

const { default: CalendarItemCard } = await import('@/components/calendar/calendar-item-card');

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');

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

/** A minimal calendar-item fixture, defaulting to an editable native block. */
function makeItem(overrides: Partial<CalendarItemOut> = {}): CalendarItemOut {
  return {
    id: ITEM_ID,
    layerId: LAYER_ID,
    connectionId: null,
    kind: 'native_block',
    provider: null,
    externalCalendarId: null,
    externalEventId: null,
    recurringEventId: null,
    recurrenceInstanceKey: null,
    status: 'confirmed',
    title: 'Focus block',
    description: null,
    location: null,
    workPlaceId: null,
    htmlLink: null,
    startsAt: '2026-07-01T16:00:00.000Z',
    endsAt: '2026-07-01T17:00:00.000Z',
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
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A minimal calendar-layer fixture. */
function makeLayer(overrides: Partial<CalendarLayerOut> = {}): CalendarLayerOut {
  return {
    id: LAYER_ID,
    connectionId: null,
    provider: null,
    sourceKind: 'native_blocks',
    externalLayerId: null,
    title: 'My blocks',
    description: null,
    timezone: null,
    color: '#16a34a',
    accessRole: null,
    primary: false,
    selected: true,
    visibleByDefault: true,
    editableCore: true,
    lastSyncedAt: null,
    lastError: null,
    watchExpiresAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('CalendarItemCard', () => {
  it.each<[CalendarItemKind, string]>([
    ['provider_event', 'Provider event'],
    ['native_block', 'Block'],
    ['task_timebox', 'Timebox'],
    ['availability_block', 'Availability'],
  ])('renders a %s item with its kind label', (kind, label) => {
    render(<CalendarItemCard item={makeItem({ kind })} layer={makeLayer()} onOpen={vi.fn()} />);
    expect(screen.getByText('Focus block')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
  });

  it('calls onOpen with the item id when the card body is activated', () => {
    const onOpen = vi.fn();
    render(<CalendarItemCard item={makeItem()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Focus block/ }));
    expect(onOpen).toHaveBeenCalledWith(ITEM_ID);
  });

  it('renders no drag/resize handles and a labeled read-only indicator when canEditCore is false', () => {
    render(
      <CalendarItemCard
        item={makeItem({
          permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'provider_scope' },
        })}
        layout="block"
        onOpen={vi.fn()}
        onDragHandlePointerDown={vi.fn()}
        onResizeHandlePointerDown={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Move' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resize' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Read-only/)).toBeInTheDocument();
  });

  it('renders the move handle when editable and a drag callback is supplied', () => {
    const onDrag = vi.fn();
    render(
      <CalendarItemCard item={makeItem()} onOpen={vi.fn()} onDragHandlePointerDown={onDrag} />,
    );
    const handle = screen.getByRole('button', { name: 'Move' });
    fireEvent.pointerDown(handle);
    expect(onDrag).toHaveBeenCalledWith(ITEM_ID, expect.anything());
  });

  it('renders the resize handle only in block layout when editable and a resize callback is supplied', () => {
    const onResize = vi.fn();
    const { rerender } = render(
      <CalendarItemCard
        item={makeItem()}
        layout="row"
        onOpen={vi.fn()}
        onResizeHandlePointerDown={onResize}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Resize' })).not.toBeInTheDocument();

    rerender(
      <CalendarItemCard
        item={makeItem()}
        layout="block"
        onOpen={vi.fn()}
        onResizeHandlePointerDown={onResize}
      />,
    );
    const handle = screen.getByRole('button', { name: 'Resize' });
    fireEvent.pointerDown(handle);
    expect(onResize).toHaveBeenCalledWith(ITEM_ID, expect.anything());
  });

  it('keeps provider sync state out of the item card', () => {
    render(<CalendarItemCard item={makeItem({ syncState: 'provider_error' })} onOpen={vi.fn()} />);
    expect(screen.queryByLabelText('Sync failed')).not.toBeInTheDocument();
  });

  it('keeps provider conflict state out of the item card', () => {
    render(
      <CalendarItemCard
        item={makeItem({ syncState: 'local_dirty', hasConflict: true })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Conflict')).not.toBeInTheDocument();
  });

  it('shows no sync badge for a clean, non-conflicted item', () => {
    render(<CalendarItemCard item={makeItem()} onOpen={vi.fn()} />);
    expect(screen.queryByLabelText('Conflict')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sync failed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Syncing…')).not.toBeInTheDocument();
  });

  describe('the track-timer affordance every task surface must offer', () => {
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

    it('renders for a task_timebox with a linked task, and starts that task without opening the item', async () => {
      recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
      const onOpen = vi.fn();
      render(
        withTimerProviders(
          <CalendarItemCard
            item={makeItem({ kind: 'task_timebox', linkedTasks: [LINKED_TASK] })}
            onOpen={onOpen}
          />,
        ),
      );

      const timerButton = await screen.findByTestId(`task-timer-${LINKED_TASK.taskId}`);
      fireEvent.click(timerButton);

      await waitFor(() => {
        expect(recordsPost).toHaveBeenCalledWith({
          json: {
            context: { label: LINKED_TASK.title, taskId: LINKED_TASK.taskId },
          },
        });
      });
      // The timer control is a sibling of the "open" button, not nested inside it, so activating
      // it must never also open the item workspace drawer.
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('renders nothing for a task_timebox whose linked task has not arrived yet', () => {
      render(
        withTimerProviders(
          <CalendarItemCard
            item={makeItem({ kind: 'task_timebox', linkedTasks: [] })}
            onOpen={vi.fn()}
          />,
        ),
      );
      expect(screen.queryByRole('button', { name: /Track this task/ })).not.toBeInTheDocument();
    });

    it('renders nothing for a kind that is not task-shaped', () => {
      render(
        withTimerProviders(
          <CalendarItemCard item={makeItem({ kind: 'native_block' })} onOpen={vi.fn()} />,
        ),
      );
      expect(screen.queryByRole('button', { name: /Track this task/ })).not.toBeInTheDocument();
    });

    it('renders for the first-class `timebox` kind a contained task link produces live', async () => {
      // The app's own drag-a-task-onto-the-grid flow (`onDropObjectOnGrid` in
      // `calendar-scheduling-surface.tsx`) creates a `timebox` and links the task with
      // `role: 'contained'` — `'task_timebox'` is a separate, legacy/derived kind no live write
      // path produces. Checking only `'task_timebox'` would make this control unreachable from
      // every block the real UI actually creates.
      render(
        withTimerProviders(
          <CalendarItemCard
            item={makeItem({ kind: 'timebox', linkedTasks: [LINKED_TASK] })}
            onOpen={vi.fn()}
          />,
        ),
      );
      expect(await screen.findByTestId(`task-timer-${LINKED_TASK.taskId}`)).toBeInTheDocument();
    });

    it('renders nothing for a task-shaped item whose only link is not `contained`', () => {
      const relatedOnly = { ...LINKED_TASK, role: 'related' as const };
      render(
        withTimerProviders(
          <CalendarItemCard
            item={makeItem({ kind: 'timebox', linkedTasks: [relatedOnly] })}
            onOpen={vi.fn()}
          />,
        ),
      );
      expect(screen.queryByTestId(`task-timer-${relatedOnly.taskId}`)).not.toBeInTheDocument();
    });
  });
});
