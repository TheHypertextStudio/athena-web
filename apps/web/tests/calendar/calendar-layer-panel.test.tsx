/** Behavior tests for the server-grouped Calendar layer panel. */
import '@testing-library/jest-dom/vitest';

import type {
  CalendarLayerOut,
  CalendarLayersOut,
  CalendarSettingsOut,
  CalendarSourceGroupOut,
} from '@docket/planning/calendar-contract';
import { CalendarConnectionId, CalendarLayerId } from '@docket/planning/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { calendarSettingsGet, layerPatch, sourceGroupPatch } = vi.hoisted(() => ({
  calendarSettingsGet: vi.fn(),
  layerPatch: vi.fn(),
  sourceGroupPatch: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          $get: calendarSettingsGet,
          layers: { ':id': { $patch: layerPatch } },
          'source-groups': { ':id': { $patch: sourceGroupPatch } },
        },
      },
    },
  },
}));

import CalendarLayerPanel from '../../src/components/calendar/calendar-layer-panel';
import { queryKeys } from '../../src/lib/query';

const LAYER_A = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN1');
const LAYER_B = CalendarLayerId.parse('01BX5ZZKBKACTAV9WEVGEMMVN2');
const CONNECTION_A = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVC1');
const CONNECTION_B = CalendarConnectionId.parse('01BX5ZZKBKACTAV9WEVGEMMVC2');

function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

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

function makeGroup(overrides: Partial<CalendarSourceGroupOut> = {}): CalendarSourceGroupOut {
  return {
    id: 'exact_personal',
    persistedGroupId: null,
    provenance: 'exact',
    title: 'Personal',
    color: '#2563eb',
    selected: true,
    visibleByDefault: true,
    preferredLayerId: LAYER_B,
    sources: [
      {
        layerId: LAYER_A,
        connectionId: CONNECTION_A,
        relationship: 'shared',
        management: { canRemoveSubscription: true, requiresIncrementalConsent: true },
      },
      {
        layerId: LAYER_B,
        connectionId: CONNECTION_B,
        relationship: 'owned',
        management: { canRemoveSubscription: false, requiresIncrementalConsent: false },
      },
    ],
    ...overrides,
  };
}

function settings(groups: CalendarSourceGroupOut[]): CalendarSettingsOut {
  return {
    connections: [],
    calendars: [],
    layers: [],
    sourceGroups: groups,
    sourceGroupSuggestions: [],
  };
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }): JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  calendarSettingsGet.mockReset().mockResolvedValue(okResponse(settings([])));
  layerPatch.mockReset().mockResolvedValue(okResponse(makeLayer()));
  sourceGroupPatch.mockReset().mockResolvedValue(okResponse(settings([makeGroup()])));
});

afterEach(() => {
  cleanup();
});

describe('CalendarLayerPanel', () => {
  it('renders one server-resolved row for a calendar on two accounts', async () => {
    const layers = [
      makeLayer({
        id: LAYER_A,
        connectionId: CONNECTION_A,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'personal@example.test',
        title: 'Personal from work',
      }),
      makeLayer({
        id: LAYER_B,
        connectionId: CONNECTION_B,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'personal@example.test',
        title: 'Personal',
      }),
    ];
    calendarSettingsGet.mockResolvedValue(okResponse(settings([makeGroup()])));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData<CalendarLayersOut>(queryKeys.calendarLayers(), { items: layers });

    render(<CalendarLayerPanel layers={layers} />, { wrapper: wrapperFor(client) });

    expect(await screen.findByText('2 accounts')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: 'Toggle Personal visibility' })).toHaveLength(1);
    expect(screen.queryByText(/arrives on more than one account/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show each copy/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle Personal visibility' }));

    await waitFor(() => {
      expect(sourceGroupPatch).toHaveBeenCalledWith({
        param: { id: 'exact_personal' },
        json: { selected: false, visibleByDefault: false },
      });
    });
    expect(sourceGroupPatch).toHaveBeenCalledTimes(1);
    expect(layerPatch).not.toHaveBeenCalled();
    expect(
      client
        .getQueryData<CalendarLayersOut>(queryKeys.calendarLayers())
        ?.items.map((layer) => layer.selected),
    ).toEqual([false, false]);
  });

  it('uses the preferred source presentation for a logical row', async () => {
    const layers = [
      makeLayer({ id: LAYER_A, title: 'Wrong source title', color: '#ef4444' }),
      makeLayer({ id: LAYER_B, title: 'Preferred source title', color: '#f59e0b' }),
    ];
    calendarSettingsGet.mockResolvedValue(
      okResponse(settings([makeGroup({ title: 'Canonical title', color: '#2563eb' })])),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<CalendarLayerPanel layers={layers} />, { wrapper: wrapperFor(client) });

    expect(await screen.findByText('Canonical title')).toBeInTheDocument();
    expect(screen.queryByText('Wrong source title')).not.toBeInTheDocument();
    expect(screen.queryByText('Preferred source title')).not.toBeInTheDocument();
  });

  it('falls back to raw layers when logical settings fail', async () => {
    calendarSettingsGet.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: 'internal' }),
    });
    const layers = [makeLayer({ id: LAYER_A }), makeLayer({ id: LAYER_B, title: 'Meetings' })];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<CalendarLayerPanel layers={layers} />, { wrapper: wrapperFor(client) });

    await waitFor(() => {
      expect(screen.getByText('Focus')).toBeInTheDocument();
    });
    expect(screen.getByText('Meetings')).toBeInTheDocument();
  });

  it('renders an empty-state note when there are no layers', () => {
    const client = new QueryClient();
    render(<CalendarLayerPanel layers={[]} />, { wrapper: wrapperFor(client) });
    expect(screen.getByText(/No calendar layers yet/)).toBeInTheDocument();
  });

  it('does not render stored provider diagnostics', async () => {
    const layer = makeLayer({
      lastError: 'AGENT_MAX_TURNS is not configured; refusing to run agent sessions',
    });
    calendarSettingsGet.mockResolvedValue(
      okResponse(
        settings([
          makeGroup({
            id: 'layer_focus',
            provenance: 'single',
            title: 'Focus',
            preferredLayerId: layer.id,
            sources: [
              {
                layerId: layer.id,
                connectionId: null,
                relationship: null,
                management: {
                  canRemoveSubscription: false,
                  requiresIncrementalConsent: false,
                },
              },
            ],
          }),
        ]),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(<CalendarLayerPanel layers={[layer]} />, { wrapper: wrapperFor(client) });

    expect(await screen.findByText('Focus')).toBeInTheDocument();
    expect(screen.getByRole('list')).not.toHaveTextContent('AGENT_MAX_TURNS');
  });
});
