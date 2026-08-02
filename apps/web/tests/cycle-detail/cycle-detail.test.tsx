/**
 * Behavior tests for the redesigned cycle detail page (ENT-40 / ENT-41).
 *
 * @remarks
 * These pin the four defects the redesign was commissioned to remove, at the level a screenshot
 * cannot assert automatically:
 *
 * - **One window, stated once.** The page used to show "Jul 26 – Aug 2" in the header and
 *   "Jul 27, 2026 → Aug 2, 2026" in a properties card directly beneath it — one record reading as
 *   two different date ranges. The window now comes from the shared `formatWindow` in exactly one
 *   place, and the Window property chip mirrors its day format rather than inventing another.
 * - **No epoch sequence numbers.** Cycles auto-roll, so `number` is an epoch-anchored counter; the
 *   page rendered it as the title ("Cycle 1000135"), which names nothing a reader recognizes. It
 *   must not appear anywhere.
 * - **Pace renders.** The pace section was a shrinkable flex child of a fixed-height column, so it
 *   collapsed — on a phone all the way down to a hairline. As a tab panel it either renders its
 *   tiles or it doesn't, at every width.
 * - **No rules separating nothing.** The old properties rows drew `border-t` hairlines; the
 *   metadata chips draw none, and the page contains no `<hr>` at all.
 */
import '@testing-library/jest-dom/vitest';

import { CycleId, OrganizationId, ProjectId, TaskId, TeamId } from '@docket/types';
import type { CycleBurnupOut, CycleDetail, TaskOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { useApiQuery, useApiMutation, usePrefetchApi, useOrgCapability } = vi.hoisted(() => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  usePrefetchApi: vi.fn(),
  useOrgCapability: vi.fn(),
}));

// Only the hooks are replaced: `queryKeys`, `unwrap` and `apiQueryOptions` stay real so the page's
// own query definitions are exercised rather than stubbed away.
vi.mock('@/lib/query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useApiQuery,
  useApiMutation,
  usePrefetchApi,
}));

vi.mock('@/lib/use-org-capability', () => ({ useOrgCapability }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgId: ORG_ID, cycleId: CYCLE_ID }),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

const ORG_ID = '01HZZZ00000000000000000RG1';
const CYCLE_ID = '01HZZZ0000000000000000CY01';
const TEAM_ID = '01HZZZ0000000000000000TM01';

// Imported after the mock factories above so the page and this file share one module instance.
const CycleDetailPage = (await import('@/app/(app)/orgs/[orgId]/cycles/[cycleId]/page')).default;

/** The cycle under test: an active, unnamed, one-week window inside a single calendar year. */
const CYCLE: CycleDetail = {
  id: CycleId.parse(CYCLE_ID),
  organizationId: OrganizationId.parse(ORG_ID),
  teamId: TeamId.parse(TEAM_ID),
  number: 1_000_135,
  name: null,
  displayName: 'Jul 27 – Aug 2',
  startsAt: '2026-07-27T00:00:00.000Z',
  endsAt: '2026-08-02T23:59:59.999Z',
  status: 'active',
  isCurrent: true,
  createdAt: '2026-07-20T00:00:00.000Z',
  stats: {
    committed: 6,
    completed: 2,
    capacity: 21,
    completedCapacity: 8,
    scopeChange: 3,
    carryover: 4,
  },
};

/** A burn-up with a real trend, so the chart draws rather than showing its empty message. */
const BURNUP: CycleBurnupOut = {
  cycleId: CycleId.parse(CYCLE_ID),
  startsAt: CYCLE.startsAt,
  endsAt: CYCLE.endsAt,
  capacity: 21,
  series: [
    { date: '2026-07-27', planned: 18, completed: 0, remaining: 18 },
    { date: '2026-07-28', planned: 18, completed: 3, remaining: 15 },
    { date: '2026-07-29', planned: 21, completed: 5, remaining: 16 },
    { date: '2026-07-30', planned: 21, completed: 8, remaining: 13 },
  ],
  scopeChanges: [],
  stats: CYCLE.stats,
};

const PROJECT_ID = '01HZZZ0000000000000000PR01';

/** One committed task inside a project, so the project-name lookup is actually exercised. */
const TASK: TaskOut = {
  id: TaskId.parse('01HZZZ0000000000000000TK01'),
  organizationId: OrganizationId.parse(ORG_ID),
  title: 'Migrate the billing webhooks',
  description: null,
  teamId: TeamId.parse(TEAM_ID),
  state: 'in_progress',
  priority: 'high',
  assigneeId: null,
  delegateId: null,
  projectId: ProjectId.parse(PROJECT_ID),
  programId: null,
  estimateMinutes: null,
  startDate: null,
  dueDate: null,
  provenance: { source: 'native' },
  createdAt: '2026-07-28T09:00:00.000Z',
};

