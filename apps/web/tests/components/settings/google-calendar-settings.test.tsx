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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { calendarGet, identitiesGet, layersGet, replace } = vi.hoisted(() => ({
  calendarGet: vi.fn(),
  identitiesGet: vi.fn(),
  layersGet: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { linkSocial: vi.fn() },
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
          sync: { $post: vi.fn() },
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

function calendarSettingsFixture() {
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
  replace.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('GoogleCalendarSettings', () => {
  it('renders write-scope status per account and each account layer beneath it', async () => {
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

    // Each account's layer renders underneath it.
    expect(screen.getByText('Writer primary')).toBeInTheDocument();
    expect(screen.getByText('Reader primary')).toBeInTheDocument();
  });
});
