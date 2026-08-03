import '@testing-library/jest-dom/vitest';

/**
 * The Program work board's CORE-40 track-timer affordance.
 *
 * @remarks
 * The board is one of the required CORE-40 hosts — every task line, in both its `canEdit`
 * (inline-editable title) and read-only (button title) shapes, must offer
 * {@link TaskTimerButton} and starting it must never also open the task. The two shapes used to
 * be structurally different (a plain `<div>` wrapping `EditableTitle` vs. the *whole row* being a
 * single `<button>`); nesting the timer control inside that second shape would have produced an
 * invalid `<button><button /></button>` and a click that both started the timer and opened the
 * task. These pin the row against that regression in both shapes.
 */
import { CycleId, type ProgramWorkOut, TaskOut } from '@docket/types';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, recordsPost } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  recordsPost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      time: {
        active: { $get: activeGet },
        records: { $post: recordsPost },
      },
    },
  },
}));

const { WorkBoard } = await import('../../src/components/programs/work-board');

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TEAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA4';
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const CYCLE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA1';

/** A JSON response shaped like the RPC client's. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** A single-cycle, single-task work payload for one row of assertions. */
function workWith(title: string): ProgramWorkOut {
  const row = TaskOut.parse({
    id: TASK_ID,
    organizationId: ORG_ID,
    title,
    description: null,
    teamId: TEAM_ID,
    state: 'backlog',
    priority: 'medium',
    assigneeId: null,
    delegateId: null,
    projectId: null,
    programId: null,
    dueDate: null,
    provenance: {
      source: 'native',
      sourceIntegrationId: null,
      externalId: null,
      externalUrl: null,
      syncMode: null,
    },
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  return {
    groups: [
      {
        cycle: {
          id: CycleId.parse(CYCLE_ID),
          name: 'Launch week',
          displayName: 'Launch week',
          number: 1,
        },
        segments: [{ project: { id: null }, tasks: [row] }],
      },
    ],
  };
}

/** Render the board with the given edit mode. */
function renderBoard(options: {
  readonly canEdit: boolean;
  readonly onOpenTask: () => void;
}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WorkBoard
          work={workWith('Ship the launch email')}
          loading={false}
          error={null}
          cycleLabel="Cycle"
          taskNoun="task"
          taskNounPlural="tasks"
          projectNoun="project"
          canEdit={options.canEdit}
          onOpenTask={options.onOpenTask}
          {...(options.canEdit ? { onRename: vi.fn() } : {})}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  activeGet.mockReset();
  recordsPost.mockReset();
  activeGet.mockResolvedValue(
    jsonResponse({ record: null, serverNow: new Date().toISOString(), activeAgentExecutions: [] }),
  );
  recordsPost.mockResolvedValue(jsonResponse({ id: 'rec_new' }));
});

describe('WorkBoard track-timer affordance', () => {
  it('starts the task from the read-only (button-title) row shape without opening it', async () => {
    const onOpenTask = vi.fn();
    renderBoard({ canEdit: false, onOpenTask });

    fireEvent.click(await screen.findByTestId(`task-timer-${TASK_ID}`));

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Ship the launch email', taskId: TASK_ID } },
      });
    });
    expect(onOpenTask).not.toHaveBeenCalled();
    // The title's own open button is still intact and separately clickable.
    fireEvent.click(screen.getByRole('button', { name: 'Ship the launch email' }));
    expect(onOpenTask).toHaveBeenCalledWith(TASK_ID);
  });

  it('starts the task from the editable (inline-title) row shape without opening it', async () => {
    const onOpenTask = vi.fn();
    renderBoard({ canEdit: true, onOpenTask });

    fireEvent.click(await screen.findByTestId(`task-timer-${TASK_ID}`));

    await waitFor(() => {
      expect(recordsPost).toHaveBeenCalledWith({
        json: { context: { label: 'Ship the launch email', taskId: TASK_ID } },
      });
    });
    expect(onOpenTask).not.toHaveBeenCalled();
  });
});
