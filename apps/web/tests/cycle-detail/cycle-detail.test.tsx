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
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// The task table's rows each grow a CORE-40 `TaskTimerButton`, which reads the caller's one
// tracker via `useLiveApiQuery` — a real hook this file does not stub (see the `@/lib/query`
// mock above). Mock the transport it calls through instead of the query layer, so that read
// resolves to "nothing tracked" rather than reaching the network from a test.
vi.mock('@/lib/api', () => ({
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

// The shared `TaskTable` this page renders through now opens the label picker on its own `L`
// hotkey, which needs a mounted `PickerOverlayProvider`. This test exercises the cycle-detail page,
// not the picker, so the overlay hook is stubbed the same way `task-actions.test.tsx` stubs it.
vi.mock('@/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open: vi.fn() }),
}));

// The URL is read through the app's own location source rather than Next's router, so that is what
// a test presents. See `src/lib/app-location.tsx`.
vi.mock('../../src/lib/app-location', () => ({
  useAppParams: () => ({ orgId: ORG_ID, cycleId: CYCLE_ID }),
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
  labels: [],
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
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
  const { container } = render(wrapper({ children: <CycleDetailPage /> }));
  return container;
}

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Everything in `container` a person can read, including text that lives in form controls.
 *
 * @remarks
 * `textContent` is not what a reader sees. The masthead title is an `<input>` — its value and its
 * placeholder both render as words on screen and neither appears in `textContent`. Counting only
 * `textContent` is how a screenshot of "Jul 27 – Aug 2" (title, grey) directly above "Jul 27 – Aug 2
 * · Day 7 of 7 · last day" (subtitle) passed a test asserting the window appears exactly once. This
 * reads the controls too, so the count is the one a reader would make.
 */
function readableText(container: HTMLElement): string {
  // A field shows its value, or — only when that value is empty — its placeholder. Never both.
  //
  // A `<textarea>` also carries its value as a DOM text child, unlike an `<input>`, so reading
  // `textContent` and the field values together would count a textarea-backed title twice and
  // report a duplicate nobody can see. Blank the text children on a clone before reading.
  const clone = container.cloneNode(true) as HTMLElement;
  for (const field of clone.querySelectorAll('textarea')) field.textContent = '';
  const fields = [...container.querySelectorAll('input, textarea')]
    .map((field) => (field as HTMLInputElement).value || (field.getAttribute('placeholder') ?? ''))
    .join(' ');
  return `${clone.textContent} ${fields}`;
}

/**
 * A moment inside the fixture's window, so the runway clause below is a live one.
 *
 * @remarks
 * `CYCLE` is a fixed historical window but the runway is computed against the clock, so without
 * pinning `now` the runway assertions only hold on the day they were written — and they did not
 * survive it: run an hour past `endsAt`, "Day 7 of 7 · last day" became "Wrapped · ran 7 days".
 * Pinning keeps the runway phrasing asserted verbatim rather than loosened to a pattern that would
 * also accept the wrapped copy. `shouldAdvanceTime` leaves real timers running so React Testing
 * Library's scheduling is untouched.
 */
const INSIDE_WINDOW = new Date('2026-08-02T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(INSIDE_WINDOW);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('cycle detail — one window, stated once', () => {
  it('renders the window string exactly once, counting the title field', () => {
    const container = renderPage();
    // Once, in the title — an unnamed cycle IS its window. Not again in the subtitle.
    expect(occurrences(readableText(container), 'Jul 27 – Aug 2')).toBe(1);
  });

  it('shows the same dates on separate Window boundary chips', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Window Starts — Jul 27' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Window Ends — Aug 2' })).toBeInTheDocument();
  });

  it('gives the subtitle to the runway alone when the title already carries the window', () => {
    const container = renderPage();
    // The runway clause depends on today; the window never does. It must be the whole line here —
    // the subtitle is a single truncating row, and at 390px a repeated window pushed "last day" out
    // to "…· la…".
    expect(container.textContent).toMatch(/Day \d+ of \d+/);
    expect(container.textContent).not.toMatch(/Jul 27 – Aug 2 · Day/);
  });

  it('leads the subtitle with the window when the title is an author-set name', () => {
    const named = { ...CYCLE, name: 'Launch week', displayName: 'Launch week' };
    const container = renderPage([], { ...detailData(), cycle: named });

    // A name says nothing about when the cycle runs, so the line must supply the window first.
    expect(container.textContent).toMatch(/Jul 27 – Aug 2 · Day \d+ of \d+/);
    expect(occurrences(readableText(container), 'Launch week')).toBe(1);
  });
});

describe('cycle detail — no epoch sequence numbers', () => {
  it('never renders the stored cycle number', () => {
    const container = renderPage();
    expect(container.textContent).not.toMatch(/Cycle \d{5,}/);
    expect(container.textContent).not.toContain('1000135');
  });

  it('titles an unnamed cycle by its window, held in the rename field', () => {
    renderPage();
    const title = screen.getByLabelText<HTMLInputElement>('Cycle name');
    // The field HOLDS the window rather than offering it as a placeholder. A placeholder renders in
    // the browser's grey placeholder colour — so the cycle's own name read as un-entered text, and
    // read differently to a viewer who cannot edit (a plain span at full strength) — and it leaves
    // the `<h1>` with no text for a screen reader to announce.
    expect(title.value).toBe('Jul 27 – Aug 2');
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
