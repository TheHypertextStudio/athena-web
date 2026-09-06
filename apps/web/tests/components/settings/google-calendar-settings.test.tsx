/**
 * Behavior tests for
 * {@link import('../../../src/components/settings/google-calendar-settings')}.
 *
 * @remarks
 * Pins Task 9's settings expansion: per-account write-scope status (from
 * {@link CalendarConnectionOut.scopeState}) renders distinctly for a write-enabled account vs. a
 * read-only one, the read-only account shows a real re-consent action, and each account's layers
 * render underneath it via the shared layer panel.
 */
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  calendarGet,
  identitiesGet,
  layersGet,
  groupPatch,
  groupPost,
  groupDelete,
  sourceDelete,
  syncPost,
  linkSocial,
  replace,
} = vi.hoisted(() => ({
  calendarGet: vi.fn(),
  identitiesGet: vi.fn(),
  layersGet: vi.fn(),
  groupPatch: vi.fn(),
  groupPost: vi.fn(),
  groupDelete: vi.fn(),
  sourceDelete: vi.fn(),
  syncPost: vi.fn(),
  linkSocial: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { linkSocial },
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        identities: { $get: identitiesGet },
        calendar: {
          $get: calendarGet,
          layers: { $get: layersGet },
          calendars: { ':id': { $patch: vi.fn() } },
          'source-groups': {
            $post: groupPost,
            ':id': { $patch: groupPatch, $delete: groupDelete },
          },
          sources: { ':id': { subscription: { $delete: sourceDelete } } },
          sync: { $post: syncPost },
        },
      },
    },
  },
}));

import GoogleCalendarSettings from '../../../src/components/settings/google-calendar-settings';

