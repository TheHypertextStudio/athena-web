/**
 * The Focus panel's behaviour, driven through the DOM.
 *
 * @remarks
 * Pinned here are the ways this panel could look right and be wrong. The elapsed value must come
 * from the SERVER's segments, so a reload resumes rather than restarts, and pausing must actually
 * stop the number moving. Pressing Start must *start* — with no dialog and no name — because the
 * whole rework is that a person should not have to describe work before doing it. A session with
 * no name must still offer to finish, and say what it needs, rather than presenting a dead
 * control. And a suggestion must track the task it names rather than creating a second one.
 */
import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, timelineGet, recordsPost, recordAction, recordPatch } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  timelineGet: vi.fn(),
  recordsPost: vi.fn(),
  recordAction: vi.fn(),
  recordPatch: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: { $get: activeGet },
        timeline: { $get: timelineGet },
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

const { default: FocusPanel } = await import('@/components/time-tracking/focus-panel');

const SERVER_NOW = new Date('2026-08-02T12:00:00.000Z');

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** One open segment starting `startedMinutesAgo` before the server's clock. */
function activePayload(options: {
  readonly startedMinutesAgo: number;
  readonly running: boolean;
  readonly title?: string;
  readonly taskId?: string | null;
  readonly suggestion?: unknown;
}): unknown {
  const startedAt = new Date(SERVER_NOW.getTime() - options.startedMinutesAgo * 60_000);
  const taskId = options.taskId === undefined ? 'task_1' : options.taskId;
  return {
    serverNow: SERVER_NOW.toISOString(),
    suggestion: options.suggestion ?? null,
    activeAgentExecutions: [],
    record: {
      id: 'rec_1',
      hubId: 'hub_1',
      taskId,
      organizationId: taskId ? 'org_1' : null,
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
          taskId,
          actorKind: 'human',
          userId: 'user_1',
          agentExecutionId: null,
          mode: 'human_active',
          source: 'user_timer',
          startedAt: startedAt.toISOString(),
          endedAt: options.running ? null : SERVER_NOW.toISOString(),
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

/** Nothing tracking, with an optional suggestion. */
function idlePayload(suggestion: unknown = null): unknown {
  return {
    record: null,
    suggestion,
    serverNow: SERVER_NOW.toISOString(),
    activeAgentExecutions: [],
  };
}

/** A calendar-derived suggestion for the 2–3pm block. */
function calendarSuggestion(): unknown {
  return {
    taskId: 'task_deep',
    organizationId: 'org_1',
    title: 'Deep work: onboarding rewrite',
    source: 'calendar_timebox',
    calendarItemId: 'cal_1',
    startsAt: new Date(SERVER_NOW.getTime() - 12 * 60_000).toISOString(),
    endsAt: new Date(SERVER_NOW.getTime() + 48 * 60_000).toISOString(),
  };
}

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The app mounts one `TooltipProvider` at the root (`components/providers.tsx`); the panel is
  // always inside it, so the harness reproduces that rather than the component carrying its own.
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <FocusPanel />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(SERVER_NOW);
  activeGet.mockReset();
  timelineGet.mockReset();
  recordsPost.mockReset();
  recordAction.mockReset();
  recordPatch.mockReset();
  timelineGet.mockResolvedValue(jsonResponse({ items: [] }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FocusPanel', () => {
  it('starts the timer on one press, with no name and no dialog', async () => {
    activeGet.mockResolvedValue(jsonResponse(idlePayload()));
    recordsPost.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 0, running: true })),
    );
    renderPanel();

    const start = await screen.findByTestId('timer-start');
    fireEvent.click(start);

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledTimes(1);
    });
    // The whole point: the request carries no label and no task, so nothing had to be described
    // before the clock began.
    expect(recordsPost).toHaveBeenCalledWith({ json: { context: {} } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tracks the suggested task, and says why it suggested it', async () => {
    activeGet.mockResolvedValue(jsonResponse(idlePayload(calendarSuggestion())));
    recordsPost.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 0, running: true })),
    );
    renderPanel();

    expect(await screen.findByText('Deep work: onboarding rewrite')).toBeInTheDocument();
    expect(screen.getByText('Scheduled now')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('timer-start-suggested'));
    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({ json: { context: { taskId: 'task_deep' } } });
    });
  });

  it('shows elapsed time from the server segments, not from when the panel mounted', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    renderPanel();
    expect(await screen.findByTestId('timer-elapsed')).toHaveTextContent('07:00');
  });

  it('keeps counting while running and holds still while paused', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 1, running: true })),
    );
    renderPanel();
    expect(await screen.findByTestId('timer-elapsed')).toHaveTextContent('01:00');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByTestId('timer-elapsed')).toHaveTextContent('01:03');

    cleanup();
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 1, running: false })),
    );
    renderPanel();
    expect(await screen.findByTestId('timer-elapsed')).toHaveTextContent('01:00');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId('timer-elapsed')).toHaveTextContent('01:00');
  });

  it('offers resume rather than pause once paused', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 2, running: false })),
    );
    recordAction.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 2, running: true })),
    );
    renderPanel();

    fireEvent.click(await screen.findByTestId('timer-resume'));
    await waitFor(() => {
      expect(recordAction).toHaveBeenCalledWith({ param: { id: 'rec_1' } });
    });
    expect(screen.queryByTestId('timer-pause')).toBeNull();
  });

  it('asks for a name when finishing an unnamed session, instead of disabling the control', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 3, running: true, title: '', taskId: null })),
    );
    renderPanel();

    const finish = await screen.findByTestId('timer-stop');
    // Flag over disable: the gesture is accepted, and the panel says what it still needs.
    expect(finish).not.toBeDisabled();
    fireEvent.click(finish);

    expect(await screen.findByText('Name this before finishing.')).toBeInTheDocument();
    expect(recordAction).not.toHaveBeenCalled();
  });

  it('finishes a named unanchored session in one request that carries the name', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(
        activePayload({
          startedMinutesAgo: 3,
          running: true,
          title: 'Fixing the drag handles',
          taskId: null,
        }),
      ),
    );
    recordAction.mockResolvedValue(jsonResponse(idlePayload()));
    renderPanel();

    fireEvent.click(await screen.findByTestId('timer-stop'));
    await waitFor(() => {
      // One call, not a rename followed by a stop — a failed second write used to leave a renamed
      // session still running.
      expect(recordAction).toHaveBeenCalledTimes(1);
    });
    expect(recordAction).toHaveBeenCalledWith({
      param: { id: 'rec_1' },
      json: { title: 'Fixing the drag handles' },
    });
    expect(recordPatch).not.toHaveBeenCalled();
  });
});
