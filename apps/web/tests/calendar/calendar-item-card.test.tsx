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
 * - a non-`clean` sync state (and a conflict) surfaces a labeled badge.
 */
import '@testing-library/jest-dom/vitest';

import {
  CalendarItemId,
  type CalendarItemKind,
  type CalendarItemOut,
  CalendarLayerId,
  type CalendarLayerOut,
} from '@docket/types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CalendarItemCard from '@/components/calendar/calendar-item-card';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');

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

  it('surfaces a labeled badge for a non-clean sync state', () => {
    render(<CalendarItemCard item={makeItem({ syncState: 'provider_error' })} onOpen={vi.fn()} />);
    expect(screen.getByLabelText('Sync failed')).toBeInTheDocument();
  });

  it('surfaces a labeled conflict badge, taking priority over the raw sync state', () => {
    render(
      <CalendarItemCard
        item={makeItem({ syncState: 'local_dirty', hasConflict: true })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Conflict')).toBeInTheDocument();
  });

  it('shows no sync badge for a clean, non-conflicted item', () => {
    render(<CalendarItemCard item={makeItem()} onOpen={vi.fn()} />);
    expect(screen.queryByLabelText('Conflict')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sync failed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Syncing…')).not.toBeInTheDocument();
  });
});
