/**
 * Behavior tests for {@link import('../../src/components/calendar/calendar-item-drawer')}.
 *
 * @remarks
 * Pins the item workspace's headline contract from the brief:
 *
 * - it shows multiple linked tasks, grouped by role;
 * - creating a task from the drawer calls the create-and-link mutation with the right payload
 *   and, on success, closes the create form (the create-and-link hook is invalidate-only, so a
 *   closed form with no error is the drawer's own signal that the link succeeded);
 * - a conflicted item renders both conflict actions ("Open in provider" and "Retry with local
 *   changes").
 */
import '@testing-library/jest-dom/vitest';

import {
  CalendarItemId,
  type CalendarItemOut,
  CalendarLayerId,
  type CalendarLayerOut,
  OrganizationId,
  TaskId,
} from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  itemGet,
  layersGet,
  itemTasksPost,
  retryWritePost,
  itemPatch,
  itemRelationsGet,
  itemRelationDelete,
} = vi.hoisted(() => ({
  itemGet: vi.fn(),
  layersGet: vi.fn(),
  itemTasksPost: vi.fn(),
  retryWritePost: vi.fn(),
  itemPatch: vi.fn(),
  itemRelationsGet: vi.fn(),
  itemRelationDelete: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          layers: { $get: layersGet },
          items: {
            ':id': {
              $get: itemGet,
              $patch: itemPatch,
              $delete: vi.fn(),
              'retry-write': { $post: retryWritePost },
              tasks: {
                $post: itemTasksPost,
                ':taskId': { $delete: vi.fn() },
              },
              relations: {
                $get: itemRelationsGet,
                ':relatedItemId': { $delete: itemRelationDelete },
              },
            },
          },
        },
      },
    },
  },
}));

import { ActiveOrgContext } from '../../src/components/active-org';
import CalendarItemDrawer from '../../src/components/calendar/calendar-item-drawer';

const ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1');
const LAYER_ID = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const ORG_ID = OrganizationId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const TASK_A = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA0');
const TASK_B = TaskId.parse('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const RELATED_ITEM_ID = CalendarItemId.parse('01BX5ZZKBKACTAV9WEVGEMMVS2');

/** A typed mock Hono RPC response. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A calendar-item fixture with two linked tasks in different roles. */
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
    title: 'Design review',
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
    linkedTasks: [
      {
        taskId: TASK_A,
        organizationId: ORG_ID,
        role: 'prep',
        sort: 0,
        note: null,
        title: 'Prep notes',
        state: 'backlog',
        done: false,
      },
      {
        taskId: TASK_B,
        organizationId: ORG_ID,
        role: 'follow_up',
        sort: 0,
        note: null,
        title: 'Send recap',
        state: 'backlog',
        done: false,
      },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A calendar-layer fixture. */
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

/** Render the drawer inside a fresh QueryClient + ActiveOrgContext (for the task-link forms). */
function renderDrawer(
  itemId: string | null,
  displayTimezone = 'UTC',
): {
  onClose: ReturnType<typeof vi.fn>;
  onOpenTask: ReturnType<typeof vi.fn>;
  rerenderDrawer: (displayTimezone: string) => void;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onOpenTask = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>
      <ActiveOrgContext
        orgs={[{ id: ORG_ID, name: 'Acme', slug: 'acme', avatar: null, isPersonal: false }]}
        activeOrgId={null}
        orgsError={null}
      >
        {children}
      </ActiveOrgContext>
    </QueryClientProvider>
  );
  const result = render(
    <CalendarItemDrawer
      displayTimezone={displayTimezone}
      itemId={itemId}
      onClose={onClose}
      onOpenTask={onOpenTask}
    />,
    { wrapper },
  );
  return {
    onClose,
    onOpenTask,
    rerenderDrawer: (nextDisplayTimezone) => {
      result.rerender(
        <CalendarItemDrawer
          displayTimezone={nextDisplayTimezone}
          itemId={itemId}
          onClose={onClose}
          onOpenTask={onOpenTask}
        />,
      );
    },
  };
}

beforeEach(() => {
  layersGet.mockReset().mockResolvedValue(okResponse({ items: [makeLayer()] }));
  itemGet.mockReset().mockResolvedValue(okResponse(makeItem()));
  itemTasksPost.mockReset().mockResolvedValue(
    okResponse({
      link: {
        calendarItemId: ITEM_ID,
        taskId: TASK_A,
        organizationId: ORG_ID,
        role: 'related',
        sort: 2,
        note: null,
        createdBy: '01BX5ZZKBKACTAV9WEVGEMMVA1',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      task: {
        id: TASK_A,
        organizationId: ORG_ID,
        title: 'New follow-up',
        teamId: '01BX5ZZKBKACTAV9WEVGEMMVT1',
        state: 'backlog',
        priority: 'none',
        provenance: { source: 'native' },
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    }),
  );
  retryWritePost.mockReset().mockResolvedValue(okResponse(makeItem()));
  itemPatch.mockReset().mockResolvedValue(okResponse(makeItem()));
  itemRelationsGet.mockReset().mockResolvedValue(okResponse({ items: [] }));
  itemRelationDelete.mockReset().mockResolvedValue(
    okResponse({
      sourceItemId: ITEM_ID,
      targetItemId: RELATED_ITEM_ID,
      role: 'contained',
      createdByUserId: '01BX5ZZKBKACTAV9WEVGEMMVA1',
      createdAt: '2026-07-01T00:00:00.000Z',
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CalendarItemDrawer', () => {
  it('keeps a visible close action while item details are loading', () => {
    itemGet.mockReturnValue(new Promise(() => undefined));
    const { onClose } = renderDrawer(ITEM_ID);

    fireEvent.click(screen.getByRole('button', { name: 'Close calendar item' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('provides a visible close action', async () => {
    const { onClose } = renderDrawer(ITEM_ID);

    await screen.findByLabelText('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Close calendar item' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('guards explicit dismissal when editable fields have unsaved changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onClose } = renderDrawer(ITEM_ID);
    const title = await screen.findByLabelText('Title');

    fireEvent.change(title, { target: { value: 'Unsaved review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close calendar item' }));

    expect(confirm).toHaveBeenCalledWith('Discard your unsaved calendar changes?');
    expect(onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close calendar item' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('guards related-item navigation when editable fields have unsaved changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    itemRelationsGet.mockResolvedValue(
      okResponse({
        items: [
          {
            sourceItemId: ITEM_ID,
            targetItemId: RELATED_ITEM_ID,
            targetTitle: 'Customer interview',
            targetKind: 'provider_event',
            role: 'contained',
            createdByUserId: '01BX5ZZKBKACTAV9WEVGEMMVA1',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    itemGet.mockImplementation(({ param }: { param: { id: string } }) =>
      Promise.resolve(
        okResponse(
          param.id === RELATED_ITEM_ID
            ? makeItem({ id: RELATED_ITEM_ID, title: 'Customer interview' })
            : makeItem(),
        ),
      ),
    );
    renderDrawer(ITEM_ID);
    const title = await screen.findByLabelText('Title');
    const relatedItem = await screen.findByRole('button', { name: 'Customer interview' });

    fireEvent.change(title, { target: { value: 'Unsaved review' } });
    fireEvent.click(relatedItem);

    expect(confirm).toHaveBeenCalledWith('Discard your unsaved calendar changes?');
    expect(itemGet).not.toHaveBeenCalledWith({ param: { id: RELATED_ITEM_ID } });

    confirm.mockReturnValue(true);
    fireEvent.click(relatedItem);
    await waitFor(() => {
      expect(itemGet).toHaveBeenCalledWith({ param: { id: RELATED_ITEM_ID } });
    });
  });

  it('guards linked-task navigation when editable fields have unsaved changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onOpenTask } = renderDrawer(ITEM_ID);
    const title = await screen.findByLabelText('Title');
    const linkedTask = screen.getByRole('button', { name: 'Prep notes' });

    fireEvent.change(title, { target: { value: 'Unsaved review' } });
    fireEvent.click(linkedTask);

    expect(confirm).toHaveBeenCalledWith('Discard your unsaved calendar changes?');
    expect(onOpenTask).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(linkedTask);
    expect(onOpenTask).toHaveBeenCalledWith(ORG_ID, TASK_A);
  });

  it('rebases untouched timed fields when the display timezone hydrates', async () => {
    const { rerenderDrawer } = renderDrawer(ITEM_ID, 'UTC');

    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-07-01T16:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01T17:00');
    rerenderDrawer('Asia/Tokyo');
    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-02T01:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-02T02:00');

    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Hydrated review' } });
    // Text fields autosave on blur — there is no Save button.
    fireEvent.blur(title);
    await waitFor(() => {
      expect(itemPatch).toHaveBeenCalledWith({
        param: { id: ITEM_ID },
        json: { title: 'Hydrated review' },
      });
    });
  });

  it('does not overwrite an edited time field when the display timezone hydrates', async () => {
    const { rerenderDrawer } = renderDrawer(ITEM_ID, 'UTC');
    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-07-01T16:00');

    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-07-01T18:00' },
    });
    rerenderDrawer('Asia/Tokyo');

    expect(screen.getByLabelText('Starts')).toHaveValue('2026-07-01T18:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-02T02:00');
  });

  it('offers and persists an explicit occurrence inside a repeated wall-clock hour', async () => {
    itemGet.mockResolvedValue(
      okResponse(
        makeItem({
          startsAt: '2026-11-01T07:30:00.000Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        }),
      ),
    );
    renderDrawer(ITEM_ID, 'America/Los_Angeles');

    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-11-01T00:30');
    fireEvent.change(screen.getByLabelText('Starts'), {
      target: { value: '2026-11-01T01:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Later · PST' }));

    // The schedule fields autosave on their debounce.
    await waitFor(() => {
      expect(itemPatch).toHaveBeenCalledWith({
        param: { id: ITEM_ID },
        json: {
          startsAt: '2026-11-01T09:30:00Z',
          endsAt: '2026-11-01T10:30:00.000Z',
        },
      });
    });
  });

  it('preserves timed instants when another field changes in a different display timezone', async () => {
    renderDrawer(ITEM_ID, 'Asia/Tokyo');

    expect(await screen.findByLabelText('Starts')).toHaveValue('2026-07-02T01:00');
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-02T02:00');
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Updated review' } });
    // Editing another (text) field autosaves only that field; the untouched instants are not resent.
    fireEvent.blur(title);

    await waitFor(() => {
      expect(itemPatch).toHaveBeenCalledWith({
        param: { id: ITEM_ID },
        json: { title: 'Updated review' },
      });
    });
  });

  it('shows multiple linked tasks, grouped by role', async () => {
    renderDrawer(ITEM_ID);

    await waitFor(() => {
      expect(screen.getByText('Prep notes')).toBeInTheDocument();
    });
    expect(screen.getByText('Send recap')).toBeInTheDocument();
    expect(screen.getByText('Prep')).toBeInTheDocument();
    expect(screen.getByText('Follow-up')).toBeInTheDocument();
  });

  it('creates and links a task from the drawer, closing the form on success', async () => {
    renderDrawer(ITEM_ID);

    await waitFor(() => {
      expect(screen.getByText('Design review')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    const titleInput = screen.getByPlaceholderText('Design review');
    fireEvent.change(titleInput, { target: { value: 'Prep the deck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & link' }));

    await waitFor(() => {
      expect(itemTasksPost).toHaveBeenCalledWith({
        param: { id: ITEM_ID },
        json: { mode: 'create', organizationId: ORG_ID, title: 'Prep the deck', role: 'related' },
      });
    });
    // The form closes once the mutation succeeds — the drawer's own signal that the task linked.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create & link' })).not.toBeInTheDocument();
    });
  });

  it('renders both conflict actions for a conflicted item', async () => {
    itemGet.mockResolvedValue(
      okResponse(makeItem({ hasConflict: true, htmlLink: 'https://calendar.google.com/event/1' })),
    );
    renderDrawer(ITEM_ID);

    await waitFor(() => {
      expect(screen.getByText('Sync conflict')).toBeInTheDocument();
    });
    // "Open in provider" appears twice (header link + conflict-banner action); both share the
    // item's `htmlLink`, so asserting on the set covers the banner's copy without over-specifying
    // which DOM node is "the" link.
    const providerLinks = screen.getAllByRole('link', { name: 'Open in provider' });
    expect(providerLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of providerLinks) {
      expect(link).toHaveAttribute('href', 'https://calendar.google.com/event/1');
    }
    expect(screen.getByRole('button', { name: 'Retry with local changes' })).toBeInTheDocument();
  });

  it('shows contained items, opens them in place, and detaches relationships', async () => {
    itemRelationsGet.mockResolvedValue(
      okResponse({
        items: [
          {
            sourceItemId: ITEM_ID,
            targetItemId: RELATED_ITEM_ID,
            targetTitle: 'Customer interview',
            targetKind: 'provider_event',
            role: 'contained',
            createdByUserId: '01BX5ZZKBKACTAV9WEVGEMMVA1',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    itemGet.mockImplementation(({ param }: { param: { id: string } }) =>
      Promise.resolve(
        okResponse(
          param.id === RELATED_ITEM_ID
            ? makeItem({ id: RELATED_ITEM_ID, title: 'Customer interview' })
            : makeItem(),
        ),
      ),
    );
    renderDrawer(ITEM_ID);

    expect(await screen.findByText('Contents')).toBeInTheDocument();
    expect(screen.getByText('Provider event')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Detach Customer interview' }));
    await waitFor(() => {
      expect(itemRelationDelete).toHaveBeenCalledWith({
        param: { id: ITEM_ID, relatedItemId: RELATED_ITEM_ID },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Customer interview' }));
    await waitFor(() => {
      expect(itemGet).toHaveBeenCalledWith({ param: { id: RELATED_ITEM_ID } });
    });
  });

  it('edits an all-day item via date inputs, converting to the exclusive wire end date', async () => {
    itemGet.mockResolvedValue(
      okResponse(
        makeItem({
          startsAt: null,
          endsAt: null,
          allDayStartDate: '2026-07-10',
          allDayEndDate: '2026-07-11',
        }),
      ),
    );
    renderDrawer(ITEM_ID);

    await waitFor(() => {
      expect(screen.getByText('Design review')).toBeInTheDocument();
    });

    // No stale "edited from the full calendar view" placeholder — real date inputs instead.
    expect(
      screen.queryByText('All-day items are edited from the full calendar view.'),
    ).not.toBeInTheDocument();

    const startInput = screen.getByLabelText('Starts');
    expect(startInput).toHaveAttribute('type', 'date');
    expect(startInput).toHaveValue('2026-07-10');
    // The end input shows the last included day (inclusive), one day before the exclusive wire date.
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-10');

    // The all-day date fields autosave on their debounce.
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-07-12' } });

    await waitFor(() => {
      expect(itemPatch).toHaveBeenCalledWith({
        param: { id: ITEM_ID },
        json: {
          allDayStartDate: '2026-07-10',
          allDayEndDate: '2026-07-13',
        },
      });
    });
  });
});
