import '@testing-library/jest-dom/vitest';

import { type JSX, type ReactNode, useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueryModule from '../../src/lib/query';

vi.mock('@/components/work-location/use-work-location-calendar-composition', () => ({
  useWorkLocationCalendarComposition: () => ({ canvasProps: {}, overlays: null }),
}));

const DAY = '2026-07-13';
const NEXT_DAY = '2026-07-14';

const preferencesState = vi.hoisted<{
  data: { timezone: string } | undefined;
  isError: boolean;
}>(() => ({ data: { timezone: 'America/Los_Angeles' }, isError: false }));
const queryFixtures = vi.hoisted(() => ({
  prefetch: vi.fn(),
  preferencesRefetch: vi.fn(),
  agendaRefetch: vi.fn(),
  calendarRefetch: vi.fn(),
  planRefetch: vi.fn(),
  agenda: {
    date: '2026-07-13',
    entries: [
      {
        kind: 'task_timebox',
        taskId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
        organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
        title: 'Previous day task',
        state: 'started',
        priority: 'medium',
        startsAt: '2026-07-13T16:00:00Z',
        endsAt: '2026-07-13T17:00:00Z',
      },
    ],
  },
  calendar: {
    layers: [{ id: 'layer-1', color: '#2563eb' }],
    items: [
      {
        id: 'calendar-item-1',
        layerId: 'layer-1',
        title: 'Previous day event',
        startsAt: '2026-07-13T18:00:00Z',
        endsAt: '2026-07-13T19:00:00Z',
        htmlLink: null,
      },
    ],
  },
}));

vi.mock('../../src/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof QueryModule>();
  const result = (
    data: unknown,
    isPlaceholderData = false,
    isError = false,
    refetch: () => unknown = vi.fn(),
  ) => ({
    data,
    isPending: false,
    isError,
    isPlaceholderData,
    isFetching: false,
    refetch,
  });
  return {
    ...actual,
    useApiQuery: () =>
      result(
        preferencesState.data,
        false,
        preferencesState.isError,
        queryFixtures.preferencesRefetch,
      ),
    useApiListQuery: (definition: { queryKey?: readonly unknown[] }) => {
      const key = definition.queryKey ?? [];
      if (key[1] === 'agenda') {
        return result(queryFixtures.agenda, key[2] !== DAY, false, queryFixtures.agendaRefetch);
      }
      if (key[1] === 'calendar-items') {
        return result(
          queryFixtures.calendar,
          key[2] !== '2026-07-13T07:00:00Z',
          false,
          queryFixtures.calendarRefetch,
        );
      }
      return result({ items: [] }, key[2] !== DAY, false, queryFixtures.planRefetch);
    },
    usePrefetchApi: () => queryFixtures.prefetch,
  };
});

vi.mock('../../src/components/agenda/agenda-mutations', () => ({
  useAgendaPlanMutations: () => ({}),
}));

vi.mock('../../src/lib/view-transition', () => ({
  startViewTransition: (update: () => void) => {
    update();
  },
}));

import { AgendaProvider, useAgenda } from '../../src/components/agenda/agenda-context';
import AgendaHeader from '../../src/components/agenda/agenda-header';

interface CrossZoneMidnightFixture {
  readonly displayTimezone: string;
  readonly beforeMidnight: string;
}

function browserDate(instant: string): string {
  const date = new Date(instant);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

/** Pick a display-zone midnight that does not coincide with the test browser's midnight. */
function crossZoneMidnightFixture(): CrossZoneMidnightFixture {
  const tokyo = {
    displayTimezone: 'Asia/Tokyo',
    beforeMidnight: '2026-07-13T14:59:50.000Z',
  };
  const afterTokyoMidnight = '2026-07-13T15:00:20.000Z';
  if (browserDate(tokyo.beforeMidnight) === browserDate(afterTokyoMidnight)) return tokyo;
  return {
    displayTimezone: 'America/Los_Angeles',
    beforeMidnight: '2026-07-14T06:59:50.000Z',
  };
}

function AgendaProbe(): JSX.Element {
  const { date, entries, isToday, goToDate, goToNextDay, goToToday } = useAgenda();
  return (
    <div>
      <output aria-label="Selected date">{date}</output>
      <output aria-label="Is today">{String(isToday)}</output>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>{entry.title}</li>
        ))}
      </ul>
      <button type="button" onClick={goToNextDay}>
        Next day
      </button>
      <button
        type="button"
        onClick={() => {
          goToDate('2026-08-24');
        }}
      >
        Jump to August 24
      </button>
      <button type="button" onClick={goToToday}>
        Go to today
      </button>
    </div>
  );
}

function TestProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  return <AgendaProvider initialDate={DAY}>{children}</AgendaProvider>;
}

function ImplicitDateProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  return <AgendaProvider>{children}</AgendaProvider>;
}

function AgendaRetryProbe(): JSX.Element {
  const { retry } = useAgenda();
  return (
    <button type="button" onClick={retry}>
      Retry agenda reads
    </button>
  );
}

function GuardedNavigationProbe({ allow }: { readonly allow: boolean }): JSX.Element {
  const { date, goToNextDay, registerNavigationGuard } = useAgenda();
  useEffect(() => registerNavigationGuard(() => allow), [allow, registerNavigationGuard]);
  return (
    <div>
      <output aria-label="Guarded date">{date}</output>
      <button type="button" onClick={goToNextDay}>
        Guarded next day
      </button>
    </div>
  );
}

describe('AgendaProvider day navigation', () => {
  beforeEach(() => {
    queryFixtures.preferencesRefetch.mockReset();
    queryFixtures.agendaRefetch.mockReset();
    queryFixtures.calendarRefetch.mockReset();
    queryFixtures.planRefetch.mockReset();
  });

  it('exposes one retry action that refreshes every agenda read dependency', () => {
    render(<AgendaRetryProbe />, { wrapper: TestProvider });

    fireEvent.click(screen.getByRole('button', { name: 'Retry agenda reads' }));

    expect(queryFixtures.preferencesRefetch).toHaveBeenCalledOnce();
    expect(queryFixtures.agendaRefetch).toHaveBeenCalledOnce();
    expect(queryFixtures.calendarRefetch).toHaveBeenCalledOnce();
    expect(queryFixtures.planRefetch).toHaveBeenCalledOnce();
  });

  it('does not render previous-day list placeholders under the next-day heading', () => {
    render(<AgendaProbe />, { wrapper: TestProvider });

    expect(screen.getByText('Previous day task')).toBeInTheDocument();
    expect(screen.getByText('Previous day event')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));

    expect(screen.getByLabelText('Selected date')).toHaveTextContent(NEXT_DAY);
    expect(screen.queryByText('Previous day task')).not.toBeInTheDocument();
    expect(screen.queryByText('Previous day event')).not.toBeInTheDocument();
  });

  it('supports direct date selection without repeated day stepping', () => {
    render(<AgendaProbe />, { wrapper: TestProvider });

    fireEvent.click(screen.getByRole('button', { name: 'Jump to August 24' }));

    expect(screen.getByLabelText('Selected date')).toHaveTextContent('2026-08-24');
  });

  it('lets an open edited draft veto date navigation', () => {
    const view = render(<GuardedNavigationProbe allow={false} />, { wrapper: TestProvider });

    fireEvent.click(screen.getByRole('button', { name: 'Guarded next day' }));
    expect(screen.getByLabelText('Guarded date')).toHaveTextContent(DAY);

    view.rerender(<GuardedNavigationProbe allow />);
    fireEvent.click(screen.getByRole('button', { name: 'Guarded next day' }));
    expect(screen.getByLabelText('Guarded date')).toHaveTextContent(NEXT_DAY);
  });

  it('reconciles an untouched fallback date when preferences recover after an initial error', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T16:00:00Z'));
    preferencesState.data = undefined;
    preferencesState.isError = true;

    try {
      const view = render(<AgendaProbe />, { wrapper: ImplicitDateProvider });
      expect(screen.getByLabelText('Selected date')).toHaveTextContent('2026-07-13');

      preferencesState.data = { timezone: 'Asia/Tokyo' };
      preferencesState.isError = false;
      view.rerender(<AgendaProbe />);

      expect(screen.getByLabelText('Selected date')).toHaveTextContent('2026-07-14');
    } finally {
      preferencesState.data = { timezone: 'America/Los_Angeles' };
      preferencesState.isError = false;
      vi.useRealTimers();
    }
  });

  it('updates today semantics and navigation after midnight in the display timezone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T14:59:50.000Z'));
    preferencesState.data = { timezone: 'Asia/Tokyo' };

    try {
      render(<AgendaProbe />, { wrapper: TestProvider });

      expect(screen.getByLabelText('Selected date')).toHaveTextContent(DAY);
      expect(screen.getByLabelText('Is today')).toHaveTextContent('true');

      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(screen.getByLabelText('Is today')).toHaveTextContent('false');

      fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));

      expect(screen.getByLabelText('Selected date')).toHaveTextContent(NEXT_DAY);
      expect(screen.getByLabelText('Is today')).toHaveTextContent('true');
    } finally {
      preferencesState.data = { timezone: 'America/Los_Angeles' };
      vi.useRealTimers();
    }
  });

  it('uses the live display-zone day for header labels and its Today action', () => {
    const fixture = crossZoneMidnightFixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fixture.beforeMidnight));
    preferencesState.data = { timezone: fixture.displayTimezone };

    try {
      render(
        <>
          <AgendaHeader />
          <AgendaProbe />
        </>,
        { wrapper: TestProvider },
      );

      expect(screen.getByRole('button', { name: 'Agenda date — July 2026' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Monday, July 13' })).toHaveAttribute(
        'data-agenda-today',
      );

      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(screen.getByRole('button', { name: 'Tuesday, July 14' })).toHaveAttribute(
        'data-agenda-today',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Agenda date — July 2026' }));
      fireEvent.click(screen.getByRole('button', { name: 'Today' }));

      expect(screen.getByLabelText('Selected date')).toHaveTextContent(NEXT_DAY);
      expect(screen.getByRole('button', { name: 'Tuesday, July 14' })).toHaveAttribute(
        'aria-current',
        'date',
      );
    } finally {
      preferencesState.data = { timezone: 'America/Los_Angeles' };
      vi.useRealTimers();
    }
  });

  it('uses the shared date picker for a direct calendar jump', () => {
    render(
      <>
        <AgendaHeader />
        <AgendaProbe />
      </>,
      { wrapper: TestProvider },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agenda date — July 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    fireEvent.click(screen.getByRole('button', { name: '2026-08-24' }));

    expect(screen.getByLabelText('Selected date')).toHaveTextContent('2026-08-24');
    return waitFor(() => {
      expect(screen.queryByRole('grid', { name: 'Agenda date' })).not.toBeInTheDocument();
    });
  });

  it('moves directly between visible dates without rendering arrow buttons', () => {
    render(
      <>
        <AgendaHeader />
        <AgendaProbe />
      </>,
      { wrapper: TestProvider },
    );

    const controls = within(screen.getByRole('group', { name: 'Agenda date navigation' }));
    expect(controls.queryByRole('button', { name: 'Previous day' })).not.toBeInTheDocument();
    expect(controls.queryByRole('button', { name: 'Next day' })).not.toBeInTheDocument();
    fireEvent.click(controls.getByRole('button', { name: 'Sunday, July 12' }));
    expect(screen.getByLabelText('Selected date')).toHaveTextContent('2026-07-12');

    fireEvent.click(controls.getByRole('button', { name: 'Monday, July 13' }));
    expect(screen.getByLabelText('Selected date')).toHaveTextContent(DAY);
  });

  it('supports day and Today keyboard shortcuts from the header', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T16:00:00.000Z'));

    try {
      render(
        <>
          <AgendaHeader />
          <AgendaProbe />
        </>,
        { wrapper: TestProvider },
      );
      const controls = screen.getByRole('group', { name: 'Agenda date navigation' });

      fireEvent.keyDown(controls, { key: 'ArrowRight' });
      expect(screen.getByLabelText('Selected date')).toHaveTextContent(NEXT_DAY);

      fireEvent.keyDown(controls, { key: 'ArrowLeft' });
      expect(screen.getByLabelText('Selected date')).toHaveTextContent(DAY);

      fireEvent.keyDown(controls, { key: 't' });
      expect(screen.getByLabelText('Selected date')).toHaveTextContent('2026-07-15');

      fireEvent.keyDown(controls, { key: 'g' });
      expect(screen.getByRole('grid', { name: 'Agenda date' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('separates direct date navigation from one labeled view menu', async () => {
    render(<AgendaHeader />, { wrapper: TestProvider });

    const controls = screen.getByRole('group', { name: 'Agenda date navigation' });
    const date = screen.getByRole('button', { name: 'Agenda date — July 2026' });
    const display = screen.getByRole('button', { name: 'Timeline view options' });
    expect(controls).toContainElement(date);
    expect(controls).toContainElement(display);
    expect(date).toHaveClass('min-h-10');
    expect(display).toHaveClass('min-h-10');
    expect(screen.queryByRole('group', { name: 'Agenda zoom' })).not.toBeInTheDocument();

    fireEvent.pointerDown(display, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Comfortable' }));
    expect(screen.getByRole('button', { name: 'Timeline view options' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Timeline view options' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List view options' })).toBeInTheDocument();
  });
});
