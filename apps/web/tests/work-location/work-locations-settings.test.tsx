import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mutate.mockReset();
  mutateAsync.mockClear();
});

describe('WorkLocationsSettingsPage', () => {
  it('edits arbitrary places, series, occurrences, current evidence, and planning bindings', async () => {
    render(<WorkLocationsSettingsPage />);

    expect(screen.getAllByDisplayValue('Family home')).not.toHaveLength(0);
    expect(screen.getAllByDisplayValue('Eastside library')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Clear home' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Designate home' }));
    expect(mutate).toHaveBeenCalledWith('01BX5ZZKBKACTAV9WEVGEMMVRZ');

    await waitFor(() => {
      expect(screen.getByLabelText('Move whole series')).toHaveValue('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    });
    fireEvent.change(screen.getByLabelText('Move whole series'), {
      target: { value: '01BX5ZZKBKACTAV9WEVGEMMVRZ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change whole series' }));
    expect(mutate).toHaveBeenCalledWith({
      id: '01BX5ZZKBKACTAV9WEVGEMMVS1',
      nextPlaceId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
    });

    fireEvent.click(screen.getByRole('button', { name: /One occurrence/ }));
    fireEvent.click(screen.getByRole('button', { name: '2026-08-17' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel occurrence' }));
    expect(mutate).toHaveBeenCalledWith({
      id: '01BX5ZZKBKACTAV9WEVGEMMVS1',
      date: '2026-08-17',
      input: { action: 'cancel', date: '2026-08-17' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore occurrence' }));
    expect(mutate).toHaveBeenCalledWith({
      id: '01BX5ZZKBKACTAV9WEVGEMMVS1',
      date: '2026-08-17',
    });

    const libraryInput = screen
      .getAllByLabelText('Name')
      .find((input) => (input as HTMLInputElement).value === 'Eastside library');
    const libraryRow = libraryInput?.closest<HTMLElement>('.bg-surface-container-low');
    if (!libraryRow) throw new Error('Expected the saved place row');
    expect(within(libraryRow).getByText('Google · office location')).toBeInTheDocument();
    fireEvent.click(within(libraryRow).getByRole('button', { name: 'Clear geofence' }));
    expect(mutate).toHaveBeenCalledWith({
      id: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
      patch: { geofence: null },
    });
    fireEvent.click(within(libraryRow).getByRole('button', { name: 'I’m here now' }));
    expect(mutate).toHaveBeenCalledWith('01BX5ZZKBKACTAV9WEVGEMMVRZ');

    fireEvent.change(screen.getByLabelText('Saved place'), {
      target: { value: '01BX5ZZKBKACTAV9WEVGEMMVRZ' },
    });
    expect(mutate).toHaveBeenCalledWith({
      commitmentId: 'commitment-writing',
      nextPlaceId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
    });
  });

  it('uses application-owned guidance for account action states', () => {
    render(<WorkLocationsSettingsPage />);

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(
      screen.getByText('Change the Google recurrence to daily or weekly to continue'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Google requires synced working-location events to use public/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review account' })).toHaveAttribute(
      'href',
      '/settings/connections/google-calendar',
    );
  });

  it('requires an explicit occurrence when a one-off clock time repeats', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    render(<WorkLocationsSettingsPage />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Schedule' }), {
      target: { value: 'one_off_timed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Date — not set/ }));
    fireEvent.click(screen.getByRole('button', { name: '2026-11-01' }));
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '01:30' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '02:30' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add expected location' }));
    expect(
      screen.getByText('Choose Earlier or Later for the repeated start time.'),
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Start occurrence' })).getByText(/Earlier/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add expected location' }));
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
