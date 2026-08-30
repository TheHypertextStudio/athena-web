import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  routerReplace,
  summaryGet,
  timelineGet,
  breakdownGet,
  cyclesGet,
  categoriesGet,
  preferencesGet,
} = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  summaryGet: vi.fn(),
  timelineGet: vi.fn(),
  breakdownGet: vi.fn(),
  cyclesGet: vi.fn(),
  categoriesGet: vi.fn(),
  preferencesGet: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
}));
vi.mock('@/lib/app-location', () => ({
  useAppSearchParams: () => new URLSearchParams(),
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

afterEach(cleanup);

describe('TimeAnalytics', () => {
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

  it('uses app-owned copy when the selected ledger data fails', async () => {
    timelineGet.mockResolvedValue(jsonResponse({ code: 'internal' }, 500));
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load your sessions.'),
    );
  });
});
