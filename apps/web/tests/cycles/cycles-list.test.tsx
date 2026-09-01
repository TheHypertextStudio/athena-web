import '@testing-library/jest-dom/vitest';

/**
 * The Cycles list surface — its naming, its header, and its focused active-cycle overview.
 *
 * @remarks
 * Pins the four things the Cycles rewrite had to deliver and that a screenshot alone cannot keep
 * from regressing:
 *
 * - **No meaningless names.** Nothing rendered may read as `Cycle <auto-roll number>`; a cycle is
 *   its author-set name or its window.
 * - **No page subtitle.** The orientation line under the title was removed outright, not moved.
 * - **A real overview.** The active cycle's identity, window + runway, progress counts and
 *   workload points are on the list itself, not one click away on the detail route.
 * - **Shared primitives.** The overview's related tasks render through the *shared* `TaskTable`,
 *   so its rows carry the same chrome and interactions as every other task list in the app.
 *
 * The query layer is mocked at the module boundary (the pattern
 * `tests/agenda/agenda-context-navigation.test.tsx` uses) so the surface renders synchronously
 * from fixtures with no network. A `QueryClientProvider` is still required, though: the shared
 * `TaskTable` the overview renders through grows a `TaskTimerButton` per row, and that
 * control reads the caller's one tracker via the real (unstubbed) `useLiveApiQuery` — so
 * `renderWithProviders` below supplies a client and mocks the transport it calls through.
 */
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX, ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type * as QueryModule from '../../src/lib/query';
import type * as TaskTableModule from '../../src/components/views/task-table';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ACTIVE_CYCLE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA1';
const UPCOMING_CYCLE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA2';
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA3';
const TEAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA4';

/** The auto-roll number range the audit found leaking into the UI as "Cycle 1000135". */
const RAW_NUMBER_NAME = /Cycle \d{5,}/;

