/**
 * Behavior tests for {@link MilestoneTasks} — the project Tasks tab's milestone-grouped list.
 *
 * @remarks
 * The list renders through the shared `TaskTable`; these cover what the project tab itself wires
 * into it: each row's status glyph reads the workspace's statuses, and subtasks sit under their
 * parent inside a milestone section.
 */
import '@testing-library/jest-dom/vitest';

import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { TaskId } from '@docket/work/ids';
import { type TaskOut } from '@docket/work/task-model';
import { TooltipProvider } from '@docket/ui/primitives';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { activeGet, displayGet } = vi.hoisted(() => ({
  activeGet: vi.fn(),
  displayGet: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      time: { active: { $get: activeGet } },
      orgs: {
        ':orgId': {
          display: { ':subjectType': { $get: displayGet } },
        },
      },
    },
  },
}));

vi.mock('@/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open: vi.fn() }),
}));

import {
  type MilestoneTask,
  MilestoneTasks,
} from '../../../src/components/project-detail/milestone-tasks';

const ORG_ID = '01HZZZ0000000000000000000G';
const TEAM_ID = '01HZZZ0000000000000000000T';
const PARENT_ID = '01HZZZ0000000000000000T001';
const CHILD_ID = '01HZZZ0000000000000000T002';
const SIBLING_ID = '01HZZZ0000000000000000T003';

/** A `Response`-like stub whose `ok`/`status`/`json()` `unwrap` reads. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** A minimal project task with no milestone. */
function milestoneTask(id: string, state: string, parentTaskId: string | null): MilestoneTask {
  const task: TaskOut = {
    labels: [],
    id: TaskId.parse(id),
    organizationId: OrganizationId.parse(ORG_ID),
    teamId: TeamId.parse(TEAM_ID),
    title: id,
    state,
    priority: 'none',
    autoCompletedBySubtasks: false,
    parentTaskId: parentTaskId === null ? null : TaskId.parse(parentTaskId),
    provenance: { source: 'native' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { task, milestoneId: null };
}

/** Render the list with inert callbacks. */
function renderList(tasks: readonly MilestoneTask[]): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MilestoneTasks
          orgId={ORG_ID}
          tasks={tasks}
          milestones={[]}
          resolveActor={() => ({ name: 'Someone', kind: 'human' })}
          taskNoun="task"
          onOpenTask={() => undefined}
          onCreate={() => undefined}
          onQuickAdd={async () => undefined}
          onRename={() => undefined}
          canEdit={false}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** The table row carrying one task. */
function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[role="row"][data-object-id="${id}"]`);
  if (!element) throw new Error(`Expected task row ${id}`);
  return element;
}

beforeEach(() => {
  activeGet.mockResolvedValue(
    jsonResponse({
      record: null,
      serverNow: new Date().toISOString(),
      suggestion: null,
      activeAgentExecutions: [],
    }),
  );
  displayGet.mockResolvedValue(jsonResponse({ items: [] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MilestoneTasks', () => {
  it("draws each task's status glyph from the workspace's statuses", () => {
    renderList([
      milestoneTask(PARENT_ID, 'in_progress', null),
      milestoneTask(CHILD_ID, 'done', null),
    ]);

    expect(row(PARENT_ID).querySelector('[data-state-type]')).toHaveAttribute(
      'data-state-type',
      'started',
    );
    expect(row(CHILD_ID).querySelector('[data-state-type]')).toHaveAttribute(
      'data-state-type',
      'completed',
    );
  });

  it('places a subtask directly under its parent, one level deeper, joined by rails', () => {
    // By workflow state alone the to-do child would lead the section, ahead of its started parent.
    renderList([
      milestoneTask(PARENT_ID, 'in_progress', null),
      milestoneTask(SIBLING_ID, 'in_progress', null),
      milestoneTask(CHILD_ID, 'todo', PARENT_ID),
    ]);

    const grid = screen.getByRole('treegrid');
    const order = Array.from(grid.querySelectorAll('[role="row"][data-object-id]')).map((element) =>
      element.getAttribute('data-object-id'),
    );
    expect(order).toEqual([PARENT_ID, CHILD_ID, SIBLING_ID]);
    expect(row(PARENT_ID)).toHaveAttribute('aria-level', '1');
    expect(row(PARENT_ID)).not.toHaveAttribute('aria-expanded');
    expect(row(CHILD_ID)).toHaveAttribute('aria-level', '2');
    expect(row(SIBLING_ID)).toHaveAttribute('aria-level', '1');
    // The parent draws the rail down to its subtask and the subtask its elbow; a lone task has none.
    expect(within(row(PARENT_ID)).getByTestId('hierarchy-rail')).toHaveAttribute('aria-hidden');
    expect(within(row(CHILD_ID)).getByTestId('hierarchy-rail')).toBeInTheDocument();
    expect(within(row(SIBLING_ID)).queryByTestId('hierarchy-rail')).toBeNull();
    // The title link names only the task; its status glyph sits beside it.
    const link = within(row(CHILD_ID)).getByRole('link', { name: CHILD_ID });
    expect(link).toHaveAttribute('href', `/orgs/${ORG_ID}/tasks/${CHILD_ID}`);
    expect(link.querySelector('[data-state-type]')).toBeNull();
  });

  it('keeps a flat list a plain grid with no rails', () => {
    renderList([milestoneTask(PARENT_ID, 'todo', null), milestoneTask(CHILD_ID, 'todo', null)]);

    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByTestId('hierarchy-rail')).toBeNull();
  });
});
