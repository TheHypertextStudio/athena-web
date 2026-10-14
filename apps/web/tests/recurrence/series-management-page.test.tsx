import '@testing-library/jest-dom/vitest';

/** Repeating-work management keeps lifecycle, missed dates, and future edits on one surface. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  detail: vi.fn(),
  lifecycle: vi.fn(),
  edit: vi.fn(),
  context: vi.fn(),
}));

vi.mock('../../src/lib/app-location', () => ({
  useTypedRoute: () => ({
    params: {
      orgId: '01BX5ZZKBKACTAV9WEVGEMMVRC',
      seriesId: '01BX5ZZKBKACTAV9WEVGEMMVRE',
    },
  }),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'recurrence-series': {
            'for-task': { ':taskId': { $get: calls.context } },
            'for-project': { ':projectId': { $get: calls.context } },
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

import {
  TaskRepeatingWorkBacklink,
  ProjectRepeatingWorkBacklink,
} from '../../src/components/recurrence/repeating-work-backlink';
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
  calls.context.mockReset();
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

/** Mount the ordinary-work provenance entry, keeping the surrounding task on screen. */
function renderBacklink(project = false): QueryClient {
  calls.context.mockResolvedValue(
    response({ seriesId: DETAIL.id, seriesName: DETAIL.name, scheduledFor: '2026-08-14' }),
  );
  calls.detail.mockImplementation(() => Promise.resolve(response(DETAIL)));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Backlink = project ? ProjectRepeatingWorkBacklink : TaskRepeatingWorkBacklink;
  render(
    <QueryClientProvider client={client}>
      <h1>Ordinary work</h1>
      <Backlink orgId={DETAIL.organizationId} entityId="01BX5ZZKBKACTAV9WEVGEMMVRI" />
    </QueryClientProvider>,
  );
  return client;
}

/** Change the real schedule control and then leave its popover. */
async function changeInterval(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Repeat — Every week/ }));
  const interval = await screen.findByRole('spinbutton', { name: 'Repeat interval' });
  fireEvent.change(interval, { target: { value: '2' } });
  fireEvent.keyDown(interval, { key: 'Escape', code: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('spinbutton', { name: 'Repeat interval' })).toBeNull();
  });
}

