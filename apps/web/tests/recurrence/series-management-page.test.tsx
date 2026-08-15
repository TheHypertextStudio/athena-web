/** Repeating-work management keeps lifecycle, missed dates, and future edits on one surface. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ detail: vi.fn(), lifecycle: vi.fn(), edit: vi.fn() }));

vi.mock('../../src/lib/app-location', () => ({
  useAppParams: () => ({
    orgId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
    seriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
  }),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'recurrence-series': {
            ':id': {
              $get: calls.detail,
              lifecycle: { $post: calls.lifecycle },
              edits: { $post: calls.edit },
            },
          },
        },
      },
    },
  },
}));

import RecurrenceSeriesPage from '../../src/app/(app)/orgs/[orgId]/recurrence-series/[seriesId]/page';

/**
 * A moment before the fixture's `2026-08-12` revision boundary, so `today` in the page (line 129,
 * `new Date().toISOString().slice(0, 10)`) is fixed rather than the real clock.
 *
 * @remarks
 * Every fixture date below — the missed `2026-08-10` occurrence, the needs-decision `2026-08-14`
 * one, the `earliest` fallback of `2026-08-13` — is written relative to "today" being before
 * 2026-08-12. Without pinning the clock, this test only held on the days it was written for: once
 * the real date passed 2026-08-14, the page's own `scheduledFor >= today` filter dropped the
 * `2026-08-14` occurrence from the needs-decision list, and its "Change Aug 14, 2026" button
 * stopped rendering.
 */
const BEFORE_REVISION_BOUNDARY = new Date('2026-08-11T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(BEFORE_REVISION_BOUNDARY);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  calls.detail.mockReset();
  calls.lifecycle.mockReset();
  calls.edit.mockReset();
});

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const DETAIL = {
  id: '01BX5ZZKBKACTAV9WEVGEMMVRE',
  organizationId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
  processDefinitionId: '01BX5ZZKBKACTAV9WEVGEMMVRB',
  processRevisionId: '01BX5ZZKBKACTAV9WEVGEMMVRF',
  name: 'Run six miles',
  status: 'active',
  trigger: {
    kind: 'calendar',
    schedule: {
      kind: 'weekly',
      interval: 1,
      weekdays: ['monday', 'wednesday', 'friday'],
      startDate: '2026-08-12',
      timezone: 'America/Los_Angeles',
      end: { kind: 'never' },
    },
    missedPolicy: 'resolve',
    materialization: { horizonDays: 28, minimumOccurrences: 2 },
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
  pausedAt: null,
  endedAt: null,
  revisions: [
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVRM',
      seriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
      processRevisionId: '01BX5ZZKBKACTAV9WEVGEMMVRF',
      number: 1,
      effectiveFrom: '2026-08-01',
      trigger: { kind: 'manual' },
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVRN',
      seriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
      processRevisionId: '01BX5ZZKBKACTAV9WEVGEMMVRF',
      number: 2,
      effectiveFrom: '2026-08-12',
      trigger: {
        kind: 'calendar',
        schedule: {
          kind: 'weekly',
          interval: 1,
          weekdays: ['monday', 'wednesday', 'friday'],
          startDate: '2026-08-12',
          timezone: 'America/Los_Angeles',
          end: { kind: 'never' },
        },
        missedPolicy: 'resolve',
        materialization: { horizonDays: 28, minimumOccurrences: 2 },
      },
      createdAt: '2026-08-12T00:00:00.000Z',
    },
  ],
  occurrences: [
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVRG',
      seriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
      scheduledFor: '2026-08-10',
      originalScheduledFor: null,
      status: 'needs_resolution',
      processInstanceId: '01BX5ZZKBKACTAV9WEVGEMMVRH',
      taskId: '01BX5ZZKBKACTAV9WEVGEMMVRI',
      resolvedAt: null,
    },
    {
      id: '01BX5ZZKBKACTAV9WEVGEMMVRJ',
      seriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
      scheduledFor: '2026-08-14',
      originalScheduledFor: null,
      status: 'materialized',
      processInstanceId: '01BX5ZZKBKACTAV9WEVGEMMVRK',
      taskId: '01BX5ZZKBKACTAV9WEVGEMMVRL',
      resolvedAt: null,
    },
  ],
};

describe('RecurrenceSeriesPage', () => {
  it('makes missed-date decisions and future-only schedule edits explicit', async () => {
    calls.detail.mockImplementation(() => Promise.resolve(response(DETAIL)));
    calls.lifecycle.mockResolvedValue(response({ ...DETAIL, occurrences: undefined }));
    calls.edit.mockResolvedValue(response(DETAIL));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <RecurrenceSeriesPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Run six miles' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Needs a decision' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeTruthy();
    expect(screen.getByText(/Changes apply from the selected date forward/)).toBeTruthy();
    const earliest =
      new Date().toISOString().slice(0, 10) > '2026-08-12'
        ? new Date().toISOString().slice(0, 10)
        : '2026-08-13';
    expect(
      await screen.findByRole('button', {
        name: `Apply from — ${new Intl.DateTimeFormat('en', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${earliest}T12:00:00.000Z`))}`,
      }),
    ).toBeTruthy();
    expect(screen.getByText('Schedule history')).toBeTruthy();
    expect(screen.getByText('2 versions')).toBeTruthy();
    expect(screen.getByText('Version 1')).toBeTruthy();
    expect(
      screen
        .getAllByRole('link', { name: 'Open task' })
        .some(
          (link) =>
            link.getAttribute('href') ===
            '/orgs/01BX5ZZKBKACTAV9WEVGEMMVRC/tasks/01BX5ZZKBKACTAV9WEVGEMMVRL',
        ),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Change Aug 14, 2026' }));
    expect(screen.getByRole('button', { name: 'Skip this occurrence' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move this occurrence' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this occurrence' }));
    await waitFor(() => {
      expect(calls.edit).toHaveBeenCalledWith({
        param: {
          orgId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
          id: '01BX5ZZKBKACTAV9WEVGEMMVRE',
        },
        json: {
          scope: 'occurrence',
          scheduledFor: '2026-08-14',
          resolution: { kind: 'skip' },
        },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(calls.edit).toHaveBeenCalledWith({
        param: {
          orgId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
          id: '01BX5ZZKBKACTAV9WEVGEMMVRE',
        },
        json: {
          scope: 'occurrence',
          scheduledFor: '2026-08-10',
          resolution: { kind: 'skip' },
        },
      });
    });
  });
});
