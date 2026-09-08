import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TooltipProvider } from '@docket/ui/primitives';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutate, mutateAsync, queryState, refetch } = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(async (): Promise<unknown> => undefined),
  queryState: { fails: false },
  refetch: vi.fn(async (): Promise<unknown> => undefined),
}));

const PLACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PLAN_ID = '01BX5ZZKBKACTAV9WEVGEMMVS0';

/** Choose a schedule day through the shared date picker. */
function pickDay(field: string, iso: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${field} —`) }));
  const grid = screen.getByRole('grid', { name: field });
  fireEvent.click(within(grid).getByRole('button', { name: iso }));
}

const places = {
  items: [
    {
      id: PLACE_ID,
      name: 'Eastside library',
      address: '10 Library Lane',
      geofence: null,
      providerMappings: [],
      sort: 0,
      archivedAt: null,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    },
  ],
  profile: { homePlaceId: null },
};
const schedule = {
  plans: [
    {
      id: PLAN_ID,
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays: Array.from({ length: 7 }, (_, index) => ({
        segments:
          index < 5
            ? [
                {
                  startMinute: 540,
                  durationMinutes: 480,
                  location: { type: 'saved_place', placeId: PLACE_ID },
                },
              ]
            : [],
      })),
      revision: 1,
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    },
  ],
  exceptions: [
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVT1',
      planVersionId: PLAN_ID,
      date: '2026-09-18',
      segments: [],
      origin: 'docket',
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    },
  ],
};
const changes = {
  items: [
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVT2',
      connectionId: '01BX5ZZKBKACTAV9WEVGEMMVT3',
      provider: 'google',
      accountLabel: 'ada@example.com',
      kind: 'unmatched_place',
      payload: {
        kind: 'unmatched_place',
        label: 'Decatur Café',
        normalizedLabel: 'decatur cafe',
        externalEventId: 'decatur-cafe',
      },
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    },
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVT4',
      connectionId: '01BX5ZZKBKACTAV9WEVGEMMVT3',
      provider: 'google',
      accountLabel: 'ada@example.com',
      kind: 'schedule_conflict',
      payload: {
        kind: 'schedule_conflict',
        date: '2026-09-19',
        externalEventId: 'conflicting-saturday',
        docketSegments: [],
        providerSegments: [
          {
            startMinute: 540,
            durationMinutes: 480,
            location: { type: 'saved_place', placeId: PLACE_ID },
          },
        ],
      },
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    },
  ],
};

vi.mock('../../src/components/work-location/work-location-data', () => ({
  workLocationPlacesDef: () => ({ kind: 'places' }),
  workLocationPointDef: () => ({ kind: 'point' }),
  workScheduleDef: () => ({ kind: 'schedule' }),
  workScheduleChangesDef: () => ({ kind: 'changes' }),
}));

vi.mock('../../src/lib/query', () => ({
  queryKeys: {
    workLocation: () => ['work-location'],
    workSchedule: () => ['work-schedule'],
    workScheduleChanges: () => ['work-schedule-changes'],
  },
  useApiListQuery: (definition: { kind: string }) => ({
    data: definition.kind === 'places' ? places : changes,
    error: queryState.fails ? new Error('read failed') : null,
    isPending: false,
    refetch,
  }),
  useApiQuery: (definition: { kind: string }) => ({
    data:
      definition.kind === 'schedule'
        ? schedule
        : {
            current: { place: null, source: 'unknown' },
            expected: { place: null, source: 'unknown' },
          },
    error: queryState.fails ? new Error('read failed') : null,
    isPending: false,
    refetch,
  }),
  useApiMutation: () => ({
    mutate,
    mutateAsync,
    error: null,
    isPending: false,
  }),
  unwrap: vi.fn(),
}));

import PlacesSettingsPage from '../../src/app/(app)/settings/places/page';
import WorkScheduleSettingsPage from '../../src/app/(app)/settings/work-schedule/page';
import { AutomaticLocationProvider } from '../../src/components/work-location/automatic-location-provider';

function renderPage(page: React.ReactNode): void {
  render(
    <TooltipProvider>
      <AutomaticLocationProvider>{page}</AutomaticLocationProvider>
    </TooltipProvider>,
  );
}

function firstPlace(): (typeof places.items)[number] {
  const place = places.items[0];
  if (!place) throw new Error('The settings test requires one saved place');
  return place;
}

function firstScheduleException(): (typeof schedule.exceptions)[number] {
  const exception = schedule.exceptions[0];
  if (!exception) throw new Error('The settings test requires one dated exception');
  return exception;
}

function firstSchedulePlan(): (typeof schedule.plans)[number] {
  const plan = schedule.plans[0];
  if (!plan) throw new Error('The settings test requires one schedule plan');
  return plan;
}

afterEach(() => {
  cleanup();
  mutate.mockReset();
  mutateAsync.mockClear();
  refetch.mockClear();
  queryState.fails = false;
  localStorage.clear();
  Object.assign(firstPlace(), { geofence: null });
  Object.assign(firstSchedulePlan(), {
    effectiveFrom: '2026-09-07',
    effectiveUntil: null,
  });
  schedule.exceptions.splice(1);
  Reflect.deleteProperty(navigator, 'geolocation');
  vi.useRealTimers();
});

describe('WorkScheduleSettingsPage', () => {
  it('keeps default schedule and dated replacements in separate sections', () => {
    renderPage(<WorkScheduleSettingsPage />);

    expect(screen.getByRole('heading', { name: 'Work schedule' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Default schedule' })).toBeInTheDocument();
    expect(screen.getByText('Monday–Friday')).toBeInTheDocument();
    expect(screen.getByText('9:00 AM–5:00 PM · Eastside library')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Date changes' })).toBeInTheDocument();
    expect(screen.getAllByText('Not working').length).toBeGreaterThan(0);
    expect(screen.queryByText(/publish/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/imported/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Calendar sync' })).not.toBeInTheDocument();
  });

  it('opens a nested day editor from one default-plan action', () => {
    renderPage(<WorkScheduleSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit default schedule' }));
    expect(screen.getByRole('dialog', { name: 'Edit default schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Monday/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Monday' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add work period' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy day' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeInTheDocument();
  });

  it('starts a new version without shifting the cycle anchor', () => {
    renderPage(<WorkScheduleSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit default schedule' }));
    pickDay('Schedule applies from', '2026-09-15');
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        anchorDate: '2026-09-07',
        effectiveFrom: '2026-09-15',
      }),
    );
  });

  it('builds a dated replacement from multiple overnight-capable work periods', () => {
    renderPage(<WorkScheduleSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add date change' }));
    expect(screen.getByRole('dialog', { name: 'Add date change' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add work period' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add work period' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'End day for period 1' }), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Location for period 2' }), {
      target: { value: 'mobile' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save date change' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [
          expect.objectContaining({ durationMinutes: 1_920 }),
          expect.objectContaining({ location: { type: 'mobile' } }),
        ],
      }),
    );
  });

  it('starts dated changes when the next schedule version takes effect', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    Object.assign(firstSchedulePlan(), { effectiveFrom: '2026-09-10' });
    renderPage(<WorkScheduleSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Add date change' }));

    const trigger = screen.getByRole('button', { name: /^Date change —/ });
    expect(trigger).toHaveTextContent('Sep 10, 2026');
    fireEvent.click(trigger);
    const grid = screen.getByRole('grid', { name: 'Date change' });
    expect(within(grid).getByRole('button', { name: '2026-09-09' })).toBeDisabled();
  });

  it('keeps past date changes behind a history disclosure', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    schedule.exceptions.push({
      ...firstScheduleException(),
      id: '01BX5ZZKBKACTAV9WEVGEMMVV1',
      date: '2026-08-18',
    });

    renderPage(<WorkScheduleSettingsPage />);

    expect(screen.queryByText('Aug 18, 2026')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Past date changes, 1' }));
    expect(screen.getByText('Aug 18, 2026')).toBeInTheDocument();
  });

  it('resolves a conflicting connected-account edit with one concrete choice', async () => {
    renderPage(<WorkScheduleSettingsPage />);

    expect(screen.getByRole('heading', { name: 'Incoming changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByRole('dialog', { name: /Resolve Sep 19, 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep Docket schedule' }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });
  });

  it('offers a retry instead of exposing schedule actions after a read failure', () => {
    queryState.fails = true;
    renderPage(<WorkScheduleSettingsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your work schedule.');
    expect(screen.queryByRole('button', { name: 'Edit default schedule' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(3);
  });
});

describe('PlacesSettingsPage', () => {
  it('offers setup instead of an unexplained disabled automatic-location button', () => {
    renderPage(<PlacesSettingsPage />);

    expect(screen.getByRole('heading', { name: 'Places' })).toBeInTheDocument();
    const setup = screen.getByRole('button', { name: 'Set up automatic location' });
    expect(setup).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Automatic location' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Choose a saved place, then add its location on the map.'),
    ).toBeInTheDocument();
  });

  it('uses Resolve as the queue action and never mixes in Review or Compare', async () => {
    renderPage(<PlacesSettingsPage />);

    expect(screen.getByRole('heading', { name: 'Unmatched names' })).toBeInTheDocument();
    expect(screen.getByText('Decatur Café')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByRole('dialog', { name: 'Resolve Decatur Café' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Saved place' }), {
      target: { value: PLACE_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Resolve$/ }));
    await waitFor(() => {
      expect(mutate).toHaveBeenCalled();
    });
  });

  it('can create a saved place from an unmatched connected-account name', async () => {
    mutateAsync.mockResolvedValueOnce({ place: firstPlace(), projections: [] });
    renderPage(<PlacesSettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new place' }));

    expect(screen.getByRole('dialog', { name: 'Add place' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Decatur Café');
    fireEvent.click(screen.getByRole('button', { name: 'Save place' }));

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith({
        id: changes.items[0]?.id,
        resolution: { action: 'link_place', placeId: PLACE_ID },
      });
    });
  });

  it('keeps automatic location active across the authenticated app after opt-in', async () => {
    Object.assign(firstPlace(), {
      geofence: { latitude: 36.17, longitude: -115.14, radiusMeters: 180 },
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition: vi.fn(() => 1), clearWatch: vi.fn() },
    });
    localStorage.setItem('docket.work-location.device-opt-in', '1');

    renderPage(<PlacesSettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Automatic location' })).toBeChecked();
    });
  });

  it('explains when this browser cannot run automatic location', async () => {
    Object.assign(firstPlace(), {
      geofence: { latitude: 36.17, longitude: -115.14, radiusMeters: 180 },
    });

    renderPage(<PlacesSettingsPage />);

    expect(
      await screen.findByText('This browser does not provide location access.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Automatic location' })).toBeDisabled();
  });

  it('offers a retry instead of allowing place creation after a read failure', () => {
    queryState.fails = true;
    renderPage(<PlacesSettingsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your saved places.');
    expect(screen.queryByRole('button', { name: 'Add place' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(3);
  });
});
