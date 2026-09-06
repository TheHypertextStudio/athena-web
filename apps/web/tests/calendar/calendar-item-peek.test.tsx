/**
 * Behavior tests for the calendar event peek.
 *
 * @remarks
 * The peek is the tier a click now produces. These pin the two things that make it worth having:
 * it answers when, where, and who without opening anything, and it escalates rather than replacing
 * the detail dialog. They also pin the two facts Docket has been dropping — guests, and a sync
 * state a person can act on.
 */
import '@testing-library/jest-dom/vitest';

import { CalendarItemId, CalendarLayerId } from '@docket/planning/ids';
import type { CalendarItemOut, CalendarLayerOut } from '@docket/planning/calendar-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type JSX, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { layersGet, openAthena } = vi.hoisted(() => ({
  layersGet: vi.fn(),
  openAthena: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          layers: { $get: layersGet },
          items: { ':id': { $delete: vi.fn() } },
        },
      },
    },
  },
}));

vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ openAthena }),
}));

import { CalendarItemPeekOverlay } from '../../src/components/calendar/item-peek/calendar-item-peek-overlay';
import type { PopoverVirtualAnchor } from '@docket/ui/primitives';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');

function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

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
    title: 'Take transit to Pop Café',
    description: '103, SB Decatur before Rice to SB Decatur after Washington',
    location: 'Starbucks Coffee Company',
    workPlaceId: null,
    htmlLink: null,
    startsAt: '2026-09-06T22:52:00.000Z',
    endsAt: '2026-09-06T23:56:00.000Z',
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
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLayer(): CalendarLayerOut {
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
  };
}

function renderPeek(item: CalendarItemOut): {
  onOpenDetail: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenDetail = vi.fn();
  const onClose = vi.fn();
  const anchor = createRef<PopoverVirtualAnchor | null>();
  anchor.current = { getBoundingClientRect: () => new DOMRect(100, 100, 120, 40) };
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <CalendarItemPeekOverlay
      item={item}
      displayTimezone="UTC"
      anchorRef={anchor}
      onOpenDetail={onOpenDetail}
      onClose={onClose}
      onDismissOutside={vi.fn()}
    />,
    { wrapper },
  );
  return { onOpenDetail, onClose };
}

describe('calendar item peek', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layersGet.mockResolvedValue(okResponse({ items: [makeLayer()] }));
    // jsdom has no matchMedia; the peek asks whether it has room to anchor.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
  });
  afterEach(cleanup);

  it('answers when, where, and what without opening the editor', async () => {
    renderPeek(makeItem());

    const peek = await screen.findByRole('dialog', { name: 'Take transit to Pop Café' });
    expect(peek).toHaveTextContent('Sunday, September 6');
    expect(peek).toHaveTextContent('1h 4m');
    expect(peek).toHaveTextContent('Starbucks Coffee Company');
    expect(peek).toHaveTextContent('103, SB Decatur before Rice');
    await waitFor(() => {
      expect(peek).toHaveTextContent('My blocks');
    });
  });

  it('escalates to the detail rather than opening it on the click', async () => {
    const { onOpenDetail } = renderPeek(makeItem());

    const peek = await screen.findByRole('dialog', { name: 'Take transit to Pop Café' });
    expect(onOpenDetail).not.toHaveBeenCalled();
    await userEvent.click(within(peek).getByRole('button', { name: 'Open' }));
    expect(onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it('names the guests and offers no response control it cannot honour', async () => {
    renderPeek(
      makeItem({
        organizer: { email: 'lead@example.com', displayName: 'Ada Lead', self: false },
        attendees: [
          { email: 'lead@example.com', displayName: 'Ada Lead', responseStatus: 'accepted' },
          {
            email: 'you@example.com',
            displayName: 'You',
            responseStatus: 'needsAction',
            self: true,
          },
        ],
      }),
    );

    const peek = await screen.findByRole('dialog', { name: 'Take transit to Pop Café' });
    expect(peek).toHaveTextContent('2 guests');
    expect(within(peek).queryByRole('button', { name: /yes/i })).toBeNull();
  });

  it('says a conflicted event kept your version instead of going quietly read-only', async () => {
    renderPeek(
      makeItem({
        provider: 'google',
        kind: 'provider_event',
        syncState: 'conflict',
        hasConflict: true,
        permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'conflict' },
      }),
    );

    const peek = await screen.findByRole('dialog', { name: 'Take transit to Pop Café' });
    expect(peek).toHaveTextContent('nothing has been overwritten');
    expect(peek).toHaveTextContent('Conflict');
  });

  it('hides delete for an event Docket does not own', async () => {
    renderPeek(
      makeItem({
        kind: 'provider_event',
        provider: 'google',
        permissions: { canEditCore: true, canDelete: false, readOnlyReason: null },
      }),
    );

    const peek = await screen.findByRole('dialog', { name: 'Take transit to Pop Café' });
    expect(within(peek).queryByRole('button', { name: /^Delete/ })).toBeNull();
  });
});
