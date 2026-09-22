/**
 * The Subtasks and Relations sections: what a person can add, attach, link, and remove.
 *
 * @remarks
 * The task search is replaced by a stand-in that offers one fixed task, so these tests are about
 * the sections: which search opens and what a choice writes. What the search offers is covered by
 * `task-search-popover.test.tsx`.
 */
import '@testing-library/jest-dom/vitest';

import { TaskId } from '@docket/work/ids';
import type { TaskDetail, TaskRef } from '@docket/work/task-model';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskSearchPopoverProps } from '../../src/components/task-detail/task-search-popover';
import { stubRelations } from '../support/task-relations';

const PICKED: TaskRef = {
  id: TaskId.parse('01BX5ZZKBKACTAV9WEVGEMMVP1'),
  title: 'Picked task',
  state: 'todo',
};

vi.mock('../../src/components/task-detail/task-search-popover', async () => {
  const { useTaskRelationControls } =
    await import('../../src/components/task-detail/task-relation-commands');
  return {
    TaskSearchPopover: ({ links, anchor, children }: TaskSearchPopoverProps): JSX.Element => {
      const { writes, active, setActive } = useTaskRelationControls();
      const link = links.find((kind) => kind === active);
      const opener =
        anchor === 'trigger' ? (
          <span
            onClickCapture={() => {
              setActive(links[0]);
            }}
          >
            {children}
          </span>
        ) : (
          children
        );
      return (
        <>
          {opener}
          {link ? (
            <div role="dialog" aria-label={`Search: ${link}`}>
              <button
                type="button"
                onClick={() => {
                  writes.link(link, PICKED);
                  setActive(null);
                }}
              >
                {PICKED.title}
              </button>
            </div>
          ) : null}
        </>
      );
    },
  };
});
vi.mock('../../src/components/tasks/task-hierarchy-drop', () => ({
  useTaskHierarchyDrop: () => ({
    rowProps: { ref: () => undefined, 'data-drop-state': 'idle', className: '' },
    className: '',
    status: null,
  }),
}));
vi.mock('../../src/lib/interactions/navigation', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAppRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactElement }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { Subtasks } = await import('../../src/components/task-detail/Subtasks');
const { TaskRelations } = await import('../../src/components/task-detail/task-relations');
const { TaskRelationsProvider } =
  await import('../../src/components/task-detail/task-relation-commands');

afterEach(() => {
  cleanup();
});

function ref(suffix: string, title: string, state = 'todo'): TaskRef {
  return { id: TaskId.parse(`01BX5ZZKBKACTAV9WEVGEMMV${suffix}`), title, state };
}

const DONE = ref('S1', 'Collect quotes', 'done');
const OPEN = ref('S2', 'Book the venue');
const BLOCKER = { ...ref('R1', 'Write the brief'), projectId: null };
const ELSEWHERE = {
  ...ref('R2', 'Order signage'),
  projectId: '01BX5ZZKBKACTAV9WEVGEMMVJ2',
} as TaskRef;

/** A task with the given links; `overrides` swaps only what a case is about. */
function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: '01BX5ZZKBKACTAV9WEVGEMMVT0',
    organizationId: 'org_1',
    title: 'Plan the launch',
    projectId: '01BX5ZZKBKACTAV9WEVGEMMVJ1',
    parentTaskId: null,
    subtasks: [DONE, OPEN],
    blockedBy: [BLOCKER],
    blocking: [],
    relatedTasks: [ELSEWHERE],
    ...overrides,
  } as TaskDetail;
}

function renderSubtasks(
  options: { task?: TaskDetail; canEdit?: boolean; onAdd?: () => Promise<void> } = {},
) {
  const relations = stubRelations();
  const mutations = {
    addSubtask: vi.fn(options.onAdd ?? (() => Promise.resolve())),
    toggleSubtask: vi.fn(() => Promise.resolve()),
  };
  render(
    <TaskRelationsProvider writes={relations}>
      <Subtasks
        task={options.task ?? task()}
        mutations={mutations}
        canEdit={options.canEdit ?? true}
      />
    </TaskRelationsProvider>,
  );
  return { relations, mutations };
}