/** A typed mock Hono RPC response. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const WRITE_CONNECTION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const READ_ONLY_CONNECTION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

function calendarSettingsFixture(readOnlySourceManagement = false) {
  return {
    connections: [
      {
        id: WRITE_CONNECTION_ID,
        provider: 'google',
        externalAccountId: 'sub-1',
        accountEmail: 'writer@example.com',
        accountName: 'Writer',
        accountPictureUrl: null,
        status: 'connected',
        calendarsTotal: 1,
        calendarsEnabled: 1,
        lastSyncedAt: null,
        lastError: null,
        scopeState: {
          grantedScopes: ['https://www.googleapis.com/auth/calendar'],
          calendarRead: true,
          calendarWrite: true,
          sourceManagement: true,
          capturedAt: '2026-07-01T00:00:00.000Z',
        },
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: READ_ONLY_CONNECTION_ID,
        provider: 'google',
        externalAccountId: 'sub-2',
        accountEmail: 'reader@example.com',
        accountName: 'Reader',
        accountPictureUrl: null,
        status: 'connected',
        calendarsTotal: 1,
        calendarsEnabled: 1,
        lastSyncedAt: null,
        lastError: null,
        scopeState: {
          grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
          calendarRead: true,
          calendarWrite: false,
          sourceManagement: readOnlySourceManagement,
          capturedAt: '2026-07-01T00:00:00.000Z',
        },
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    calendars: [],
    layers: [
      {
        id: '01BX5ZZKBKACTAV9WEVGEMMVL1',
        connectionId: WRITE_CONNECTION_ID,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'primary',
        title: 'Writer primary',
        description: null,
        timezone: null,
        color: '#16a34a',
        accessRole: 'owner',
        primary: true,
        selected: true,
        visibleByDefault: true,
        editableCore: true,
        lastSyncedAt: null,
        lastError: null,
        watchExpiresAt: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: '01BX5ZZKBKACTAV9WEVGEMMVL2',
        connectionId: READ_ONLY_CONNECTION_ID,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'primary',
        title: 'Reader primary',
        description: null,
        timezone: null,
        color: '#2563eb',
        accessRole: 'reader',
        primary: true,
        selected: true,
        visibleByDefault: true,
        editableCore: false,
        lastSyncedAt: null,
        lastError: null,
        watchExpiresAt: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    sourceGroups: [
      {
        id: 'exact_personal',
        persistedGroupId: null,
        provenance: 'exact',
        title: 'Personal',
        color: '#16a34a',
        selected: true,
        visibleByDefault: true,
        preferredLayerId: '01BX5ZZKBKACTAV9WEVGEMMVL1',
        sources: [
          {
            layerId: '01BX5ZZKBKACTAV9WEVGEMMVL1',
            connectionId: WRITE_CONNECTION_ID,
            relationship: 'owned',
            management: { canRemoveSubscription: false, requiresIncrementalConsent: false },
          },
          {
            layerId: '01BX5ZZKBKACTAV9WEVGEMMVL2',
            connectionId: READ_ONLY_CONNECTION_ID,
            relationship: 'shared',
            management: { canRemoveSubscription: true, requiresIncrementalConsent: true },
          },
        ],
      },
    ],
    sourceGroupSuggestions: [],
  };
}

beforeEach(() => {
  calendarGet.mockReset().mockResolvedValue(okResponse(calendarSettingsFixture()));
  identitiesGet
    .mockReset()
    .mockResolvedValue(
      okResponse({ items: [], googleOAuth: { available: true, stage: 'testing' } }),
    );
  layersGet.mockReset().mockResolvedValue(okResponse({ items: calendarSettingsFixture().layers }));
  groupPatch.mockReset().mockResolvedValue(okResponse(calendarSettingsFixture()));
  groupPost.mockReset().mockResolvedValue(okResponse(calendarSettingsFixture()));
  groupDelete.mockReset().mockResolvedValue(okResponse(calendarSettingsFixture()));
  sourceDelete.mockReset().mockResolvedValue(okResponse(calendarSettingsFixture()));
  syncPost
    .mockReset()
    .mockResolvedValue(
      okResponse({ eventsCreated: 0, eventsUpdated: 0, eventsDeleted: 0, errors: [] }),
    );
  linkSocial.mockReset().mockResolvedValue(undefined);
  replace.mockReset();
  window.history.replaceState({}, '', window.location.pathname);
});

afterEach(() => {
  cleanup();
});

describe('GoogleCalendarSettings', () => {
  it('renders one logical calendar row with expandable account sources', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<GoogleCalendarSettings />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('writer@example.com')).toBeInTheDocument();
    });
    expect(screen.getByText('reader@example.com')).toBeInTheDocument();

    expect(screen.getByText('Calendar editing enabled')).toBeInTheDocument();
    expect(screen.getByText('Calendar read-only')).toBeInTheDocument();

    // The read-only account gets a real incremental-consent action for Calendar editing.
    const enableButton = screen.getByRole('button', { name: /Enable calendar editing/ });
    await waitFor(() => {
      expect(enableButton).toBeEnabled();
    });

    const calendarsSection = screen.getByRole('heading', { name: 'Calendars' }).closest('section');
    if (!calendarsSection) throw new Error('Calendars settings group was not rendered');
    expect(within(calendarsSection).getByText('Personal')).toBeInTheDocument();
    expect(within(calendarsSection).getByText('2 accounts')).toBeInTheDocument();
    expect(screen.queryByText('Preferred')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show sources for Personal' }));
    expect(screen.getByText('Preferred')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use as preferred' })).toBeInTheDocument();
    expect(screen.getAllByText('writer@example.com')).toHaveLength(2);
    expect(screen.getAllByText('reader@example.com')).toHaveLength(2);
  });

  it('requests only calendar-list consent before offering source removal', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<GoogleCalendarSettings />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'Show sources for Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from account' }));

    await waitFor(() => {
      expect(linkSocial).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          scopes: ['https://www.googleapis.com/auth/calendar.calendarlist'],
          callbackURL: expect.stringContaining(
            'google=source-management&source=01BX5ZZKBKACTAV9WEVGEMMVL2',
          ),
        }),
      );
    });
    expect(sourceDelete).not.toHaveBeenCalled();
  });

  it('asks for final confirmation and removes a source after consent exists', async () => {
    const fixture = calendarSettingsFixture(true);
    calendarGet.mockResolvedValue(okResponse(fixture));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<GoogleCalendarSettings />, { wrapper });

    fireEvent.click(await screen.findByRole('button', { name: 'Show sources for Personal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from account' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(sourceDelete).toHaveBeenCalledWith({
        param: { id: '01BX5ZZKBKACTAV9WEVGEMMVL2' },
      });
    });
    confirm.mockRestore();
  });

  it('reopens the source after OAuth without deleting it automatically', async () => {
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}?google=source-management&source=01BX5ZZKBKACTAV9WEVGEMMVL2`,
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<GoogleCalendarSettings />, { wrapper });

    await waitFor(() => {
      expect(syncPost).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Preferred')).toBeInTheDocument();
    expect(sourceDelete).not.toHaveBeenCalled();
  });
});