const fixtures = vi.hoisted(() => {
  const activeCycle = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    teamId: '01ARZ3NDEKTSV4RRFFQ69G5FA4',
    number: 1_000_135,
    name: null,
    displayName: 'Jul 27 – Aug 2',
    startsAt: '2026-07-27T00:00:00.000Z',
    endsAt: '2026-08-02T23:59:59.999Z',
    status: 'active' as const,
    isCurrent: true,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
  const upcomingCycle = {
    ...activeCycle,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FA2',
    number: 1_000_136,
    displayName: 'Aug 3 – Aug 9',
    startsAt: '2026-08-03T00:00:00.000Z',
    endsAt: '2026-08-09T23:59:59.999Z',
    status: 'upcoming' as const,
    isCurrent: false,
  };
  const task = {
    labels: [],
    id: '01ARZ3NDEKTSV4RRFFQ69G5FA3',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    title: 'Ship the cadence overview',
    description: null,
    teamId: '01ARZ3NDEKTSV4RRFFQ69G5FA4',
    state: 'in_progress',
    priority: 'medium' as const,
    assigneeId: null,
    delegateId: null,
    projectId: null,
    programId: null,
    dueDate: null,
    provenance: {
      source: 'native' as const,
      sourceIntegrationId: null,
      externalId: null,
      externalUrl: null,
      syncMode: null,
    },
    createdAt: '2026-07-28T00:00:00.000Z',
  };
  return {
    activeCycle,
    upcomingCycle,
    task,
    stats: {
      committed: 4,
      completed: 3,
      capacity: 13,
      completedCapacity: 8,
      scopeChange: 0,
      carryover: 1,
    },
    prefetch: vi.fn(),
    taskTableCalls: [] as unknown[],
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// The shared `TaskTable` the overview renders through now opens the label picker on its own `L`
// hotkey, which needs a mounted `PickerOverlayProvider`. This test exercises the overview, not the
// picker, so the overlay hook is stubbed the same way `task-actions.test.tsx` stubs it.
vi.mock('../../src/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open: vi.fn() }),
}));

// The URL is read through the app's own location source rather than Next's router, so that is what
// a test presents. See `src/lib/app-location.tsx`.
vi.mock('../../src/lib/app-location', () => ({
  useTypedRoute: () => ({ params: { orgId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' } }),
  useAppPathname: () => '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAV/cycles',
  useAppSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../src/lib/query', async (importOriginal) => {
  const actual = await importOriginal<typeof QueryModule>();
  const result = <T,>(data: T) => ({
    data,
    isPending: false,
    isError: false,
    isPlaceholderData: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  });
  return {
    ...actual,
    usePrefetchApi: () => fixtures.prefetch,
    useApiMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    useApiListQuery: (def: { queryKey?: readonly unknown[] }) => {
      const key = def.queryKey ?? [];
      if (key[2] === 'cycles' && key.length === 3) {
        return result({
          cycles: [fixtures.activeCycle, fixtures.upcomingCycle],
          statsById: {
            [fixtures.activeCycle.id]: fixtures.stats,
            [fixtures.upcomingCycle.id]: {
              committed: 0,
              completed: 0,
              capacity: 0,
              completedCapacity: 0,
              scopeChange: 0,
              carryover: 0,
            },
          },
        });
      }
      return result({ items: [] });
    },
    // The overview's cycle-detail read (tasks + name maps + actor directory).
    useApiQuery: () =>
      result({
        cycle: { ...fixtures.activeCycle, stats: fixtures.stats },
        burnup: null,
        tasks: [fixtures.task],
        projectName: new Map<string, string>(),
        programName: new Map<string, string>(),
        otherCycles: [],
        members: [],
        roles: [],
        resolveActor: () => ({ name: 'Someone', kind: 'human' as const }),
      }),
  };
});

// Wrap — not replace — the shared task table, so the overview renders the REAL primitive while the
// test can still prove that is what it reached for.
vi.mock('../../src/components/views/task-table', async (importOriginal) => {
  const actual = await importOriginal<typeof TaskTableModule>();
  return {
    ...actual,
    TaskTable: (props: TaskTableModule.TaskTableProps): JSX.Element => {
      fixtures.taskTableCalls.push(props);
      return actual.TaskTable(props);
    },
  };
});

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    teams: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FA4', name: 'Core' }],
    defaultTeamId: '01ARZ3NDEKTSV4RRFFQ69G5FA4',
  }),
}));

vi.mock('../../src/lib/use-org-capability', () => ({
  useOrgCapability: () => false,
}));

// The overview's task rows each grow a `TaskTimerButton`, which reads the caller's one
// tracker via `useLiveApiQuery` — a real hook the `../../src/lib/query` mock above does not stub.
// Mock the transport it calls through instead, so that read resolves to "nothing tracked" rather
// than reaching the network from a test.
vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                record: null,
                serverNow: new Date().toISOString(),
                suggestion: null,
                activeAgentExecutions: [],
              }),
          }),
        },
      },
    },
  },
}));

import { CycleOut } from '@docket/work/cycle-contract';

import CyclesClient from '../../src/app/(app)/orgs/[orgId]/cycles/cycles-client';
import {
  ActiveCycleOverview,
  runwayLabel,
} from '../../src/components/cycles/active-cycle-overview';

/**
 * Render `ui` inside the query client + tooltip provider the overview's per-row
 * {@link TaskTimerButton} needs — mirrors the app root's real `TooltipProvider`
 * placement (see `tests/components/views/task-table.test.tsx`'s identical helper).
 */
