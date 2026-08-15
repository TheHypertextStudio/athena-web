import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TooltipProvider } from '@docket/ui/primitives';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutate, mutateAsync } = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => undefined),
}));

const places = {
  items: [
    {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      name: 'Family home',
      address: '18 Juniper Way',
      geofence: null,
      providerMappings: [],
      sort: 0,
      archivedAt: null,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
      name: 'Eastside library',
      address: '10 Library Lane',
      geofence: { latitude: 36.1699, longitude: -115.1398, radiusMeters: 250 },
      providerMappings: [
        {
          provider: 'google',
          connectionId: '01BX5ZZKBKACTAV9WEVGEMMVS2',
          classification: 'officeLocation',
          providerPlaceId: 'building-east',
          metadata: {},
        },
      ],
      sort: 1,
      archivedAt: null,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
  ],
  profile: { homePlaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
};

const assertions = {
  items: [
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVS1',
      placeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-08-10',
        effectiveUntil: null,
        weekdays: [0, 2],
        timezone: 'America/Los_Angeles',
      },
      exceptions: [],
      origin: 'docket',
      originProvider: null,
      originConnectionId: null,
      revision: 1,
      archivedAt: null,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
  ],
};

vi.mock('../../src/components/work-location/work-location-data', () => ({
  workLocationPlacesDef: () => ({ kind: 'places' }),
  workLocationAssertionsDef: () => ({ kind: 'assertions' }),
  workLocationSyncDef: () => ({ kind: 'sync' }),
  workLocationPointDef: () => ({ kind: 'point' }),
}));

vi.mock('../../src/lib/query', () => ({
  STALE: { standard: 30_000 },
  queryKeys: {
    workLocation: () => ['work-location'],
    hubPreferences: () => ['hub-preferences'],
    schedulePreferences: () => ['schedule-preferences'],
  },
  apiQueryOptions: (queryKey: readonly string[]) => ({ queryKey }),
  unwrap: vi.fn(),
  useApiListQuery: (definition: { kind: string }) =>
    definition.kind === 'places'
      ? { data: places, error: null, isPending: false, isError: false }
      : { data: assertions, error: null, isPending: false, isError: false },
  useApiQuery: (definition: { kind?: string; queryKey?: readonly string[] }) => {
    if (definition.kind === 'point') {
      return {
        data: {
          at: '2026-08-14T12:00:00.000Z',
          current: {
            place: { id: '01BX5ZZKBKACTAV9WEVGEMMVRZ', name: 'Eastside library' },
            source: 'manual',
            confidence: 'declared',
            effectiveStart: '2026-08-14T12:00:00.000Z',
            effectiveEnd: '2026-08-15T07:00:00.000Z',
            observedAt: '2026-08-14T12:00:00.000Z',
            expiresAt: '2026-08-15T07:00:00.000Z',
          },
          expected: {
            place: null,
            source: 'unknown',
            confidence: 'unknown',
            effectiveStart: null,
            effectiveEnd: null,
            observedAt: null,
            expiresAt: null,
          },
        },
        error: null,
        isPending: false,
        isError: false,
      };
    }
    if (definition.kind === 'sync') {
      return {
        data: {
          ready: true,
          accounts: [
            {
              connectionId: '01BX5ZZKBKACTAV9WEVGEMMVS2',
              provider: 'google',
              accountLabel: 'ada@example.com',
              state: 'action_required',
              reason: 'unsupported_recurrence',
              pendingWrites: 0,
            },
          ],
        },
        error: null,
        isPending: false,
        isError: false,
      };
    }
    if (definition.queryKey?.[0] === 'hub-preferences') {
      return {
        data: { timezone: 'America/Los_Angeles' },
        error: null,
        isPending: false,
        isError: false,
      };
    }
    return {
      data: {
        commitments: [
          {
            id: 'commitment-writing',
            title: 'Writing practice',
            sessionsPerWeek: 3,
            workPlaceId: null,
            location: null,
          },
        ],
      },
      error: null,
      isPending: false,
      isError: false,
    };
  },
  useApiMutation: () => ({
    mutate,
    mutateAsync,
    error: null,
    isPending: false,
    isError: false,
  }),
}));

import WorkLocationsSettingsPage from '../../src/app/(app)/settings/work-locations/page';

function renderPage(): void {
  render(
    <TooltipProvider>
      <WorkLocationsSettingsPage />
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mutate.mockReset();
  mutateAsync.mockClear();
});

describe('WorkLocationsSettingsPage', () => {
  it('starts with a compact place list and discloses configuration only from Add place', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Work locations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add place' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Regular places' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Name every regular place/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/geofence radius/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save name' })).not.toBeInTheDocument();
    expect(screen.getByText('18 Juniper Way')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add place' }));
    expect(screen.getByRole('dialog', { name: 'Add place' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Address (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose on map' })).toBeInTheDocument();
  });

  it('uses icon utilities and an overflow menu for place actions', async () => {
    renderPage();

    expect(screen.getByText('Current')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set Family home as current location' }));
    expect(mutate).toHaveBeenCalledWith('01ARZ3NDEKTSV4RRFFQ69G5FAV');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions for Eastside library' }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit place' })).toBeInTheDocument();
    });
    expect(screen.getByRole('menuitem', { name: 'Make home' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Retire place' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make home' }));
    expect(mutate).toHaveBeenCalledWith('01BX5ZZKBKACTAV9WEVGEMMVRZ');
  });

  it('keeps schedule and occurrence controls behind explicit actions', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Schedule' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
    expect(screen.getByRole('dialog', { name: 'Add schedule' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Schedule' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add schedule' })).not.toBeInTheDocument();
    });
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Actions for Family home schedule' }),
      { button: 0, ctrlKey: false },
    );
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit schedule' })).toBeInTheDocument();
    });
    expect(screen.getByRole('menuitem', { name: 'Change one occurrence' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete schedule' })).toBeInTheDocument();
  });

  it('uses application-owned guidance for account action states', () => {
    renderPage();

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(
      screen.getByText('Change the Google recurrence to daily or weekly to continue'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Google work locations appear as public calendar events.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/settings/connections/google-calendar',
    );
  });

  it('requires an explicit occurrence when a one-off clock time repeats', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Schedule' }), {
      target: { value: 'one_off_timed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Date — not set/ }));
    fireEvent.click(screen.getByRole('button', { name: '2026-11-01' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '01:30' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '02:30' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(
      screen.getByText('Choose Earlier or Later for the repeated start time.'),
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Start occurrence' })).getByText(/Earlier/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(mutate).toHaveBeenCalledWith({
      placeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      schedule: {
        type: 'one_off_timed',
        startsAt: '2026-11-01T08:30:00Z',
        endsAt: '2026-11-01T10:30:00Z',
        timezone: 'America/Los_Angeles',
      },
    });
  });
});
