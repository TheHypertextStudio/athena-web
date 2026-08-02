/**
 * Behavior tests for {@link import('../../src/components/calendar/calendar-layer-panel')}.
 *
 * @remarks
 * Pins the brief's "layer toggle: cache preserved, no layout jump" requirement as a structural
 * assertion (same DOM node count before/after), not a visual regression check:
 *
 * - toggling a layer's checkbox optimistically flips its `selected` flag in the
 *   `calendarLayers()` query cache before the mocked PATCH resolves (same optimistic-patch
 *   contract `calendar-data.test.tsx` pins at the hook level, exercised here through the actual
 *   checkbox);
 * - the panel's row count is identical before and after the toggle — no row is added/removed,
 *   so there is nothing for the layout to jump around.
 *
 * It also pins the duplicate-calendar behaviour, where the invariant is stricter than "it works":
 * nothing may be hidden without the person asking, and every row a bulk action touches has to stay
 * in the list, still toggleable, still saying why it was called redundant.
 */
import '@testing-library/jest-dom/vitest';

import {
  CalendarConnectionId,
  type CalendarConnectionOut,
  CalendarLayerId,
  type CalendarLayerOut,
  type CalendarLayersOut,
} from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { calendarSettingsGet, layerPatch } = vi.hoisted(() => ({
  calendarSettingsGet: vi.fn(),
  layerPatch: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: Object.assign(
          { $get: calendarSettingsGet },
          {
            layers: {
              ':id': { $patch: layerPatch },
            },
          },
        ),
      },
    },
  },
}));

import CalendarLayerPanel from '../../src/components/calendar/calendar-layer-panel';
import { queryKeys } from '../../src/lib/query';

const LAYER_A = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const LAYER_B = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN2');
const WORK_CONNECTION = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVC1');
const PERSONAL_CONNECTION = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVC2');