describe('Generated-work management overlay', () => {
  it('retains a rejected occurrence move and retries the selected date', async () => {
    const client = renderBacklink();
    calls.edit.mockRejectedValueOnce(new Error('Private provider failure'));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage repeating work' }));
    await screen.findByRole('heading', { name: DETAIL.name });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.click(screen.getByRole('button', { name: /New date for 2026-08-10/ }));
    fireEvent.click(await screen.findByRole('button', { name: '2026-08-20' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    await waitFor(() => {
      expect(calls.edit).toHaveBeenCalledTimes(1);
      expect(client.isMutating()).toBe(0);
      expect(screen.getByRole('button', { name: 'Close repeating work' })).toBeEnabled();
    });
    expect(screen.queryByText('Private provider failure')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByRole('button', { name: /New date for 2026-08-10/ })).toHaveTextContent(
      'Aug 20, 2026',
    );
    const moved = {
      ...DETAIL,
      occurrences: DETAIL.occurrences.map((item) =>
        item.scheduledFor === '2026-08-10'
          ? { ...item, scheduledFor: '2026-08-20', status: 'materialized' }
          : item,
      ),
    };
    calls.detail.mockImplementation(() => Promise.resolve(response(moved)));
    calls.edit.mockResolvedValueOnce(response(moved));
    fireEvent.click(screen.getByRole('button', { name: 'Save date' }));
    await waitFor(() => {
      expect(calls.edit).toHaveBeenLastCalledWith({
        param: { orgId: DETAIL.organizationId, id: DETAIL.id },
        json: {
          scope: 'occurrence',
          scheduledFor: '2026-08-10',
          resolution: { kind: 'reschedule', scheduledFor: '2026-08-20' },
        },
      });
    });
    await waitFor(() => {
      expect(client.isMutating()).toBe(0);
    });
    expect(await screen.findByText('Aug 20, 2026', { exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save date' })).toBeNull();
  });

  it.each([false, true])(
    'opens from generated work and restores the opener after clean dismissal (project %s)',
    async (project) => {
      renderBacklink(project);
      const opener = await screen.findByRole('button', { name: 'Manage repeating work' });
      opener.focus();
      fireEvent.click(opener);
      const dialog = await screen.findByRole('dialog', { name: 'Manage repeating work' });
      expect(await within(dialog).findByRole('heading', { name: DETAIL.name })).toBeInTheDocument();
      expect(within(dialog).getByRole('heading', { name: 'Schedule history' })).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close repeating work' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(opener).toHaveFocus();
      });
      expect(screen.getByRole('heading', { name: 'Ordinary work' })).toBeInTheDocument();
    },
  );

  it('guards changed schedules on close and Escape, keeps the draft, and discards only explicitly', async () => {
    const client = renderBacklink();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage repeating work' }));
    await screen.findByRole('heading', { name: DETAIL.name });
    await changeInterval();
    await client.invalidateQueries();
    expect(screen.getByRole('button', { name: /Repeat — Every 2 weeks/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close repeating work' }));
    expect(screen.getByText('Discard your unsaved schedule changes?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('button', { name: /Repeat — Every 2 weeks/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    await screen.findByRole('button', { name: 'Discard changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Manage repeating work' }));
    expect(await screen.findByRole('button', { name: /Repeat — Every week/ })).toBeInTheDocument();
    expect(calls.edit).not.toHaveBeenCalled();
  });

  it('saves a future revision with the existing trigger semantics and permits clean dismissal after saving', async () => {
    renderBacklink();
    const saved = {
      ...DETAIL,
      trigger: { ...DETAIL.trigger, schedule: { ...DETAIL.trigger.schedule, interval: 2 } },
    };
    calls.edit.mockImplementation(() => {
      calls.detail.mockResolvedValue(response(saved));
      return Promise.resolve(response(saved));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Manage repeating work' }));
    await screen.findByRole('heading', { name: DETAIL.name });
    await changeInterval();
    fireEvent.click(screen.getByRole('button', { name: 'Save future schedule' }));
    await waitFor(() => {
      expect(calls.edit).toHaveBeenCalledWith({
        param: { orgId: DETAIL.organizationId, id: DETAIL.id },
        json: { scope: 'future', effectiveFrom: '2026-08-13', trigger: saved.trigger },
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close repeating work' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close repeating work' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('holds dismissal while saving and retains a rejected schedule for retry', async () => {
    renderBacklink();
    let rejectSave: ((error: Error) => void) | undefined;
    calls.edit.mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Manage repeating work' }));
    await screen.findByRole('heading', { name: DETAIL.name });
    await changeInterval();
    fireEvent.click(screen.getByRole('button', { name: 'Save future schedule' }));
    await screen.findByRole('button', { name: 'Saving schedule…' });
    expect(screen.getByRole('button', { name: 'Close repeating work' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    rejectSave?.(new Error('Provider error must never appear in the product'));
    await screen.findByRole('button', { name: 'Save future schedule' });
    expect(screen.getByRole('button', { name: /Repeat — Every 2 weeks/ })).toBeInTheDocument();
    expect(screen.queryByText('Provider error must never appear in the product')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close repeating work' }));
    expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
  });

  it('asks before dismissing a changed schedule through the backdrop', async () => {
    renderBacklink();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage repeating work' }));
    await screen.findByRole('heading', { name: DETAIL.name });
    await changeInterval();
    const backdrop = document.querySelector('[data-overlay-scrim]');
    expect(backdrop).not.toBeNull();
    if (!backdrop) throw new Error('The shared dialog must provide a backdrop.');
    fireEvent(
      backdrop,
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    );
    fireEvent.click(backdrop);
    expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Discard changes' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: /Repeat — Every 2 weeks/ })).toBeInTheDocument();
  });
});
