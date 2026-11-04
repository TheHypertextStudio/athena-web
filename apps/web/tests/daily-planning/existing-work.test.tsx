import { renderPlanning as render } from './render';
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';
import { AddWorkStage } from '../../src/components/daily-planning/daily-planning-add';

const openCreate = vi.hoisted(() => vi.fn());
vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate }),
}));
beforeEach(() => {
  openCreate.mockReset();
});
afterEach(cleanup);
function plan() {
  const items = ['Prepare community meeting', 'Review transit proposal'].map((title, i) => ({
    id: `task-${i}`,
    entityId: `task-${i}`,
    kind: 'task',
    organizationId: 'org',
    organizationName: 'Community',
    title,
    projectName: 'Better streets',
    priority: 'high',
    dueAt: null,
    estimateMinutes: 30,
  }));
  return {
    draft: { tasks: [], sessions: [] },
    search: '',
    setSearch: vi.fn(),
    workScope: 'mine',
    setWorkScope: vi.fn(),
    workOrganization: '',
    setWorkOrganization: vi.fn(),
    dueOnly: false,
    setDueOnly: vi.fn(),
    searchQ: {
      data: { items, pages: [{ items, workspaces: [{ id: 'org', name: 'Community' }] }] },
      hasNextPage: true,
      fetchNextPage: vi.fn(),
      isPending: false,
      isError: false,
    },
    addTasks: vi.fn(),
    addTask: vi.fn(),
    go: vi.fn(),
  } as unknown as ReadyPlanningController;
}

it('adds several existing tasks in one action without losing the selection or calendar context', async () => {
  const controller = plan();
  render(<AddWorkStage plan={controller} />);
  await userEvent.click(screen.getByRole('button', { name: 'More task actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Select tasks' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select Prepare community meeting' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Select Review transit proposal' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add 2 tasks to plan' }));
  expect(controller.addTasks).toHaveBeenCalledWith([
    {
      taskId: 'task-0',
      organizationId: 'org',
      title: 'Prepare community meeting',
      plannedMinutes: 30,
    },
    {
      taskId: 'task-1',
      organizationId: 'org',
      title: 'Review transit proposal',
      plannedMinutes: 30,
    },
  ]);
  expect(screen.getByRole('searchbox', { name: 'Search existing tasks' })).toHaveValue('');
});

it('offers continuation beyond the first page and explicit responsibility filters', async () => {
  const controller = plan();
  render(<AddWorkStage plan={controller} />);
  await userEvent.click(screen.getByRole('button', { name: 'Load more tasks' }));
  expect(controller.searchQ.fetchNextPage).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
  await userEvent.selectOptions(screen.getByLabelText('Task scope'), 'created');
  expect(controller.setWorkScope).toHaveBeenCalledWith('created');
  expect(screen.getAllByText(/Community/).length).toBeGreaterThan(0);
});

it('opens the normal task composer from the task actions menu', async () => {
  render(<AddWorkStage plan={plan()} />);
  await userEvent.click(screen.getByRole('button', { name: 'More task actions' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'New task' }));
  expect(openCreate).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'task' }),
    expect.any(HTMLButtonElement),
  );
});
