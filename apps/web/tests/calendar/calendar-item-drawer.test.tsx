/**
 * Behavior tests for {@link import('../../src/components/calendar/calendar-item-drawer')}.
 *
 * @remarks
 * Pins the item workspace's headline contract from the brief:
 *
 * - it shows multiple linked tasks, grouped by role;
 * - creating a task from the drawer opens the shell-global Task composer and links a successful
 *   same-workspace creation back to the calendar item;
 * - provider implementation state stays out of the event editor.
 */
import '@testing-library/jest-dom/vitest';

import { CalendarItemId, CalendarLayerId } from '@docket/planning/ids';
import { type CalendarItemOut, type CalendarLayerOut } from '@docket/planning/calendar-contract';
import { OrganizationId } from '@docket/identity-access/ids';
import { type TaskOut } from '@docket/work/task-model';
import { TaskId } from '@docket/work/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  openCreate,
  openAthena,
} = vi.hoisted(() => ({
  itemGet: vi.fn(),
  layersGet: vi.fn(),
  itemTasksPost: vi.fn(),
  retryWritePost: vi.fn(),
  itemPatch: vi.fn(),
  itemRelationsGet: vi.fn(),
  itemRelationDelete: vi.fn(),
  openCreate: vi.fn(),
  openAthena: vi.fn(),
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

vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ request: null, openCreate, closeCreate: vi.fn() }),
}));

vi.mock('../../src/components/athena/athena-panel-provider', () => ({
  useAthenaPanel: () => ({ openAthena }),
}));