/** The resolved shape `cycleDetailDef` produces, with no tasks committed. */
function detailData(tasks: readonly TaskOut[] = []): Record<string, unknown> {
  return {
    cycle: CYCLE,
    burnup: BURNUP,
    tasks,
    projectName: new Map([[PROJECT_ID, 'Billing platform hardening']]),
    programName: new Map<string, string>(),
    otherCycles: [],
    members: [],
    roles: [],
    resolveActor: () => ({ name: 'Grace Hopper', kind: 'human' as const }),
  };
}

/**
 * The same data as it comes back from the persisted cache.
 *
 * @remarks
 * `QueryPersistence` dehydrates every successful query to JSON in IndexedDB and restores it on the
 * next load. JSON has no `Map` and no functions, so the name lookups return as plain objects and
 * `resolveActor` is simply gone — which is exactly what made this page throw
 * `projectName.get is not a function` and render "This page couldn't load" on every visit after
 * the first.
 */
function restoredDetailData(tasks: readonly TaskOut[] = []): Record<string, unknown> {
  const restored = { ...detailData(tasks) };
  delete restored['resolveActor'];
  restored['projectName'] = { [PROJECT_ID]: 'Billing platform hardening' };
  restored['programName'] = {};
  return restored;
}

/** A settled mutation result, enough for every `useApiMutation` call the page makes. */
function mutationResult(): Record<string, unknown> {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    error: null,
    reset: vi.fn(),
  };
}

/** Render the page against a settled detail read. */
function renderPage(
  tasks: readonly TaskOut[] = [],
  data: Record<string, unknown> = detailData(tasks),
): HTMLElement {
  useOrgCapability.mockReturnValue(true);
  useApiMutation.mockImplementation(() => mutationResult());
  usePrefetchApi.mockReturnValue(vi.fn());
  useApiQuery.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data,
    refetch: vi.fn(),
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: JSX.Element }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { container } = render(wrapper({ children: <CycleDetailPage /> }));
  return container;
}

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('cycle detail — one window, stated once', () => {
  it('renders the window string exactly once', () => {
    const container = renderPage();
    expect(occurrences(container.textContent, 'Jul 27 – Aug 2')).toBe(1);
  });

  it('shows the same dates on the Window property chip', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Window — Jul 27 → Aug 2' })).toBeInTheDocument();
  });

  it('pairs the window with the runway in the one masthead subtitle', () => {
    const container = renderPage();
    // `Jul 27 – Aug 2 · <runway>` — the runway clause depends on today, the window never does.
    expect(container.textContent).toMatch(/Jul 27 – Aug 2 · \S/);
  });
});

describe('cycle detail — no epoch sequence numbers', () => {
  it('never renders the stored cycle number', () => {
    const container = renderPage();
    expect(container.textContent).not.toMatch(/Cycle \d{5,}/);
    expect(container.textContent).not.toContain('1000135');
  });

  it('titles an unnamed cycle by its window, as an empty rename field', () => {
    renderPage();
    const title = screen.getByLabelText<HTMLInputElement>('Cycle name');
    expect(title.value).toBe('');
    expect(title.placeholder).toBe('Jul 27 – Aug 2');
  });
});

describe('cycle detail — the shared entity-detail composition', () => {
  it('titles the page at the canonical headline token', () => {
    const container = renderPage();
    const heading = container.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(heading?.className).toContain('text-headline-medium');
  });

  it('offers Tasks and Pace as peer tabs, with Tasks selected first', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /Tasks/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Pace/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('draws no horizontal rules anywhere in the page', () => {
    const container = renderPage();
    expect(container.querySelector('hr')).toBeNull();
  });
});

describe('cycle detail — panels', () => {
  it('uses the shared empty state when nothing is committed', () => {
    renderPage();
    expect(screen.getByText('Nothing is committed yet')).toBeInTheDocument();
    expect(screen.getByText(/Add the work this cycle is meant to deliver/)).toBeInTheDocument();
  });

  it('renders the pace stat tiles once the Pace tab is selected', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Pace/ }));

    for (const label of ['Committed', 'Capacity', 'Scope added', 'Carryover']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('8 / 21')).toBeInTheDocument();
    expect(screen.getByText('2 completed')).toBeInTheDocument();
  });

  it('groups committed tasks under their project name', () => {
    renderPage([TASK]);
    expect(screen.getByText('Billing platform hardening')).toBeInTheDocument();
    expect(screen.getByText('Migrate the billing webhooks')).toBeInTheDocument();
  });

  it('still renders when the query cache was restored from IndexedDB', () => {
    // Regression: the restored lookups are plain objects, and calling `.get` on one threw, killing
    // the whole surface on every visit after the first.
    renderPage([TASK], restoredDetailData([TASK]));
    expect(screen.getByText('Billing platform hardening')).toBeInTheDocument();
    expect(screen.getByText('Migrate the billing webhooks')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pace/ })).toBeInTheDocument();
  });

  it('keeps the burn-up chart out of the DOM until Pace is opened', () => {
    renderPage();
    expect(screen.queryByRole('img', { name: /Cycle burn-up/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Pace/ }));
    expect(screen.getByRole('img', { name: /Cycle burn-up/ })).toBeInTheDocument();
  });
});
