/**
 * Behavior tests for {@link ProjectTasksTab} — the project Tasks tab's lens choice and assignee
 * resolution.
 *
 * @remarks
 * The milestone list and the graph are replaced by stubs: the list stub renders each task's
 * resolved assignee name, which is the value this tab is responsible for, and the graph stub only
 * marks that the graph lens is mounted.
 */
import { assertDefined } from '@docket/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MilestoneTask } from '../../../src/components/project-detail/milestone-tasks';

const { membersGet, agentsGet } = vi.hoisted(() => ({
  membersGet: vi.fn(),
  agentsGet: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          members: { $get: membersGet },
          agents: { $get: agentsGet },
        },
      },
    },
  },
}));

vi.mock('../../../src/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../../../src/components/canvas/task-graph-panel', () => ({
  default: () => <div data-testid="task-graph" />,
}));

interface StubListProps {
  readonly tasks: readonly MilestoneTask[];
  readonly resolveActor: (actorId: string | null | undefined) => { readonly name: string };
}

vi.mock('../../../src/components/project-detail/milestone-tasks', () => ({
  MilestoneTasks: ({ tasks, resolveActor }: StubListProps) => (
    <ul data-testid="task-list">
      {tasks.map(({ task }) => (
        <li key={task.id} data-testid="task-row">
          {resolveActor(task.assigneeId).name}
        </li>
      ))}
    </ul>
  ),
}));

import {
  ProjectTasksTab,
  resolveProjectActor,
} from '../../../src/components/project-detail/project-tasks-tab';

afterEach(cleanup);

/** A `Response`-like stub whose `ok`/`status`/`json()` `unwrap` reads. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const VIEWER = { actorId: 'actor-viewer', displayName: 'Robin Park' };

function task(id: string, assigneeId: string | null): MilestoneTask {
  return {
    task: { id, title: id, assigneeId } as unknown as MilestoneTask['task'],
    milestoneId: null,
  };
}

function renderTab(children: ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe('ProjectTasksTab', () => {
  it('names the signed-in person on a task assigned to them', async () => {
    membersGet.mockResolvedValue(jsonResponse({ items: [VIEWER] }));
    agentsGet.mockResolvedValue(jsonResponse({ items: [] }));

    renderTab(
      <ProjectTasksTab
        orgId="org-1"
        projectId="project-1"
        tasks={[task('task-1', VIEWER.actorId)]}
        milestones={[]}
        workFailure={null}
        onOpenTask={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('task-row')).toHaveTextContent(VIEWER.displayName);
    });
  });

  it('shows one lens at a time, starting with the list', async () => {
    membersGet.mockResolvedValue(jsonResponse({ items: [VIEWER] }));
    agentsGet.mockResolvedValue(jsonResponse({ items: [] }));

    renderTab(
      <ProjectTasksTab
        orgId="org-1"
        projectId="project-1"
        tasks={[task('task-1', null)]}
        milestones={[]}
        workFailure={null}
        onOpenTask={() => undefined}
      />,
    );

    expect(screen.getByTestId('task-list')).toBeInTheDocument();
    expect(screen.queryByTestId('task-graph')).not.toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    fireEvent.click(assertDefined(tabs[1]));

    await waitFor(() => {
      expect(screen.getByTestId('task-graph')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
  });
});

describe('resolveProjectActor', () => {
  const agent = { actorId: 'actor-agent' };

  it('resolves members by display name and agents by kind', () => {
    const input = { members: [VIEWER], agents: [agent] };
    expect(resolveProjectActor(input, VIEWER.actorId)).toEqual({
      name: VIEWER.displayName,
      kind: 'human',
    });
    expect(resolveProjectActor(input, agent.actorId).kind).toBe('agent');
  });

  it('keeps an unresolved id distinct from a pending roster', () => {
    const pending = resolveProjectActor({ members: undefined, agents: [] }, 'actor-other');
    const missing = resolveProjectActor({ members: [VIEWER], agents: [] }, 'actor-other');
    expect(pending.name).not.toBe(missing.name);
    expect(missing.name).toContain('actor-');
  });
});