function renderWithProviders(ui: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

/**
 * The active cycle as the schema produces it.
 *
 * @remarks
 * Parsed rather than cast so the fixture carries the branded ids the component's props demand —
 * and so a `displayName` regression in the DTO would fail here rather than silently type-check.
 */
const ACTIVE_CYCLE = CycleOut.parse(fixtures.activeCycle);

/** The overview region, addressed the way a screen reader reaches it. */
function overviewRegion(): HTMLElement {
  return screen.getByRole('region', { name: fixtures.activeCycle.displayName });
}

describe('Cycles list', () => {
  it('never renders a cycle as its auto-roll number', () => {
    const { container } = renderWithProviders(<CyclesClient />);
    expect(container.textContent).not.toMatch(RAW_NUMBER_NAME);
    expect(container.textContent).not.toContain('1000135');
    expect(container.textContent).not.toContain('1000136');
    // Both cycles read as their windows instead.
    expect(screen.getAllByText('Jul 27 – Aug 2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aug 3 – Aug 9').length).toBeGreaterThan(0);
  });

  it('renders the page title with no subtitle beneath it', () => {
    const { container } = renderWithProviders(<CyclesClient />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cycles' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('roll automatically on your cadence');
    expect(container.textContent).not.toContain("what's live now");
  });

  it('heads the list with a focused overview of the active cycle', () => {
    renderWithProviders(<CyclesClient />);
    const overview = overviewRegion();

    // Identity + an explicit active indicator.
    expect(
      within(overview).getByRole('heading', { level: 2, name: 'Jul 27 – Aug 2' }),
    ).toBeInTheDocument();
    expect(within(overview).getByText('Active')).toBeInTheDocument();
    expect(within(overview).getByRole('link', { name: 'Open cycle' })).toHaveAttribute(
      'href',
      `/orgs/${ORG_ID}/cycles/${ACTIVE_CYCLE_ID}`,
    );

    // Dates + time remaining. The window is the region heading (this cycle is unnamed), so the
    // line beneath carries the runway rather than repeating it.
    expect(
      within(overview).getByText(
        runwayLabel(fixtures.activeCycle.startsAt, fixtures.activeCycle.endsAt),
      ),
    ).toBeInTheDocument();

    // Progress and workload, with the unit spelled out.
    expect(within(overview).getByText('Progress')).toBeInTheDocument();
    expect(within(overview).getByText('3/4 tasks done')).toBeInTheDocument();
    expect(within(overview).getByText('Workload')).toBeInTheDocument();
    expect(within(overview).getByText('8/13 points')).toBeInTheDocument();
    expect(within(overview).getByText('1 still open')).toBeInTheDocument();
  });

  it('renders the overview tasks through the shared task table', () => {
    fixtures.taskTableCalls.length = 0;
    renderWithProviders(<CyclesClient />);
    const overview = overviewRegion();

    expect(fixtures.taskTableCalls).toHaveLength(1);
    const grid = within(overview).getByRole('grid', { name: 'Jul 27 – Aug 2 tasks' });
    const row = within(grid).getByRole('link', { name: /Ship the cadence overview/ });
    expect(row).toHaveAttribute('href', `/orgs/${ORG_ID}/tasks/${TASK_ID}`);
  });

  it('keeps the active cycle in the roster below, so filters stay honest', () => {
    const { container } = renderWithProviders(<CyclesClient />);
    // The roster grid still carries a row for the active cycle: the overview subordinates the
    // roster by weight, it does not hide anything from it.
    const roster = screen.getByRole('grid', { name: /active cycles/i });
    const row = within(roster).getByRole('row', { name: /Jul 27 – Aug 2.*Core/ });
    expect(row).toHaveAttribute('data-object-kind', 'cycle');
    expect(row).toHaveAttribute('data-object-id', ACTIVE_CYCLE_ID);
    expect(row).toHaveAttribute('href', `/orgs/${ORG_ID}/cycles/${ACTIVE_CYCLE_ID}`);
    expect(within(row).getByText('Active')).toBeVisible();
    expect(row.querySelector('[data-col="progress"]')).toHaveTextContent('3/4');
    expect(within(row).getByText('1 open')).toBeVisible();

    const priorities = [
      ['cycle', ['flex']],
      ['status', ['hidden', '@md/table:flex']],
      ['progress', ['hidden', '@lg/table:flex']],
      ['points', ['hidden', '@xl/table:flex']],
    ] as const;
    expect(
      within(roster)
        .getAllByRole('columnheader')
        .map((header) => header.getAttribute('data-col')),
    ).toEqual(priorities.map(([key]) => key));
    for (const [key, visibilityClasses] of priorities) {
      const cells = container.querySelectorAll(`[aria-label="Active cycles"] [data-col="${key}"]`);
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        for (const className of visibilityClasses) {
          expect(cell).toHaveClass(className);
        }
      }
    }
  });
});

describe('ActiveCycleOverview', () => {
  it('omits the carryover metric when nothing is still open', () => {
    renderWithProviders(
      <ActiveCycleOverview
        orgId={ORG_ID}
        cycle={ACTIVE_CYCLE}
        teamName="Platform"
        stats={{ ...fixtures.stats, carryover: 0 }}
        cycleNoun="Cycle"
      />,
    );
    expect(screen.queryByText('Carryover')).not.toBeInTheDocument();
  });

  it('prefixes the runway with the window once the cycle carries an author name', () => {
    const named = CycleOut.parse({
      ...fixtures.activeCycle,
      name: 'Launch week',
      displayName: 'Launch week',
    });
    renderWithProviders(
      <ActiveCycleOverview
        orgId={ORG_ID}
        cycle={named}
        teamName="Platform"
        stats={fixtures.stats}
        cycleNoun="Cycle"
      />,
    );
    const runway = runwayLabel(fixtures.activeCycle.startsAt, fixtures.activeCycle.endsAt);
    expect(
      screen.getByText((_, node) => node?.textContent === `Jul 27 – Aug 2 · ${runway}`),
    ).toBeInTheDocument();
  });

  it('states the workload unit as a readable word, never an abbreviation', () => {
    renderWithProviders(
      <ActiveCycleOverview
        orgId={ORG_ID}
        cycle={ACTIVE_CYCLE}
        teamName="Platform"
        stats={fixtures.stats}
        cycleNoun="Cycle"
      />,
    );
    expect(screen.getByText('8/13 points')).toBeInTheDocument();
    expect(screen.queryByText(/\bpts\b/)).not.toBeInTheDocument();
  });
});

describe('runwayLabel', () => {
  const START = '2026-07-27T00:00:00.000Z';
  const END = '2026-08-02T23:59:59.999Z';

  it('numbers the day from 1 and counts only the days still ahead', () => {
    expect(runwayLabel(START, END, new Date('2026-07-31T12:00:00.000Z'))).toBe(
      'Day 5 of 7 · 2 days left',
    );
  });

  it('calls the final day the last day rather than "1 day left"', () => {
    expect(runwayLabel(START, END, new Date('2026-08-02T09:00:00.000Z'))).toBe(
      'Day 7 of 7 · last day',
    );
  });

  it('has its own sentence before the window opens', () => {
    expect(runwayLabel(START, END, new Date('2026-07-24T00:00:00.000Z'))).toBe('Starts in 7 days');
  });

  it('has its own sentence once the window has closed', () => {
    expect(runwayLabel(START, END, new Date('2026-08-20T00:00:00.000Z'))).toBe(
      'Wrapped · ran 7 days',
    );
  });
});

describe('upcoming roster rows', () => {
  it('keeps them present but visually secondary to the overview', () => {
    renderWithProviders(<CyclesClient />);
    const upcoming = screen.getByRole('row', { name: 'Aug 3 – Aug 9, Core' });
    expect(upcoming).toHaveAttribute('href', `/orgs/${ORG_ID}/cycles/${UPCOMING_CYCLE_ID}`);

    // Overview identity is a title token; roster titles are body text — subordination by weight.
    const overviewHeading = within(overviewRegion()).getByRole('heading', { level: 2 });
    expect(overviewHeading.className).toContain('text-title-large');
    expect(within(upcoming).getByText('Aug 3 – Aug 9').className).toContain('text-body-medium');
  });

  it('scopes its filter/group catalog to the org teams the page loaded', () => {
    renderWithProviders(<CyclesClient />);
    // Grouping defaults to status, so both cadence segments are labeled rather than the roster
    // being one undifferentiated list.
    expect(screen.getByRole('grid', { name: /active cycles/i })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /upcoming cycles/i })).toBeInTheDocument();
    expect(TEAM_ID).toBe(fixtures.activeCycle.teamId);
  });
});
