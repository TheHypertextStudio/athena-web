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

import type { TimeRecordOut } from '@docket/types';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDefined } from '@docket/test-utils';

const {
  activeGet,
  timelineGet,
  recordsPost,
  recordAction,
  recordPatch,
  taskGet,
  teamGet,
  todayGet,
  searchGet,
} = vi.hoisted(() => ({
  activeGet: vi.fn(),
  timelineGet: vi.fn(),
  recordsPost: vi.fn(),
  recordAction: vi.fn(),
  recordPatch: vi.fn(),
  taskGet: vi.fn(),
  teamGet: vi.fn(),
  todayGet: vi.fn(),
  searchGet: vi.fn(),
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
            status: { $put: recordAction },
            $patch: recordPatch,
          },
        },
      },
      orgs: {
        ':orgId': {
          tasks: { ':id': { $get: taskGet } },
          teams: { ':teamId': { $get: teamGet } },
        },
      },
      hub: {
        today: { $get: todayGet },
        search: { $get: searchGet },
      },
    },
  },
}));

vi.mock('../../src/components/active-org', () => ({
  useActiveOrg: () => ({
    orgName: (orgId: string) => (orgId === 'org_2' ? 'Transit' : 'Personal'),
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
}) {
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

/** Focused task detail with enough real context for the working companion. */
function taskPayload(): unknown {
  return {
    id: 'task_1',
    organizationId: 'org_1',
    title: 'Rewrite the onboarding email',
    description: 'Make the activation path clearer for new workspace owners.',
    teamId: 'team_1',
    state: 'in_progress',
    priority: 'high',
    assigneeId: null,
    delegateId: null,
    projectId: null,
    programId: null,
    estimateMinutes: null,
    startDate: null,
    dueDate: '2026-08-02',
    provenance: { source: 'native' },
    createdAt: '2026-08-01T12:00:00.000Z',
    milestoneId: null,
    cycleId: null,
    parentTaskId: null,
    estimate: null,
    completedAt: null,
    canceledAt: null,
    blocking: [],
    blockedBy: [],
    subtasks: [
      { id: 'sub_1', title: 'Draft copy', state: 'done', projectId: null },
      { id: 'sub_2', title: 'Review copy', state: 'in_progress', projectId: null },
    ],
  };
}

/** Accepted work for the day, including the task already being tracked. */
function todayPayload(): unknown {
  const task = (id: string, organizationId: string, title: string, position: number) => ({
    id,
    organizationId,
    title,
    state: 'backlog',
    stateType: 'backlog',
    priority: 'none',
    assigneeId: null,
    projectId: null,
    dueDate: null,
    planItemId: `plan_${id}`,
    planStatus: 'planned',
    sort: position,
    position,
    estimateMinutes: null,
    timeboxStartsAt: null,
    timeboxEndsAt: null,
    blocked: false,
    dependencyImpact: 0,
    reason: 'Accepted into today’s plan',
  });
  return {
    date: '2026-08-02',
    planState: 'active',
    attentionSummary: { approvals: 0, blocked: 0, dueToday: 0, inbox: 0, attentionCount: 0 },
    plan: [
      task('task_1', 'org_1', 'Rewrite the onboarding email', 0),
      task('task_2', 'org_1', 'Draft the launch checklist', 1),
      task('task_3', 'org_2', 'Review the Maryland Parkway route map', 2),
    ],
    focus: { now: null, after: null },
    statusCards: [],
    suggestions: [],
    calendar: [],
    needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 0 },
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
  taskGet.mockReset();
  teamGet.mockReset();
  todayGet.mockReset();
  searchGet.mockReset();
  timelineGet.mockResolvedValue(jsonResponse({ items: [] }));
  todayGet.mockResolvedValue(jsonResponse(todayPayload()));
  searchGet.mockResolvedValue(
    jsonResponse({ query: '', items: [], facets: [], nextCursor: undefined }),
  );
  taskGet.mockResolvedValue(jsonResponse(taskPayload()));
  teamGet.mockResolvedValue(
    jsonResponse({
      id: 'team_1',
      workflowStates: [
        { key: 'in_progress', name: 'In progress', type: 'started', position: 0 },
        { key: 'done', name: 'Done', type: 'completed', position: 1 },
      ],
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FocusPanel', () => {
  it("marks its content body as the rail presentation's only scroll owner", async () => {
    activeGet.mockResolvedValue(jsonResponse(idlePayload()));
    renderPanel();

    await screen.findByTestId('timer-start');
    expect(screen.getByTestId('focus-panel-body')).toHaveAttribute(
      'data-scroll-owner',
      'focus-panel',
    );
  });

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

  it('gives the wrapping task title its own row and puts task actions at the row end', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    renderPanel();

    const taskLink = await screen.findByRole('link', { name: 'Rewrite the onboarding email' });
    expect(taskLink).toHaveAttribute('href', '/orgs/org_1/tasks/task_1');
    expect(taskLink).toHaveClass('w-full', 'whitespace-normal');
    expect(taskLink.querySelector('svg')).toBeNull();
    expect(taskLink.parentElement?.querySelector('button')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'What you are working on' })).toBeNull();

    const pause = screen.getByTestId('timer-pause');
    const finish = screen.getByTestId('timer-stop');
    expect(screen.getByText('Pause', { selector: 'span' })).not.toHaveClass('hidden');
    expect(screen.getByText('Finish', { selector: 'span' })).not.toHaveClass('hidden');
    expect(pause).toHaveClass('min-h-10');
    expect(finish).toHaveClass('min-h-10');

    const taskActions = screen.getByRole('button', { name: 'Task actions' });
    expect(taskActions).toHaveClass('ml-auto');
    fireEvent.pointerDown(taskActions, { button: 0, ctrlKey: false });
    expect(await screen.findByRole('menuitem', { name: 'Open task' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename task' }));
    expect(screen.getByRole('textbox', { name: 'What you are working on' })).toBeInTheDocument();
  });

  it('keeps the rail neutral while the active timer is loading', () => {
    activeGet.mockImplementation(() => new Promise(() => undefined));
    renderPanel();

    expect(screen.getByTestId('timer-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('timer-start')).toBeNull();
    expect(screen.queryByText('Nothing tracking')).toBeNull();
  });

  it('shows an application-owned timer read error without exposing Start', async () => {
    activeGet.mockRejectedValue(new Error('provider detail that must stay hidden'));
    renderPanel();

    expect(await screen.findByText('Could not load your timer.')).toBeInTheDocument();
    expect(screen.queryByText(/provider detail/)).toBeNull();
    expect(screen.queryByTestId('timer-start')).toBeNull();
  });

  it('shows actual upcoming work, excludes the active task, and keeps today truthful', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    timelineGet.mockResolvedValue(
      jsonResponse({
        items: [
          activePayload({ startedMinutesAgo: 7, running: true }).record,
          {
            ...activePayload({ startedMinutesAgo: 60, running: false, title: 'Plan launch' })
              .record,
            id: 'rec_2',
            taskId: 'task_2',
            organizationId: 'org_1',
            title: 'Plan launch',
          },
        ],
      }),
    );
    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rewrite the onboarding email' })).toBeNull();
    expect(screen.getByRole('button', { name: /Draft the launch checklist/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Review the Maryland Parkway route map/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Select to switch')).toBeNull();
    expect(screen.queryByText('In progress')).toBeNull();
    expect(screen.getByText('1h 7m tracked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan launch' })).toHaveAttribute(
      'href',
      '/orgs/org_1/tasks/task_2',
    );
    expect(screen.getByRole('link', { name: 'Plan launch' })).toHaveClass('min-h-10');
  });

  it('switches to planned work with the existing atomic timer command', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    recordsPost.mockResolvedValue(
      jsonResponse(
        activePayload({
          startedMinutesAgo: 0,
          running: true,
          taskId: 'task_2',
          title: 'Draft the launch checklist',
        }),
      ),
    );
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Draft the launch checklist/ }));
    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Draft the launch checklist', taskId: 'task_2' } },
      });
    });
  });

  it('creates and tracks typed work from the Up next field', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    recordsPost.mockResolvedValue(
      jsonResponse(
        activePayload({
          startedMinutesAgo: 0,
          running: true,
          taskId: 'task_new',
          title: 'Write the launch notes',
        }),
      ),
    );
    renderPanel();

    const field = await screen.findByRole('searchbox', { name: 'Find or create a task' });
    expect(field).toHaveClass('min-h-11');
    fireEvent.change(field, { target: { value: 'Write the launch notes' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Write the launch notes' } },
      });
    });
  });

  it('removes the unrelated Athena handoff and compacts Focus mode into one menu', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    renderPanel();

    expect(screen.queryByRole('textbox', { name: 'Hand something to Athena' })).toBeNull();
    expect(screen.queryByText('Open in this tab')).toBeNull();
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Focus mode' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByRole('menuitem', { name: 'Open focus mode' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open in this tab' })).toBeInTheDocument();
  });

  it('shows the newest two earlier sessions from the API ascending timeline', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    const record = (minutes: number, id: string, taskId: string, title: string) => ({
      ...activePayload({ startedMinutesAgo: minutes, running: false, title }).record,
      id,
      taskId,
      organizationId: 'org_1',
      title,
    });
    timelineGet.mockResolvedValue(
      jsonResponse({
        items: [
          record(180, 'rec_oldest', 'task_oldest', 'Oldest work'),
          record(120, 'rec_middle', 'task_middle', 'Middle work'),
          record(60, 'rec_newest', 'task_newest', 'Newest work'),
          activePayload({ startedMinutesAgo: 7, running: true }).record,
        ],
      }),
    );
    renderPanel();

    expect(await screen.findByRole('link', { name: 'Newest work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Middle work' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Oldest work' })).toBeNull();
  });

  it('orders recent work by the newest real human segment after a resume', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    const resumedBase = activePayload({
      startedMinutesAgo: 180,
      running: false,
      title: 'Resumed work',
    }).record;
    const originalInterval = assertDefined(resumedBase.intervals[0]);
    const resumed = {
      ...resumedBase,
      id: 'rec_resumed',
      taskId: 'task_resumed',
      title: 'Resumed work',
      intervals: [
        originalInterval,
        {
          ...originalInterval,
          id: 'int_resumed',
          startedAt: new Date(SERVER_NOW.getTime() - 30 * 60_000).toISOString(),
        },
        {
          ...originalInterval,
          id: 'int_superseded',
          startedAt: new Date(SERVER_NOW.getTime() - 5 * 60_000).toISOString(),
          supersededById: 'int_replacement',
        },
      ],
    } as unknown as TimeRecordOut;
    const completed = {
      ...activePayload({ startedMinutesAgo: 60, running: false, title: 'Completed work' }).record,
      id: 'rec_completed',
      taskId: 'task_completed',
      title: 'Completed work',
    };
    timelineGet.mockResolvedValue(
      jsonResponse({
        items: [resumed, completed, activePayload({ startedMinutesAgo: 7, running: true }).record],
      }),
    );
    renderPanel();

    const resumedLink = await screen.findByRole('link', { name: 'Resumed work' });
    const completedLink = screen.getByRole('link', { name: 'Completed work' });
    const recentLinks = screen.getAllByRole('link');
    const resumedIndex = recentLinks.indexOf(resumedLink);
    const completedIndex = recentLinks.indexOf(completedLink);
    expect(resumedIndex).toBeGreaterThanOrEqual(0);
    expect(resumedIndex).toBeLessThan(completedIndex);
  });

  it('refetches the active timer immediately after another window changes it', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    renderPanel();
    expect(await screen.findByTestId('timer-pause')).toBeInTheDocument();

    activeGet.mockResolvedValue(jsonResponse(idlePayload()));
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'docket.focus.timer-change',
        newValue: 'another-window',
      }),
    );

    expect(await screen.findByTestId('timer-start')).toBeInTheDocument();
    expect(activeGet).toHaveBeenCalledTimes(2);
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
      expect(recordAction).toHaveBeenCalledWith({
        param: { id: 'rec_1' },
        json: { status: 'running' },
      });
    });
    expect(screen.queryByTestId('timer-pause')).toBeNull();
  });

  it.each([
    ['pause', true, 'timer-pause'],
    ['resume', false, 'timer-resume'],
    ['finish', true, 'timer-stop'],
  ] as const)(
    'reports a failed %s transition without losing the session',
    async (_label, running, testId) => {
      activeGet.mockResolvedValue(jsonResponse(activePayload({ startedMinutesAgo: 2, running })));
      recordAction.mockRejectedValue(new Error('network provider detail'));
      renderPanel();

      fireEvent.click(await screen.findByTestId(testId));

      expect(await screen.findByText('Could not update the timer. Try again.')).toBeInTheDocument();
      expect(screen.getByTestId('focus-session')).toBeInTheDocument();
      expect(screen.queryByText(/provider detail/)).toBeNull();
    },
  );

  it('keeps the rename field and draft available when renaming fails', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    recordPatch.mockRejectedValue(new Error('network provider detail'));
    renderPanel();

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Task actions' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename task' }));
    const field = screen.getByRole('textbox', { name: 'What you are working on' });
    fireEvent.change(field, { target: { value: 'A clearer onboarding email' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(await screen.findByText('Could not rename the task. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'What you are working on' })).toHaveValue(
      'A clearer onboarding email',
    );
  });

  it('retains and retries an unanchored name after the first save fails', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true, title: '', taskId: null })),
    );
    recordPatch.mockRejectedValueOnce(new Error('network provider detail'));
    renderPanel();

    const field = await screen.findByRole('textbox', { name: 'What you are working on' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Prepare the stakeholder brief' } });
    fireEvent.blur(field);

    expect(await screen.findByText('Could not rename the task. Try again.')).toBeInTheDocument();
    await waitFor(() => {
      expect(field).toHaveValue('Prepare the stakeholder brief');
    });

    recordPatch.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 7, running: true })),
    );
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(recordPatch).toHaveBeenCalledTimes(2);
    });
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
      json: { status: 'stopped', title: 'Fixing the drag handles' },
    });
    expect(recordPatch).not.toHaveBeenCalled();
  });

  it('finishes a freshly typed unanchored name without racing a separate rename', async () => {
    activeGet.mockResolvedValue(
      jsonResponse(activePayload({ startedMinutesAgo: 3, running: true, title: '', taskId: null })),
    );
    recordAction.mockResolvedValue(jsonResponse(idlePayload()));
    renderPanel();

    const field = await screen.findByRole('textbox', { name: 'What you are working on' });
    fireEvent.change(field, { target: { value: 'Prepare the board brief' } });
    fireEvent.blur(field, { relatedTarget: screen.getByTestId('timer-stop') });
    fireEvent.click(screen.getByTestId('timer-stop'));

    await waitFor(() => {
      expect(recordAction).toHaveBeenCalledWith({
        param: { id: 'rec_1' },
        json: { status: 'stopped', title: 'Prepare the board brief' },
      });
    });
    expect(recordPatch).not.toHaveBeenCalled();
  });
});