import { ActiveOrgContext } from '../../src/components/active-org';
import CalendarItemDrawer from '../../src/components/calendar/calendar-item-drawer';
import { QueuedOfflineWriteError } from '../../src/components/pwa/offline-write';

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
        orgsLoading={false}
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
  openCreate.mockReset();
  openAthena.mockReset();
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
  it('opens a bounded event dialog with one internal scroll region', async () => {
    renderDrawer(ITEM_ID);

    const dialog = await screen.findByRole('dialog', { name: 'Design review' });
    expect(dialog).toHaveClass('overflow-hidden');
    expect(within(dialog).getByTestId('calendar-item-dialog-scroll')).toHaveClass(
      'overflow-y-auto',
    );
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('uses user-facing event language instead of provider and model metadata', async () => {
    itemGet.mockResolvedValue(
      okResponse(
        makeItem({
          kind: 'provider_event',
          provider: 'google',
          htmlLink: 'https://calendar.google.com/event/1',
        }),
      ),
    );
    layersGet.mockResolvedValue(
      okResponse({
        items: [makeLayer({ provider: 'google', title: 'Work calendar', accessRole: 'owner' })],
      }),
    );

    renderDrawer(ITEM_ID);
    await screen.findByRole('dialog', { name: 'Design review' });

    expect(screen.getByRole('link', { name: 'Open in Google Calendar' })).toHaveAttribute(
      'href',
      'https://calendar.google.com/event/1',
    );
    expect(screen.queryByText('Provider event')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider metadata')).not.toBeInTheDocument();
    expect(screen.queryByText('Calendar relationships')).not.toBeInTheDocument();
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
    // The arc names itself only where it has something to show, so a provider event with two
    // linked tasks shows Before and After and stays quiet about the other two bands.
    expect(screen.getByRole('heading', { name: 'Before' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'After' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Related' })).not.toBeInTheDocument();
  });

  it('explains why a provider event is read-only', async () => {
    itemGet.mockResolvedValue(
      okResponse(
        makeItem({
          kind: 'provider_event',
          provider: 'google',
          permissions: {
            canEditCore: false,
            canDelete: false,
            readOnlyReason: 'provider_scope',
          },
        }),
      ),
    );

    renderDrawer(ITEM_ID);
    const dialog = await screen.findByRole('dialog', { name: 'Design review' });

    expect(within(dialog).getByText(/^Read-only/)).toBeVisible();
    expect(within(dialog).getByLabelText('Title')).toBeDisabled();
  });

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
    expect(screen.getByRole('heading', { name: 'Before' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'After' })).toBeInTheDocument();
  });

  it('opens the global Task composer and awaits a selected-role link', async () => {
    renderDrawer(ITEM_ID);

    await waitFor(() => {
      expect(screen.getByText('Design review')).toBeInTheDocument();
    });

    // The band a person adds to decides the role, which is what retired the relationship select.
    await userEvent.click(screen.getByRole('button', { name: 'Add follow-up' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New task' }));

    expect(openCreate).toHaveBeenCalledWith({
      kind: 'task',
      sameWorkspaceCompletion: 'stay',
      afterCreate: expect.any(Function),
    });
    expect(screen.queryByRole('button', { name: 'Create & link' })).not.toBeInTheDocument();

    const request = openCreate.mock.calls[0]?.[0] as {
      afterCreate?: (task: TaskOut) => Promise<void>;
    };
    await act(async () => {
      await request.afterCreate?.({
        id: TASK_A,
        organizationId: ORG_ID,
        title: 'Prep the deck',
      } as TaskOut);
    });

    await waitFor(() => {
      expect(itemTasksPost).toHaveBeenCalledWith({
        param: { id: ITEM_ID },
        json: { mode: 'link', organizationId: ORG_ID, taskId: TASK_A, role: 'follow_up' },
      });
    });
  });

  it('treats an offline-queued link as accepted instead of a hard failure', async () => {
    itemTasksPost.mockRejectedValueOnce(new QueuedOfflineWriteError('queued-calendar-link'));
    renderDrawer(ITEM_ID);
    await screen.findByText('Design review');

    await userEvent.click(screen.getByRole('button', { name: 'Add prep' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'New task' }));
    const request = openCreate.mock.calls[0]?.[0] as {
      afterCreate?: (task: TaskOut) => Promise<void>;
    };

    await expect(
      request.afterCreate?.({
        id: TASK_A,
        organizationId: ORG_ID,
        title: 'Queued follow-up',
      } as TaskOut),
    ).resolves.toBeUndefined();
    expect(
      await screen.findByText(
        "Saved on this device. Docket will sync it as soon as you're back online.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/couldn't attach it to this event/)).not.toBeInTheDocument();
  });

  it('says a conflicted event kept your version, and offers to send it again', async () => {
    itemGet.mockResolvedValue(
      okResponse(
        makeItem({
          kind: 'provider_event',
          provider: 'google',
          syncState: 'conflict',
          hasConflict: true,
          htmlLink: 'https://calendar.google.com/event/1',
          permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'conflict' },
        }),
      ),
    );
    layersGet.mockResolvedValue(okResponse({ items: [makeLayer({ provider: 'google' })] }));
    retryWritePost.mockResolvedValue(okResponse(makeItem()));
    renderDrawer(ITEM_ID);

    await screen.findByRole('dialog', { name: 'Design review' });
    expect(screen.getByText(/nothing has been overwritten/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep my changes' }));
    await waitFor(() => {
      expect(retryWritePost).toHaveBeenCalledWith({ param: { id: ITEM_ID } });
    });
  });

  it('reports a provider write that has not been sent yet', async () => {
    itemGet.mockResolvedValue(
      okResponse(
        makeItem({ kind: 'provider_event', provider: 'google', syncState: 'push_pending' }),
      ),
    );
    layersGet.mockResolvedValue(okResponse({ items: [makeLayer({ provider: 'google' })] }));
    renderDrawer(ITEM_ID);

    await screen.findByRole('dialog', { name: 'Design review' });
    expect(screen.getByText('Sending your changes to Google Calendar…')).toBeInTheDocument();
  });

  it('says nothing about sync for an event that has nothing pending', async () => {
    renderDrawer(ITEM_ID);

    await screen.findByRole('dialog', { name: 'Design review' });
    expect(screen.queryByText(/Sending your changes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing has been overwritten/)).not.toBeInTheDocument();
  });

  it('names the guests and their answers without offering a response it cannot send', async () => {
    itemGet.mockResolvedValue(
      okResponse(
        makeItem({
          kind: 'provider_event',
          provider: 'google',
          organizer: { email: 'lead@example.com', displayName: 'Ada Lead' },
          attendees: [
            { email: 'lead@example.com', displayName: 'Ada Lead', responseStatus: 'accepted' },
            {
              email: 'you@example.com',
              displayName: 'Sam',
              responseStatus: 'needsAction',
              self: true,
            },
            { email: 'maybe@example.com', displayName: 'Jo', responseStatus: 'tentative' },
          ],
        }),
      ),
    );
    renderDrawer(ITEM_ID);

    await screen.findByRole('dialog', { name: 'Design review' });
    expect(screen.getByText('Ada Lead')).toBeInTheDocument();
    expect(screen.getByText('Organizer')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText(/^Maybe/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Yes$/ })).not.toBeInTheDocument();
  });

  it('shows the debrief the scheduler created under After', async () => {
    itemRelationsGet.mockResolvedValue(
      okResponse({
        items: [
          {
            sourceItemId: ITEM_ID,
            targetItemId: RELATED_ITEM_ID,
            targetTitle: 'Design review debrief',
            targetKind: 'native_event',
            role: 'follow_up',
            createdByUserId: '01BX5ZZKBKACTAV9WEVGEMMVA1',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    renderDrawer(ITEM_ID);

    const after = await screen.findByText('Design review debrief');
    expect(after).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'After' })).toBeInTheDocument();
  });

  it('offers one affordance, and no apologies, for an event with nothing attached', async () => {
    itemGet.mockResolvedValue(okResponse(makeItem({ linkedTasks: [] })));
    renderDrawer(ITEM_ID);

    await screen.findByRole('dialog', { name: 'Design review' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add prep' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Before' })).not.toBeInTheDocument();
    expect(screen.queryByText(/No tasks are linked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No related events/)).not.toBeInTheDocument();
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

    // A contained item is part of what happens inside the event, so it reads under During.
    expect(await screen.findByRole('heading', { name: 'During' })).toBeInTheDocument();
    expect(screen.getByText('Event')).toBeInTheDocument();
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

    // All-day dates use the product's one date picker, so they get the same calendar, keyboard
    // and bounds as every other date in the app rather than a bare native input.
    const startTrigger = screen.getByRole('button', { name: /^Starts —/ });
    expect(startTrigger).toHaveTextContent('Jul 10, 2026');
    // The end trigger shows the last included day (inclusive), one day before the exclusive wire date.
    expect(screen.getByRole('button', { name: /^Ends —/ })).toHaveTextContent('Jul 10, 2026');

    // The all-day date fields autosave on their debounce.
    fireEvent.click(screen.getByRole('button', { name: /^Ends —/ }));
    const grid = await screen.findByRole('grid', { name: 'Ends' });
    fireEvent.click(within(grid).getByRole('button', { name: '2026-07-12' }));

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
