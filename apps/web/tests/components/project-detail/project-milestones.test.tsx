/**
 * Behavior tests for {@link ProjectMilestonesPanel} — the project Overview's milestone list,
 * quick-add, and remove.
 *
 * @remarks
 * The panel owns its own create/delete mutations via `useProjectMilestones`, so the RPC client is
 * mocked (rather than passing callback props) and wrapped in a real `QueryClientProvider`,
 * mirroring `integration-config-panel.test.tsx`'s pattern for hook-owning components.
 *
 * A milestone is read and edited where it sits: each row is a disclosure that opens its date and
 * note in place. These cases cover what belongs to the list — ordering, progress, opening a row,
 * adding one, removing one — and the guarantee that opening one neither navigates nor overlays.
 */
import { MilestoneId, ProjectId, TaskId } from '@docket/work/ids';
import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { type MilestoneOut } from '@docket/work/milestone-contract';
import { type TaskOut } from '@docket/work/task-model';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the mock factory (lifted above imports) can reference them.
const { milestonesPost, milestonesDelete } = vi.hoisted(() => ({
  milestonesPost: vi.fn(),
  milestonesDelete: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          projects: {
            ':id': {
              milestones: Object.assign(
                { ':milestoneId': { $delete: milestonesDelete } },
                { $post: milestonesPost },
              ),
            },
          },
        },
      },
    },
  },
}));

import { ProjectMilestonesPanel } from '../../../src/components/project-detail/project-milestones';
import type { MilestoneTask } from '../../../src/components/project-detail/milestone-tasks';

/** A `Response`-like stub whose `ok`/`status`/`json()` `unwrap` reads. */
function jsonResponse(ok: boolean, body: unknown, status = ok ? 200 : 400): Response {
  return { ok, status, json: async () => body } as Response;
}

const ORG_ID = OrganizationId.parse('01HZZZ0000000000000000000G');
const PROJECT_ID = ProjectId.parse('01HZZZ0000000000000000000P');
const TEAM_ID = TeamId.parse('01HZZZ0000000000000000000T');
const MILESTONE_1 = MilestoneId.parse('01HZZZ000000000000000000M1');
const MILESTONE_2 = MilestoneId.parse('01HZZZ000000000000000000M2');
const TASK_1 = TaskId.parse('01HZZZ00000000000000000TK1');
const TASK_2 = TaskId.parse('01HZZZ00000000000000000TK2');

/** A minimal milestone fixture. */
function milestone(overrides: Partial<MilestoneOut> & { id: string; name: string }): MilestoneOut {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    description: null,
    targetDate: null,
    sort: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A minimal task fixture, paired with its milestone id, for the per-row progress bar. */
function milestoneTask(id: string, state: string, milestoneId: string | null): MilestoneTask {
  const task: TaskOut = {
    labels: [],
    id: TaskId.parse(id),
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    title: 'T',
    state,
    priority: 'none',
    autoCompletedBySubtasks: false,
    provenance: { source: 'native' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return { task, milestoneId };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(overrides: Partial<Parameters<typeof ProjectMilestonesPanel>[0]> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectMilestonesPanel
        orgId={ORG_ID}
        projectId={PROJECT_ID}
        milestones={[]}
        milestoneTasks={[]}
        taskNoun="task"
        canEdit
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe('ProjectMilestonesPanel', () => {
  it('shows an inviting empty state with no milestones', () => {
    renderPanel();
    expect(screen.getByText(/No milestones yet/)).toBeTruthy();
  });

  it('renders each milestone name, description, and per-row progress', () => {
    renderPanel({
      milestones: [
        milestone({ id: MILESTONE_1, name: 'Beta', description: 'Ship the beta', sort: 0 }),
      ],
      milestoneTasks: [
        milestoneTask(TASK_1, 'done', MILESTONE_1),
        milestoneTask(TASK_2, 'backlog', MILESTONE_1),
      ],
    });

    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Ship the beta')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('expands a milestone in place rather than navigating or covering the project', async () => {
    renderPanel({
      milestones: [milestone({ id: MILESTONE_1, name: 'Beta', sort: 0 })],
    });

    // A milestone has no address of its own and no overlay: it opens where it already sits.
    expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Beta' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The note editor comes with the disclosure, on the project's own surface.
    expect(await screen.findByRole('button', { name: /Beta target date/ })).toBeTruthy();
  });

  it('orders rows by sort, not by the order they arrive in', () => {
    renderPanel({
      milestones: [
        milestone({ id: MILESTONE_2, name: 'Launch', sort: 1 }),
        milestone({ id: MILESTONE_1, name: 'Beta', sort: 0 }),
      ],
    });

    // The disclosure triggers, in DOM order — the only buttons that carry an expanded state.
    const triggers = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-expanded') !== null)
      .map((button) => button.textContent);
    expect(triggers[0]).toContain('Beta');
    expect(triggers[1]).toContain('Launch');
  });

  it('hides the progress bar when a milestone has no tasks', () => {
    renderPanel({
      milestones: [milestone({ id: MILESTONE_1, name: 'Beta' })],
      milestoneTasks: [],
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('hides every mutation affordance when canEdit is false', () => {
    renderPanel({
      milestones: [milestone({ id: MILESTONE_1, name: 'Beta' })],
      canEdit: false,
    });

    // No quick-add row and no remove button — but the milestone still opens, because reading one
    // is not a mutation.
    expect(screen.queryByPlaceholderText('Add a milestone…')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove Beta/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy();
  });

  it('removes a milestone with no confirmation dialog', async () => {
    milestonesDelete.mockResolvedValue(jsonResponse(true, { id: MILESTONE_1 }));
    renderPanel({ milestones: [milestone({ id: MILESTONE_1, name: 'Beta' })] });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }));

    // No dialog/confirm affordance appears — the click fires the delete directly.
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(milestonesDelete).toHaveBeenCalledWith({
        param: { orgId: ORG_ID, id: PROJECT_ID, milestoneId: MILESTONE_1 },
      });
    });
  });

  it('quick-adds a milestone by typing a name and pressing Enter', async () => {
    milestonesPost.mockResolvedValue(
      jsonResponse(true, milestone({ id: MILESTONE_2, name: 'Launch' })),
    );
    renderPanel();

    const input = screen.getByPlaceholderText('Add a milestone…');
    fireEvent.change(input, { target: { value: 'Launch' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      // No position: the server appends, because this row accepts the next name before the
      // previous create has settled and its copy of the list is out of date by design.
      expect(milestonesPost).toHaveBeenCalledWith({
        param: { orgId: ORG_ID, id: PROJECT_ID },
        json: { name: 'Launch' },
      });
    });
    // The input clears so the next entry can flow straight in.
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('does not create on an empty or whitespace-only quick-add submission', () => {
    renderPanel();
    const input = screen.getByPlaceholderText('Add a milestone…');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(milestonesPost).not.toHaveBeenCalled();
  });

  it('keeps a refused quick-add on screen so its words are not lost', async () => {
    milestonesPost.mockResolvedValue(jsonResponse(false, { detail: 'nope' }));
    renderPanel();

    const input = screen.getByPlaceholderText('Add a milestone…');
    fireEvent.change(input, { target: { value: 'Launch' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The field clears immediately so the next one can be typed; the refused text reappears as
    // its own retryable row rather than being written back over the field.
    expect((input as HTMLInputElement).value).toBe('');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry adding Launch' })).toBeTruthy();
    });
  });
});
