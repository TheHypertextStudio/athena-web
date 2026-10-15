import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  routerReplace,
  summaryGet,
  timelineGet,
  breakdownGet,
  cyclesGet,
  categoriesGet,
  preferencesGet,
  searchParams,
} = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  summaryGet: vi.fn(),
  timelineGet: vi.fn(),
  breakdownGet: vi.fn(),
  cyclesGet: vi.fn(),
  categoriesGet: vi.fn(),
  preferencesGet: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
}));
vi.mock('@/lib/app-location', () => ({
  useAppSearchParams: () => searchParams,
}));
vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({ orgs: [], activeOrgId: null }),
}));
vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      hub: { preferences: { $get: preferencesGet } },
      time: {
        summary: { $get: summaryGet },
        timeline: { $get: timelineGet },
        breakdown: { $get: breakdownGet },
        cycles: { $get: cyclesGet },
        categories: { $get: categoriesGet },
        records: { $post: vi.fn() },
      },
      orgs: { ':orgId': { projects: { $get: vi.fn() }, tasks: { $get: vi.fn() } } },
    },
  },
}));

const { TimeAnalytics } = await import('@/components/time-tracking/time-analytics');

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const ZERO = {
  elapsedMs: 0,
  humanEffortMs: 0,
  agentEffortMs: 0,
  combinedEffortMs: 0,
  operationalWaitMs: 0,
};

function renderAnalytics(): void {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <TimeAnalytics />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const key of [...searchParams.keys()]) searchParams.delete(key);
  for (const mock of [
    summaryGet,
    timelineGet,
    breakdownGet,
    cyclesGet,
    categoriesGet,
    preferencesGet,
    routerReplace,
  ])
    mock.mockReset();
  preferencesGet.mockResolvedValue(jsonResponse({ timezone: 'America/Los_Angeles' }));
  cyclesGet.mockResolvedValue(jsonResponse({ items: [] }));
  categoriesGet.mockResolvedValue(jsonResponse({ items: [] }));
  timelineGet.mockResolvedValue(jsonResponse({ items: [] }));
  summaryGet.mockResolvedValue(
    jsonResponse({ ...ZERO, humanEffortMs: 5_400_000, combinedEffortMs: 5_400_000 }),
  );
  breakdownGet.mockResolvedValue(jsonResponse({ groupBy: 'workspace', buckets: [], total: ZERO }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TimeAnalytics', () => {
  it('changes the selected cycle rather than just its unused anchor and disables the boundary', async () => {
    searchParams.set('period', 'cycle');
    searchParams.set('cycleId', 'first');
    cyclesGet.mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: 'second',
            workspaceId: 'b',
            workspaceName: 'B',
            name: 'Second',
            startsAt: '2026-08-24T00:00:00Z',
            endsAt: '2026-08-31T00:00:00Z',
          },
          {
            id: 'first',
            workspaceId: 'a',
            workspaceName: 'A',
            name: 'First',
            startsAt: '2026-08-17T00:00:00Z',
            endsAt: '2026-08-24T00:00:00Z',
          },
        ],
      }),
    );
    renderAnalytics();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next cycle' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Previous cycle' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next cycle' }));
    expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining('cycleId=second'), {
      scroll: false,
    });
  });

  it('keeps cycle navigation disabled when its selection is unavailable', async () => {
    searchParams.set('period', 'cycle');
    searchParams.set('cycleId', 'missing');
    renderAnalytics();
    await waitFor(() => {
      expect(cyclesGet).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: 'Previous cycle' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next cycle' })).toBeDisabled();
  });

  it('keeps Today disabled until timezone preferences resolve', () => {
    preferencesGet.mockImplementation(() => new Promise<Response>(() => undefined));
    renderAnalytics();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });
  it('keeps Today available in the narrow overflow menu', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 100, 32),
    );
    renderAnalytics();
    const { userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(screen.getByRole('button', { name: 'More time controls' }));
    expect(await screen.findByRole('menuitem', { name: 'Previous week' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Next week' })).toBeEnabled();
    const today = screen.getByRole('menuitem', { name: 'Today' });
    await waitFor(() => {
      expect(today).toBeEnabled();
    });
    fireEvent.click(today);
    expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining('anchor='), {
      scroll: false,
    });
  });

  it('returns to the current local date through the shareable URL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-25T06:30:00Z'));
    searchParams.set('anchor', '2026-08-01');
    renderAnalytics();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Today' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining('anchor=2026-08-24'), {
      scroll: false,
    });
  });
  it('groups period navigation and filters into named responsive time controls', async () => {
    renderAnalytics();
    expect(screen.getByRole('button', { name: 'Add past time' })).toBeInTheDocument();
    for (const label of ['Day', 'Week', 'Month', 'Cycle', 'Custom', 'Filters'])
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
    await waitFor(() => {
      expect(summaryGet).toHaveBeenCalled();
    });
    expect(screen.getByLabelText('Time review controls')).toBeInTheDocument();
  });

  it('shows the selected period as a browsable empty session range', async () => {
    renderAnalytics();
    expect(await screen.findByText(/No time tracked for/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add past time' })).toHaveLength(1);
  });

  it('changes an applied period through the shareable URL state', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    renderAnalytics();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Month' }));
    expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining('period=month'), {
      scroll: false,
    });
  });

  it('presents a failed ledger read as a region failure with a retry', async () => {
    timelineGet.mockResolvedValue(jsonResponse({ code: 'internal' }, 500));
    renderAnalytics();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button')).toBeEnabled();
  });
});
