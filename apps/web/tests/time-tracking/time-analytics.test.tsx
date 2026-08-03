/**
 * Behaviour tests for {@link import('../../src/components/time-tracking/time-analytics').TimeAnalytics}.
 *
 * @remarks
 * Pins CORE-48's acceptance directly: a period selector, a period total, a ranked breakdown, and
 * an explicit empty state when a period has no tracked time. The period selector and the six
 * breakdown-dimension chips are read straight from the component's own copy so a rename of either
 * fails this test rather than silently drifting from the acceptance criterion's wording.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { summaryGet, breakdownGet } = vi.hoisted(() => ({
  summaryGet: vi.fn(),
  breakdownGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        summary: { $get: summaryGet },
        breakdown: { $get: breakdownGet },
      },
    },
  },
}));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { TimeAnalytics } = await import('@/components/time-tracking/time-analytics');

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function renderAnalytics(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TimeAnalytics />
    </QueryClientProvider>,
  );
}

const ZERO_MEASURES = {
  elapsedMs: 0,
  humanEffortMs: 0,
  agentEffortMs: 0,
  combinedEffortMs: 0,
  operationalWaitMs: 0,
};

beforeEach(() => {
  summaryGet.mockReset();
  breakdownGet.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('TimeAnalytics', () => {
  it('renders the period selector, a period total, and a ranked breakdown', async () => {
    summaryGet.mockResolvedValue(
      jsonResponse({ ...ZERO_MEASURES, combinedEffortMs: 5_400_000 }), // 1h30m
    );
    breakdownGet.mockResolvedValue(
      jsonResponse({
        groupBy: 'project',
        // Deliberately a different duration than the period total (3600000ms = "1h") so the
        // period-total span and the bucket row are each uniquely findable by their own text.
        buckets: [
          {
            key: 'proj_1',
            label: 'Launch Readiness',
            measures: { ...ZERO_MEASURES, combinedEffortMs: 3_600_000 },
          },
        ],
        total: { ...ZERO_MEASURES, combinedEffortMs: 3_600_000 },
      }),
    );
    renderAnalytics();

    // Period selector: three periods, "This week" selected by default.
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument();

    // Period total, rendered as a compact duration rather than raw milliseconds.
    expect(await screen.findByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText(/tracked this week/)).toBeInTheDocument();

    // The six breakdown dimensions named in the CORE-48 source quote, verbatim.
    for (const label of ['Project', 'Program', 'Initiative', 'Workspace', 'Task', 'Category']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    // A ranked breakdown row for the one bucket returned, with its own (distinct) duration and
    // its share of the period total (3,600,000ms of 5,400,000ms = 67%).
    expect(await screen.findByText('Launch Readiness')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('renders an explicit empty state when the period has no tracked time', async () => {
    summaryGet.mockResolvedValue(jsonResponse(ZERO_MEASURES));
    breakdownGet.mockResolvedValue(
      jsonResponse({ groupBy: 'project', buckets: [], total: ZERO_MEASURES }),
    );
    renderAnalytics();

    expect(await screen.findByText('No time tracked in this period')).toBeInTheDocument();
    expect(screen.getByText(/Start the timer from anywhere/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go find something to work on/ })).toHaveAttribute(
      'href',
      '/today',
    );
  });

  it('also treats a period whose only bucket is zero-effort as empty', async () => {
    // The surface filters buckets with `combinedEffortMs > 0`, so a bucket that exists but
    // carries no combined effort (e.g. purely agent time not yet counted) must still show the
    // empty state rather than a misleading zero-width row.
    summaryGet.mockResolvedValue(jsonResponse(ZERO_MEASURES));
    breakdownGet.mockResolvedValue(
      jsonResponse({
        groupBy: 'project',
        buckets: [{ key: 'proj_1', label: 'Ghost bucket', measures: ZERO_MEASURES }],
        total: ZERO_MEASURES,
      }),
    );
    renderAnalytics();

    expect(await screen.findByText('No time tracked in this period')).toBeInTheDocument();
    expect(screen.queryByText('Ghost bucket')).not.toBeInTheDocument();
  });

  it('surfaces an application-owned error message rather than a raw failure', async () => {
    summaryGet.mockResolvedValue(jsonResponse({ code: 'internal' }, 500));
    breakdownGet.mockResolvedValue(jsonResponse({ code: 'internal' }, 500));
    renderAnalytics();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
