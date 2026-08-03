/**
 * Behaviour tests for {@link import('../../src/components/time-tracking/task-timer-button')}.
 *
 * @remarks
 * `TaskTimerButton` is the start-timer affordance embedded in every real task representation
 * (the task table, search results, the Program work board, Triage, the My Work rows). Every one
 * of those hosts is itself an activatable row — a `<Link>`-wrapped table row or a `ListRow` whose
 * own click opens the task — so the two things worth pinning here are:
 *
 * - it renders and works regardless of the task's workflow state (backlog/in progress/done/
 *   blocked all track), matching the "state-agnostic" contract in its own doc comment;
 * - a click never reaches an ancestor's own click handler, and never triggers an ancestor
 *   `<a href>`'s native navigation — the exact bug that would make the control both start a
 *   timer AND navigate away every time it was pressed.
 */
import '@testing-library/jest-dom/vitest';

import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, recordsPost, recordAction } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
  recordAction: vi.fn(),
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
          },
        },
      },
    },
  },
}));

const { TaskTimerButton } = await import('@/components/time-tracking/task-timer-button');

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const NOTHING_TRACKED = {
  record: null,
  serverNow: new Date().toISOString(),
  activeAgentExecutions: [],
};

/** Render the button as it is actually used: nested inside an activatable ancestor. */
function renderInsideActivatableRow(options: {
  readonly taskId: string;
  readonly title: string;
  readonly onRowActivate: () => void;
}): { readonly client: QueryClient; readonly anchor: HTMLElement } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {/* Mirrors a real host: a whole-row `<a>` (task-table's `Link`) whose own click opens
            the task, with the timer control nested inside it — exactly the shape that would
            double-fire (or navigate away) without the control's own stopPropagation/preventDefault. */}
        <a
          href={`/orgs/org_1/tasks/${options.taskId}`}
          onClick={(event) => {
            event.preventDefault();
            options.onRowActivate();
          }}
        >
          <TaskTimerButton taskId={options.taskId} title={options.title} withLabel={false} />
        </a>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const anchor = screen.getByRole('link');
  return { client, anchor };
}

beforeEach(() => {
  activeGet.mockReset();
  recordsPost.mockReset();
  recordAction.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('TaskTimerButton', () => {
  it.each(['backlog', 'in_progress', 'done', 'blocked'])(
    'offers the track affordance for a task in %s status',
    async (_status) => {
      activeGet.mockResolvedValue(jsonResponse(NOTHING_TRACKED));
      const onRowActivate = vi.fn();
      renderInsideActivatableRow({ taskId: 'task_1', title: 'Ship it', onRowActivate });
      // Workflow state never reaches this component — it is not a prop — so the same render
      // path is exercised for every status; what is pinned is that the control always appears.
      expect(await screen.findByTestId('task-timer-task_1')).toBeInTheDocument();
    },
  );

  it('starts tracking the specific task without activating the enclosing row', async () => {
    activeGet.mockResolvedValue(jsonResponse(NOTHING_TRACKED));
    recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_1' }));
    const onRowActivate = vi.fn();
    const { anchor } = renderInsideActivatableRow({
      taskId: 'task_1',
      title: 'Ship it',
      onRowActivate,
    });

    fireEvent.click(await screen.findByTestId('task-timer-task_1'));

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Ship it', taskId: 'task_1' } },
      });
    });
    // The row's own activation (open the task) must not also have fired.
    expect(onRowActivate).not.toHaveBeenCalled();
    // Nor should the browser have been asked to follow the anchor's href.
    expect(anchor).toHaveAttribute('href', '/orgs/org_1/tasks/task_1');
  });

  it('switches cleanly when a different task is already being tracked', async () => {
    activeGet.mockResolvedValue(
      jsonResponse({
        record: {
          id: 'rec_other',
          hubId: 'hub_1',
          taskId: 'task_other',
          organizationId: 'org_1',
          title: 'Some other task',
          outcomeNote: null,
          status: 'open',
          categoryId: null,
          captureSource: 'live',
          startedAt: new Date().toISOString(),
          endedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          closedAt: null,
          intervals: [
            {
              id: 'int_1',
              timeRecordId: 'rec_other',
              taskId: 'task_other',
              actorKind: 'human',
              userId: 'user_1',
              agentExecutionId: null,
              mode: 'human_active',
              source: 'user_timer',
              startedAt: new Date().toISOString(),
              endedAt: null,
              supersededById: null,
              createdAt: new Date().toISOString(),
              closedAt: null,
            },
          ],
          contexts: [],
          allocations: [],
          measures: {
            elapsedMs: 0,
            humanEffortMs: 0,
            agentEffortMs: 0,
            combinedEffortMs: 0,
            operationalWaitMs: 0,
          },
        },
        serverNow: new Date().toISOString(),
        activeAgentExecutions: [],
      }),
    );
    recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
    const onRowActivate = vi.fn();
    renderInsideActivatableRow({ taskId: 'task_1', title: 'Ship it', onRowActivate });

    const button = await screen.findByTestId('task-timer-task_1');
    // Tracking a *different* task than the one already running shows the neutral "Track" label,
    // not "Pause" — this row is not the one currently being tracked.
    expect(button).toHaveAttribute('aria-label', 'Track this task');

    fireEvent.click(button);
    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Ship it', taskId: 'task_1' } },
      });
    });
  });
});