describe('Subtasks', () => {
  it('counts finished subtasks against the total', () => {
    renderSubtasks();

    const section = screen.getByRole('region', { name: /Subtasks/ });
    expect(within(section).getByText('1/2')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows only its heading and add actions when there are none', () => {
    renderSubtasks({ task: task({ subtasks: [] }) });

    const section = screen.getByRole('region', { name: /Subtasks/ });
    expect(within(section).queryByRole('list')).not.toBeInTheDocument();
    expect(within(section).queryByRole('paragraph')).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add subtask' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add existing task' })).toBeInTheDocument();
  });

  it('adds subtasks one after another from an inline row, and closes on Escape', async () => {
    const { mutations } = renderSubtasks();

    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));
    const field = screen.getByRole('textbox', { name: 'New subtask title' });
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: 'Print badges' } });
    fireEvent.submit(field);
    await waitFor(() => {
      expect(mutations.addSubtask).toHaveBeenCalledWith('Print badges');
    });
    // Still open, and empty, for the next one.
    expect(screen.getByRole('textbox', { name: 'New subtask title' })).toHaveValue('');

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New subtask title' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('textbox', { name: 'New subtask title' })).not.toBeInTheDocument();
  });

  it('keeps the typed title when the create fails', async () => {
    renderSubtasks({ onAdd: () => Promise.reject(new Error('refused')) });

    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));
    const field = screen.getByRole('textbox', { name: 'New subtask title' });
    fireEvent.change(field, { target: { value: 'Print badges' } });
    fireEvent.submit(field);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'New subtask title' })).toHaveValue(
        'Print badges',
      );
    });
  });

  it('attaches an existing task as a subtask', () => {
    const { relations } = renderSubtasks();

    fireEvent.click(screen.getByRole('button', { name: 'Add existing task' }));
    fireEvent.click(screen.getByRole('button', { name: PICKED.title }));

    expect(relations.link).toHaveBeenCalledWith('subtask', PICKED);
  });

  it('detaches a subtask and toggles one done', () => {
    const { relations, mutations } = renderSubtasks();

    fireEvent.click(screen.getByRole('button', { name: `Remove from subtasks: ${OPEN.title}` }));
    expect(relations.unlink).toHaveBeenCalledWith('subtask', OPEN.id);

    fireEvent.click(screen.getByRole('button', { name: `Mark “${OPEN.title}” as done` }));
    expect(mutations.toggleSubtask).toHaveBeenCalledWith(OPEN.id, true);
  });

  it('links every row to its task, as one segment of a tonal list', () => {
    renderSubtasks();

    const link = screen.getByRole('link', { name: OPEN.title });
    expect(link).toHaveAttribute('href', `/orgs/org_1/tasks/${OPEN.id}`);
    expect(link.closest('li')).toHaveAttribute('data-surface-tone', 'card');
  });

  it('offers no way to change anything to a viewer who cannot edit', () => {
    renderSubtasks({ canEdit: false });

    expect(screen.queryByRole('button', { name: 'Add subtask' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove from subtasks/ })).not.toBeInTheDocument();
  });
});

function renderRelations(options: { task?: TaskDetail; canEdit?: boolean } = {}) {
  const relations = stubRelations();
  render(
    <TaskRelationsProvider writes={relations}>
      <TaskRelations
        task={options.task ?? task()}
        projectName={() => 'Signage'}
        canEdit={options.canEdit ?? true}
      />
    </TaskRelationsProvider>,
  );
  return { relations };
}

/** Choose one entry of the section's `+` menu. */
async function chooseFromMenu(name: string): Promise<void> {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add relation' }), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

describe('TaskRelations', () => {
  it('shows only the groups that have links, each named', () => {
    renderRelations();

    expect(screen.getByRole('group', { name: 'Blocked by' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Related' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Blocking' })).not.toBeInTheDocument();
  });

  it('shows only its heading and its add action when the task has no links', () => {
    renderRelations({ task: task({ blockedBy: [], relatedTasks: [] }) });

    const section = screen.getByRole('region', { name: /Relations/ });
    expect(within(section).queryByRole('group')).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add relation' })).toBeInTheDocument();
  });

  it('names a linked task’s project only when it is not this task’s', () => {
    renderRelations();

    const related = screen.getByRole('group', { name: 'Related' });
    expect(within(related).getByText('Signage')).toBeInTheDocument();
    const blockedBy = screen.getByRole('group', { name: 'Blocked by' });
    expect(within(blockedBy).queryByText('Signage')).not.toBeInTheDocument();
  });

  it.each([
    ['Add blocker', 'blockedBy'],
    ['Add blocked task', 'blocking'],
    ['Add related task', 'related'],
  ] as const)('%s searches for a task and links it as %s', async (menu, kind) => {
    const { relations } = renderRelations();

    await chooseFromMenu(menu);
    fireEvent.click(await screen.findByRole('button', { name: PICKED.title }));

    expect(relations.link).toHaveBeenCalledWith(kind, PICKED);
  });

  it('removes a link, never the task', () => {
    const { relations } = renderRelations();

    fireEvent.click(screen.getByRole('button', { name: `Remove blocker: ${BLOCKER.title}` }));
    expect(relations.unlink).toHaveBeenCalledWith('blockedBy', BLOCKER.id);

    fireEvent.click(
      screen.getByRole('button', { name: `Remove related task: ${ELSEWHERE.title}` }),
    );
    expect(relations.unlink).toHaveBeenCalledWith('related', ELSEWHERE.id);
  });

  it('offers no way to change links to a viewer who cannot edit', () => {
    renderRelations({ canEdit: false });

    expect(screen.queryByRole('button', { name: 'Add relation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});
