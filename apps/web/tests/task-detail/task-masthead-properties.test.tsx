/**
 * The task masthead's property chips: which properties lead, at what priority, and what they write.
 *
 * @remarks
 * The lead set (status, priority, assignee, project, due date) is the last thing the metadata row
 * gives up as the pane narrows, so the priorities are the contract: status and priority at 0, then
 * assignee, project, and due date at 1, 2, and 3, with the secondary set behind them.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskDetail } from '@docket/work/task-model';
import { DEFAULT_WORKFLOW_STATES } from '@docket/work/workflow';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TaskMetadataRow,
  type TaskPropertyModel,
} from '../../src/components/task-detail/task-masthead-properties';
import { EntityDetailLayout } from '../../src/components/views/entity-detail-layout';
import { mockWideMetadataRow } from '../support/metadata-row-layout';
import { makeQueryWrapper } from '../support/query';

const canManage = vi.hoisted(() =>
  vi.fn((_orgId: string, _options?: { readonly enabled?: boolean }) => ({
    canManage: false,
    canContribute: false,
  })),
);
vi.mock('@/components/settings/use-can-manage-org', () => ({ useCanManageOrg: canManage }));

vi.mock('@/components/pickers/future-cycle-picker', () => ({
  FutureCyclePicker: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button type="button" aria-label="Cycle — not set" className={triggerClassName}>
      Set cycle
    </button>
  ),
}));

beforeEach(() => {
  mockWideMetadataRow();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A minimal-but-complete task detail; `overrides` swaps only what a case is about. */
function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: '01HZZZ00000000000000000TSK',
    organizationId: '01HZZZ00000000000000000ORG',
    title: 'Ship the roster',
    teamId: '01HZZZ0000000000000000TEAM',
    state: 'todo',
    priority: 'high',
    provenance: { source: 'native' },
    createdAt: '2026-08-01T09:00:00.000Z',
    labels: [],
    blocking: [],
    blockedBy: [],
    subtasks: [],
    ...overrides,
  } as TaskDetail;
}

/** A model over `task`, with every write observable; `overrides` replaces any field. */
function modelFor(overrides: Partial<TaskPropertyModel> = {}): TaskPropertyModel {
  const subject = overrides.task ?? task();
  return {
    task: subject,
    canEdit: true,
    workflowStates: DEFAULT_WORKFLOW_STATES,
    statusPending: false,
    priorityPending: false,
    onSetState: vi.fn(),
    onSetPriority: vi.fn(),
    onPatch: vi.fn(),
    memberOptions: [{ value: 'actor_ada', label: 'Ada Lovelace' }],
    membersLoading: false,
    onMembersOpenChange: vi.fn(),
    projectLabel: 'Project',
    projectOptions: [{ value: 'project_1', label: 'Launch' }],
    projectLoading: false,
    onProjectOpenChange: vi.fn(),
    secondary: {
      programLabel: 'Program',
      cycleLabel: 'Cycle',
      programOptions: [],
      milestoneOptions: [],
      labelOptions: [],
      onCreateLabel: vi.fn(),
      estimationScale: 'fibonacci',
    },
    ...overrides,
  };
}

/** Render the row; returns each chip's declared priority. */
function renderChips(
  model: TaskPropertyModel,
  withAside = false,
): { readonly priorities: readonly number[] } {
  const { wrapper } = makeQueryWrapper();
  const row = <TaskMetadataRow model={model} />;
  render(
    withAside ? (
      // A layout that holds an aside docks it on a wide pane and tells its slots so.
      <EntityDetailLayout
        icon={<span>icon</span>}
        title="Ship it"
        tabs={<div>tabs</div>}
        metadata={row}
        aside={<div>aside</div>}
      >
        <div>body</div>
      </EntityDetailLayout>
    ) : (
      row
    ),
    // The assignee picker creates people and the parent picker searches, both through a query client.
    { wrapper },
  );
  const items = [
    ...document.querySelectorAll('[data-entity-metadata-inline] [data-entity-metadata-item]'),
  ];
  return {
    priorities: items.map((item) => Number(item.getAttribute('data-entity-metadata-priority'))),
  };
}

describe('TaskMetadataRow', () => {
  it('leads with status and priority, then assignee, project, and due date, then the secondary set', () => {
    const { priorities } = renderChips(modelFor());

    // Status, priority, assignee, project, due; then estimate, labels, cycle; then the overflow-only
    // set (milestone, program, start, created, parent).
    expect(priorities.slice(0, 5)).toEqual([0, 0, 1, 2, 3]);
    expect(priorities.slice(5)).toEqual([4, 5, 6, 7, 7, 7, 7, 7]);
  });

  it('states each lead property as its own labelled control', () => {
    renderChips(modelFor({ task: task({ dueDate: '2026-10-01', priority: 'urgent' }) }));

    expect(screen.getByRole('button', { name: /^Status —/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Priority — Urgent' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Assignee —/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Project —/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Due — Oct 1, 2026' })).toBeVisible();
  });

  it('renders no chips at all when the layout has docked its sidebar, which holds every property', () => {
    const { priorities } = renderChips(modelFor(), true);

    expect(priorities).toEqual([]);
    expect(screen.queryByRole('group', { name: 'Task properties' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Status —/ })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
  });

  it('carries every property in the row when the pane is too narrow to dock the sidebar', () => {
    vi.restoreAllMocks();
    mockWideMetadataRow(800);
    const { priorities } = renderChips(modelFor(), true);

    expect(priorities).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7]);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('writes a status choice through the model', async () => {
    const model = modelFor();
    renderChips(model);

    fireEvent.pointerDown(screen.getByRole('button', { name: /^Status —/ }), {
      button: 0,
      ctrlKey: false,
    });
    const started = DEFAULT_WORKFLOW_STATES.find((state) => state.type === 'started');
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(started?.name ?? '') }));

    expect(model.onSetState).toHaveBeenCalledWith(started?.key);
  });

  it('patches the project and the due date it is given', async () => {
    const model = modelFor({ task: task({ dueDate: '2026-10-01' }) });
    renderChips(model);

    fireEvent.click(screen.getByRole('button', { name: /^Project —/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Launch/ }));
    expect(model.onPatch).toHaveBeenCalledWith({ projectId: 'project_1' });

    fireEvent.click(screen.getByRole('button', { name: /^Due —/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(model.onPatch).toHaveBeenCalledWith({ dueDate: null });
  });

  it('starts the member roster when the assignee picker opens', () => {
    const model = modelFor();
    renderChips(model);

    fireEvent.click(screen.getByRole('button', { name: /^Assignee —/ }));

    expect(model.onMembersOpenChange).toHaveBeenCalledWith(true);
  });

  it('leaves the roster and roles unread until the assignee picker opens', () => {
    canManage.mockClear();
    renderChips(modelFor());

    // The picker's create permission reads the same roster the model defers, so it stays off at mount.
    expect(canManage).toHaveBeenCalled();
    expect(canManage.mock.calls.every(([, options]) => options?.enabled === false)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^Assignee —/ }));

    expect(canManage).toHaveBeenLastCalledWith(expect.any(String), { enabled: true });
  });

  it('shows every lead property as read-only when the viewer cannot edit', () => {
    renderChips(modelFor({ canEdit: false, task: task({ dueDate: '2026-10-01' }) }));

    expect(screen.getByRole('button', { name: /^Status —/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Priority — High' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Due —/ })).not.toBeInTheDocument();
  });
});
