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
 */
import '@testing-library/jest-dom/vitest';

import { CalendarLayerId, type CalendarLayerOut, type CalendarLayersOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { layerPatch } = vi.hoisted(() => ({ layerPatch: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          layers: {
            ':id': { $patch: layerPatch },
          },
        },
      },
    },
  },
}));

import CalendarLayerPanel from '../../src/components/calendar/calendar-layer-panel';
import { queryKeys } from '../../src/lib/query';

const LAYER_A = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const LAYER_B = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN2');

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

  it('uses fixed sync-health copy instead of rendering stored diagnostic text', () => {
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

    expect(screen.getByRole('img', { name: 'Calendar sync issue' })).toBeInTheDocument();
    expect(screen.getByRole('list')).not.toHaveTextContent('AGENT_MAX_TURNS');
  });
});
