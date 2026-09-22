/**
 * The task search every relationship control opens.
 *
 * @remarks
 * It reads the org search route for tasks only, never offers a task that cannot take the link, and
 * writes the chosen link itself, with enough of the task to show it on the page at once.
 */
import '@testing-library/jest-dom/vitest';

import { TaskId } from '@docket/work/ids';
import type { TaskDetail, TaskRef } from '@docket/work/task-model';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskLink } from '../../src/lib/use-task-relations';
import { okResponse, makeQueryWrapper } from '../support/query';
import { stubRelations } from '../support/task-relations';

const { searchGet } = vi.hoisted(() => ({ searchGet: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: { v1: { orgs: { ':orgId': { search: { $get: searchGet } } } } },
}));

const { TaskSearchPopover, excludedFor } =
  await import('../../src/components/task-detail/task-search-popover');
const { TaskRelationsProvider } =
  await import('../../src/components/task-detail/task-relation-commands');

const SELF = '01BX5ZZKBKACTAV9WEVGEMMVA0';
const OTHER = '01BX5ZZKBKACTAV9WEVGEMMVA1';
const PARENT = '01BX5ZZKBKACTAV9WEVGEMMVA2';
const PROJECT = '01BX5ZZKBKACTAV9WEVGEMMVJ1';

function ref(id: string, title: string): TaskRef {
  return { id: TaskId.parse(id), title, state: 'todo' };
}

function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: SELF,
    organizationId: 'org_1',
    title: 'This task',
    parentTaskId: null,
    subtasks: [],
    blockedBy: [],
    blocking: [],
    relatedTasks: [],
    ...overrides,
  } as TaskDetail;
}

function hit(entityId: string, title: string) {
  return { kind: 'task', entityId, title, facets: { state: 'todo', projectId: PROJECT } };
}

beforeEach(() => {
  searchGet.mockReset();
  searchGet.mockResolvedValue(
    okResponse({
      query: '',
      items: [hit(SELF, 'This task'), hit(OTHER, 'Book the venue')],
      facets: [],
    }),
  );
});

afterEach(() => {
  cleanup();
});

/** Render the search bound to `link`, opened by clicking its trigger. */
function openSearch(link: TaskLink, subject: TaskDetail = task()) {
  const relations = stubRelations();
  const { wrapper } = makeQueryWrapper();
  render(
    <TaskRelationsProvider writes={relations}>
      <TaskSearchPopover task={subject} links={[link]} anchor="trigger">
        <button type="button">Open</button>
      </TaskSearchPopover>
    </TaskRelationsProvider>,
    { wrapper },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return { relations };
}

describe('TaskSearchPopover', () => {
  it('searches tasks only, and never offers the task itself', async () => {
    openSearch('blockedBy');

    expect(await screen.findByRole('button', { name: /Book the venue/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /This task/ })).not.toBeInTheDocument();
    expect(searchGet).toHaveBeenCalledWith(
      expect.objectContaining({
        param: { orgId: 'org_1' },
        query: expect.objectContaining({ kinds: 'task' }),
      }),
    );
  });

  it('sends what is typed as the search term', async () => {
    openSearch('blockedBy');
    await screen.findByRole('button', { name: /Book the venue/ });

    fireEvent.change(screen.getByPlaceholderText('Find the task this one waits on…'), {
      target: { value: 'venue' },
    });

    await waitFor(() => {
      expect(searchGet).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: expect.objectContaining({ q: 'venue' }) }),
      );
    });
  });

  it('links the chosen task, with its title, state, and project, then closes', async () => {
    const { relations } = openSearch('related');

    fireEvent.click(await screen.findByRole('button', { name: /Book the venue/ }));

    expect(relations.link).toHaveBeenCalledWith('related', {
      id: OTHER,
      title: 'Book the venue',
      state: 'todo',
      projectId: PROJECT,
    });
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Related task' })).not.toBeInTheDocument();
    });
  });

  it('offers to move a subtask back to the top level from the parent search', async () => {
    const { relations } = openSearch('parent', task({ parentTaskId: TaskId.parse(PARENT) }));

    fireEvent.click(await screen.findByRole('button', { name: 'No parent' }));

    expect(relations.unlink).toHaveBeenCalledWith('parent', PARENT);
  });

  it('opens only the copy that was clicked when the same search is on the page twice', async () => {
    const { wrapper } = makeQueryWrapper();
    render(
      <TaskRelationsProvider writes={stubRelations()}>
        {['First', 'Second'].map((name) => (
          <TaskSearchPopover key={name} task={task()} links={['parent']} anchor="trigger">
            <button type="button">{name}</button>
          </TaskSearchPopover>
        ))}
      </TaskRelationsProvider>,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Second' }));

    expect(await screen.findAllByRole('listbox', { name: 'Parent task' })).toHaveLength(1);
  });
});

describe('excludedFor', () => {
  const linked = task({
    parentTaskId: TaskId.parse(PARENT),
    subtasks: [ref('01BX5ZZKBKACTAV9WEVGEMMVB1', 'Child')],
    blockedBy: [ref('01BX5ZZKBKACTAV9WEVGEMMVB2', 'Blocker')],
    blocking: [ref('01BX5ZZKBKACTAV9WEVGEMMVB3', 'Dependent')],
    relatedTasks: [ref('01BX5ZZKBKACTAV9WEVGEMMVB4', 'Related')],
  });

  it('leaves out every linked task for a dependency or relation, so no link doubles or loops', () => {
    for (const link of ['blockedBy', 'blocking', 'related'] as const) {
      expect([...excludedFor(linked, link)].sort()).toEqual(
        [
          SELF,
          '01BX5ZZKBKACTAV9WEVGEMMVB2',
          '01BX5ZZKBKACTAV9WEVGEMMVB3',
          '01BX5ZZKBKACTAV9WEVGEMMVB4',
        ].sort(),
      );
    }
  });

  it('leaves out the task, its parent, and its subtasks for the hierarchy', () => {
    for (const link of ['subtask', 'parent'] as const) {
      expect([...excludedFor(linked, link)].sort()).toEqual(
        [SELF, PARENT, '01BX5ZZKBKACTAV9WEVGEMMVB1'].sort(),
      );
    }
  });
});