/** A linked Google account fixture. */
function makeConnection(id: string, accountEmail: string): CalendarConnectionOut {
  return {
    id: CalendarConnectionId.parse(id),
    provider: 'google',
    externalAccountId: `sub-${accountEmail}`,
    accountEmail,
    accountName: accountEmail,
    accountPictureUrl: null,
    status: 'connected',
    calendarsTotal: 1,
    calendarsEnabled: 1,
    lastSyncedAt: null,
    lastError: null,
    scopeState: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

/** A typed mock Hono RPC response. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** A calendar-layer fixture. */
function makeLayer(overrides: Partial<CalendarLayerOut> = {}): CalendarLayerOut {
  return {
    id: LAYER_A,
    connectionId: null,
    provider: null,
    sourceKind: 'native_blocks',
    externalLayerId: null,
    title: 'Focus',
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

beforeEach(() => {
  calendarSettingsGet
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve(okResponse({ connections: [], calendars: [], layers: [] })),
    );
  layerPatch
    .mockReset()
    .mockImplementation((vars: { json: Partial<CalendarLayerOut> }) =>
      Promise.resolve(okResponse({ ...makeLayer(), ...vars.json })),
    );
});

afterEach(() => {
  cleanup();
});

describe('CalendarLayerPanel', () => {
  it('toggles a layer optimistically without changing the row count', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const layers: CalendarLayerOut[] = [
      makeLayer({ id: LAYER_A, title: 'Focus', selected: true }),
      makeLayer({ id: LAYER_B, title: 'Meetings', selected: false }),
    ];
    client.setQueryData<CalendarLayersOut>(queryKeys.calendarLayers(), { items: layers });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    render(<CalendarLayerPanel layers={layers} />, { wrapper });

    const rowsBefore = screen.getAllByRole('listitem').length;
    const checkbox = screen.getByRole('checkbox', { name: 'Toggle Focus visibility' });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    // Optimistic: the cache flips immediately, ahead of the mocked PATCH resolving.
    await waitFor(() => {
      const cached = client.getQueryData<CalendarLayersOut>(queryKeys.calendarLayers());
      expect(cached?.items.find((l) => l.id === LAYER_A)?.selected).toBe(false);
    });
    // The unrelated layer is untouched.
    expect(
      client
        .getQueryData<CalendarLayersOut>(queryKeys.calendarLayers())
        ?.items.find((l) => l.id === LAYER_B)?.selected,
    ).toBe(false);
    // Structural: no layout jump — identical row count before and after the toggle.
    expect(screen.getAllByRole('listitem').length).toBe(rowsBefore);
  });

  it('renders an empty-state note (not a blank panel) when there are no layers', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<CalendarLayerPanel layers={[]} />, { wrapper });
    expect(screen.getByText(/No calendar layers yet/)).toBeInTheDocument();
  });

  it('does not render stored provider diagnostic text as sync health', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(
      <CalendarLayerPanel
        layers={[
          makeLayer({
            lastError: 'AGENT_MAX_TURNS is not configured; refusing to run agent sessions',
          }),
        ]}
      />,
      { wrapper },
    );

    expect(screen.queryByRole('img', { name: 'Calendar sync issue' })).not.toBeInTheDocument();
    expect(screen.getByRole('list')).not.toHaveTextContent('AGENT_MAX_TURNS');
  });

  it('drops the source line when it only repeats the layer title', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    // A Docket-native layer titled "Docket", grouped under a "Docket" heading, used to print the
    // word a third time as its provider subtitle.
    render(<CalendarLayerPanel layers={[makeLayer({ title: 'Docket', provider: null })]} />, {
      wrapper,
    });

    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Docket');
    expect(row.textContent.match(/Docket/g)).toHaveLength(1);
  });

  it('keeps the toggle a design-system control rather than the OS checkbox', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<CalendarLayerPanel layers={[makeLayer({ title: 'Work' })]} />, { wrapper });

    // `accent-primary` on a native checkbox renders the platform widget: a blue square that
    // ignores the theme, dark mode, and the shared focus ring.
    const box = screen.getByRole('checkbox', { name: 'Toggle Work visibility' });
    expect(box.className).not.toContain('accent-primary');
    expect(box).toHaveClass('appearance-none', 'checked:bg-primary');
  });
  it('names each account above its own layers once more than one is linked', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    calendarSettingsGet.mockImplementation(() =>
      Promise.resolve(
        okResponse({
          connections: [
            makeConnection(WORK_CONNECTION, 'ada@work.example'),
            makeConnection(PERSONAL_CONNECTION, 'ada@personal.example'),
          ],
          calendars: [],
          layers: [],
        }),
      ),
    );
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    render(
      <CalendarLayerPanel
        layers={[
          makeLayer({
            id: LAYER_A,
            title: 'Work',
            connectionId: WORK_CONNECTION,
            provider: 'google',
            sourceKind: 'provider_calendar',
            externalLayerId: 'ada@work.example',
          }),
          makeLayer({
            id: LAYER_B,
            title: 'Personal',
            connectionId: PERSONAL_CONNECTION,
            provider: 'google',
            sourceKind: 'provider_calendar',
            externalLayerId: 'ada@personal.example',
          }),
        ]}
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ada@work.example' })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'ada@personal.example' })).toBeInTheDocument();
    // No duplicates here, so no bulk action is offered.
    expect(screen.queryByRole('button', { name: 'Hide duplicates' })).not.toBeInTheDocument();
  });

  it('offers an explicit Hide duplicates action and never hides anything on its own', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    calendarSettingsGet.mockImplementation(() =>
      Promise.resolve(
        okResponse({
          connections: [
            makeConnection(WORK_CONNECTION, 'ada@work.example'),
            makeConnection(PERSONAL_CONNECTION, 'ada@personal.example'),
          ],
          calendars: [],
          layers: [],
        }),
      ),
    );
    const holidayId = 'en.usa#holiday@group.v.calendar.google.com';
    const layers: CalendarLayerOut[] = [
      makeLayer({
        id: LAYER_A,
        title: 'Holidays in United States',
        connectionId: WORK_CONNECTION,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: holidayId,
        createdAt: '2026-06-01T00:00:00.000Z',
      }),
      makeLayer({
        id: LAYER_B,
        title: 'Holidays in United States',
        connectionId: PERSONAL_CONNECTION,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: holidayId,
        createdAt: '2026-07-01T00:00:00.000Z',
      }),
    ];
    client.setQueryData<CalendarLayersOut>(queryKeys.calendarLayers(), { items: layers });
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    render(<CalendarLayerPanel layers={layers} />, { wrapper });

    const hide = await screen.findByRole('button', { name: 'Hide duplicates' });
    expect(screen.getByText('1 duplicate calendar across accounts')).toBeInTheDocument();
    // Nothing has happened yet: both copies are still selected, and no write was attempted.
    expect(layerPatch).not.toHaveBeenCalled();
    const rowsBefore = screen.getAllByRole('listitem').length;
    // The redundant copy says which account keeps showing the same calendar.
    expect(await screen.findByText(/Also on ada@work\.example/)).toBeInTheDocument();

    fireEvent.click(hide);

    await waitFor(() => {
      const cached = client.getQueryData<CalendarLayersOut>(queryKeys.calendarLayers());
      expect(cached?.items.find((entry) => entry.id === LAYER_B)?.selected).toBe(false);
    });
    // The kept copy is untouched, and the hidden row is still listed and still toggleable.
    expect(
      client
        .getQueryData<CalendarLayersOut>(queryKeys.calendarLayers())
        ?.items.find((entry) => entry.id === LAYER_A)?.selected,
    ).toBe(true);
    expect(screen.getAllByRole('listitem').length).toBe(rowsBefore);
    expect(
      screen.getAllByRole('checkbox', { name: 'Toggle Holidays in United States visibility' }),
    ).toHaveLength(2);
    expect(layerPatch).toHaveBeenCalledTimes(1);
  });

  it('still lists layers when the linked-account read fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    calendarSettingsGet.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ title: 'boom' }) }),
    );
    const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    render(<CalendarLayerPanel layers={[makeLayer({ title: 'Focus' })]} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Focus')).toBeInTheDocument();
    });
    expect(screen.getByRole('checkbox', { name: 'Toggle Focus visibility' })).toBeEnabled();
  });
});
