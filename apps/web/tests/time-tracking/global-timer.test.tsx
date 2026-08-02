/**
 * The persistent timer control's behaviour, driven through the DOM.
 *
 * @remarks
 * Four things are worth pinning here because each is a way the control could look right and be
 * wrong: the elapsed value must come from the SERVER's segments (so a reload resumes rather than
 * restarts), pause must actually stop the number moving, finishing an unnamed session must open
 * the naming prompt instead of ending, and the prompt's confirm must stay disabled for
 * whitespace. The rest of the surface is wiring and is verified by typecheck and by the live app.
 */
import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, recordsPost, recordAction, recordPatch } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
  recordAction: vi.fn(),
  recordPatch: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: { $get: activeGet },
        records: {
          $post: recordsPost,
          ':id': {
            start: { $post: recordAction },
            pause: { $post: recordAction },
            stop: { $post: recordAction },
            $patch: recordPatch,
          },
        },
      },
    },
  },
}));

const { GlobalTimer } = await import('@/components/time-tracking/global-timer');

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** One open segment starting `startedMinutesAgo` before `serverNow`. */
function activePayload(options: {
  readonly startedMinutesAgo: number;
  readonly running: boolean;
  readonly title?: string;
}): unknown {
  const serverNow = new Date('2026-08-02T12:00:00.000Z');
  const startedAt = new Date(serverNow.getTime() - options.startedMinutesAgo * 60_000);
  return {
    serverNow: serverNow.toISOString(),
    activeAgentExecutions: [],
    record: {
      id: 'rec_1',
      hubId: 'hub_1',
      taskId: 'task_1',
      organizationId: 'org_1',
      title: options.title ?? 'Rewrite the onboarding email',
      outcomeNote: null,
      status: options.running ? 'open' : 'paused',
      categoryId: null,
      captureSource: 'live',
      startedAt: startedAt.toISOString(),
      endedAt: null,
      createdAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
      closedAt: null,
      intervals: [
        {
          id: 'int_1',
          timeRecordId: 'rec_1',
          taskId: 'task_1',
          actorKind: 'human',
          userId: 'user_1',
          agentExecutionId: null,
          mode: 'human_active',
          source: 'user_timer',
          startedAt: startedAt.toISOString(),
          endedAt: options.running ? null : serverNow.toISOString(),
          supersededById: null,
          createdAt: startedAt.toISOString(),
          closedAt: null,
        },
      ],
      contexts: [],
      allocations: [],
      measures: {
        elapsedMs: options.startedMinutesAgo * 60_000,
        humanEffortMs: options.startedMinutesAgo * 60_000,
        agentEffortMs: 0,
        combinedEffortMs: options.startedMinutesAgo * 60_000,
        operationalWaitMs: 0,
      },
    },
  };
}

function renderTimer(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The app mounts one `TooltipProvider` at the root (`components/providers.tsx`); the control is
  // always inside it, so the harness reproduces that rather than the component carrying its own.
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <GlobalTimer />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
  activeGet.mockReset();
  recordsPost.mockReset();
  recordAction.mockReset();
  recordPatch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GlobalTimer', () => {
  it('offers a start control when nothing is being tracked', async () => {
    activeGet.mockResolvedValue(
      jsonResponse({
        record: null,
        serverNow: new Date().toISOString(),
        activeAgentExecutions: [],
      }),
    );
    renderTimer();
    expect(await screen.findByTestId('timer-start')).toBeInTheDocument();
    expect(screen.queryByTestId('timer-running')).not.toBeInTheDocument();
  });

  it('renders elapsed time from the server’s own segments, so a reload resumes it', async () => {
    // The component mounted just now, but the segment opened twelve minutes ago. A timer that
    // counted from mount would show 00:00 here — the exact bug that makes a reload lose the day.
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 12, running: true })),
    );
    renderTimer();
    expect(await screen.findByTestId('timer-elapsed')).toHaveTextContent('12:00');
  });

  it('keeps counting while running and holds steady once paused', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 1, running: true })),
    );
    renderTimer();
    expect(await screen.findByTestId('timer-elapsed')).toHaveTextContent('01:00');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByTestId('timer-elapsed')).toHaveTextContent('01:30');

    cleanup();
    // The paused record's segment is closed, so its total is fixed at the segment's own bounds.
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 5, running: false })),
    );
    renderTimer();
    expect(await screen.findByTestId('timer-elapsed')).toHaveTextContent('05:00');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    // Thirty seconds of wall clock later, the paused total has not moved.
    expect(screen.getByTestId('timer-elapsed')).toHaveTextContent('05:00');
  });

  it('shows resume rather than pause once paused', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 3, running: false })),
    );
    renderTimer();
    expect(await screen.findByTestId('timer-resume')).toBeInTheDocument();
    expect(screen.queryByTestId('timer-pause')).not.toBeInTheDocument();
  });

  it('opens the naming prompt when the server refuses to finish an unnamed session', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 4, running: true })),
    );
    recordAction.mockResolvedValue(jsonResponse({ code: 'validation_error' }, 422));
    renderTimer();

    fireEvent.click(await screen.findByTestId('timer-stop'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Name what you worked on');
    // The session did not end: the prompt is the refusal, not a report of one.
    expect(screen.getByTestId('timer-running')).toBeInTheDocument();
  });

  it('disables the naming prompt’s confirm for an empty or whitespace-only name', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 4, running: true })),
    );
    recordAction.mockResolvedValue(jsonResponse({ code: 'validation_error' }, 422));
    renderTimer();
    fireEvent.click(await screen.findByTestId('timer-stop'));
    await screen.findByRole('dialog');

    const field = screen.getByRole('textbox');
    const confirm = screen.getByRole('button', { name: 'Name it and finish' });

    fireEvent.change(field, { target: { value: '' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(field, { target: { value: '    ' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Fixed the importer' } });
    expect(confirm).toBeEnabled();
  });

  it('leaves the timer exactly as it was when the naming prompt is dismissed', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 4, running: true })),
    );
    recordAction.mockResolvedValue(jsonResponse({ code: 'validation_error' }, 422));
    renderTimer();
    fireEvent.click(await screen.findByTestId('timer-stop'));
    await screen.findByRole('dialog');

    const callsBefore = recordAction.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // Dismissing neither finished nor discarded anything: no further request was made, and the
    // running control is still on screen.
    expect(recordAction.mock.calls).toHaveLength(callsBefore);
    expect(screen.getByTestId('timer-running')).toBeInTheDocument();
    expect(screen.getByTestId('timer-elapsed')).toBeInTheDocument();
  });

  it('names the task and then finishes, in that order', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 4, running: true })),
    );
    recordAction.mockResolvedValueOnce(jsonResponse({ code: 'validation_error' }, 422));
    recordPatch.mockResolvedValue(jsonResponse({ id: 'rec_1' }));
    recordAction.mockResolvedValue(jsonResponse({ id: 'rec_1', status: 'closed' }));
    renderTimer();
    fireEvent.click(await screen.findByTestId('timer-stop'));
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fixed the importer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Name it and finish' }));

    await waitFor(() => {
      expect(recordPatch).toHaveBeenCalledWith({
        param: { id: 'rec_1' },
        json: { title: 'Fixed the importer' },
      });
    });
  });
});
