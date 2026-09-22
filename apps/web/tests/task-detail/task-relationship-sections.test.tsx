/**
 * The Subtasks and Relations sections: what a person can add, attach, link, and remove.
 *
 * @remarks
 * The task search itself is replaced by a stand-in that offers one fixed task, so these tests are
 * about the sections: which search opens, what it is told to leave out, and what a choice writes.
 * The search's own behavior is covered by `use-task-search-options.test.ts`.
 */
import '@testing-library/jest-dom/vitest';

import { TaskId } from '@docket/work/ids';
import type { TaskRef } from '@docket/work/task-model';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskSearchPopoverProps } from '../../src/components/task-detail/task-search-popover';

const PICKED: TaskRef = {
  id: TaskId.parse('01BX5ZZKBKACTAV9WEVGEMMVP1'),
  title: 'Picked task',
  state: 'todo',
};

const searches = vi.hoisted(() => ({ last: null as null | { exclude: ReadonlySet<string> } }));

vi.mock('../../src/components/task-detail/task-search-popover', () => ({
  TaskSearchPopover: ({
    open,
    children,
    exclude,
    onPick,
    onOpenChange,
    anchor,
    ariaLabel,
  }: TaskSearchPopoverProps): JSX.Element => {
    if (open) searches.last = { exclude };
    const opener =
      anchor === 'trigger' ? (
        <span
          onClickCapture={() => {
            onOpenChange(true);
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
        {open ? (
          <div role="dialog" aria-label={ariaLabel}>
            <button
              type="button"
              onClick={() => {
                onPick(PICKED);
                onOpenChange(false);
              }}
            >
              {PICKED.title}
            </button>
          </div>
        ) : null}
      </>
    );
  },
}));
vi.mock('../../src/components/tasks/task-hierarchy-drop', () => ({
  useTaskHierarchyDrop: () => ({
    rowProps: { ref: () => undefined, 'data-drop-state': 'idle', className: '' },
    className: '',
    status: null,
  }),
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
const { TaskRelationCommandsProvider } =
  await import('../../src/components/task-detail/task-relation-commands');

afterEach(() => {
  cleanup();
  searches.last = null;
});

function ref(suffix: string, title: string, state = 'todo'): TaskRef {
  return { id: TaskId.parse(`01BX5ZZKBKACTAV9WEVGEMMV${suffix}`), title, state };
}

const PARENT_ID = '01BX5ZZKBKACTAV9WEVGEMMVT0';
const DONE = ref('S1', 'Collect quotes', 'done');
const OPEN = ref('S2', 'Book the venue');

function renderSubtasks(overrides: Partial<Parameters<typeof Subtasks>[0]> = {}) {
  const props = {
    organizationId: 'org_1',
    parentTaskId: PARENT_ID,
    ineligibleIds: new Set([PARENT_ID]),
    subtasks: [DONE, OPEN],
    onAdd: vi.fn(() => Promise.resolve()),
    onAttach: vi.fn(),
    onDetach: vi.fn(),
    onToggle: vi.fn(() => Promise.resolve()),
    onOpen: vi.fn(),
    canEdit: true,
    ...overrides,
  };
  render(
    <TaskRelationCommandsProvider>
      <Subtasks {...props} />
    </TaskRelationCommandsProvider>,
  );
  return props;
}

describe('Subtasks', () => {
  it('counts finished subtasks against the total', () => {
    renderSubtasks();

    const section = screen.getByRole('region', { name: /Subtasks/ });
    expect(within(section).getByText('1/2')).toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows only its heading and add actions when there are none', () => {
    renderSubtasks({ subtasks: [] });

    const section = screen.getByRole('region', { name: /Subtasks/ });
    expect(within(section).queryByRole('list')).not.toBeInTheDocument();
    expect(within(section).queryByRole('paragraph')).not.toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add subtask' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Add existing task' })).toBeInTheDocument();
  });

  it('adds subtasks one after another from an inline row, and closes on Escape', async () => {
    const { onAdd } = renderSubtasks();

    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));
    const field = screen.getByRole('textbox', { name: 'New subtask title' });
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: 'Print badges' } });
    fireEvent.submit(field);
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('Print badges');
    });
    // Still open, and empty, for the next one.
    expect(screen.getByRole('textbox', { name: 'New subtask title' })).toHaveValue('');

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New subtask title' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('textbox', { name: 'New subtask title' })).not.toBeInTheDocument();
  });

  it('keeps the typed title when the create fails', async () => {
    const onAdd = vi.fn(() => Promise.reject(new Error('refused')));
    renderSubtasks({ onAdd });

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

  it('attaches an existing task, never offering this task or its current subtasks', () => {
    const { onAttach } = renderSubtasks();

    fireEvent.click(screen.getByRole('button', { name: 'Add existing task' }));
    expect([...(searches.last?.exclude ?? [])].sort()).toEqual(
      [PARENT_ID, DONE.id, OPEN.id].sort(),
    );
    fireEvent.click(screen.getByRole('button', { name: PICKED.title }));

    expect(onAttach).toHaveBeenCalledWith(PICKED);
  });

  it('detaches a subtask and toggles one done', () => {
    const { onDetach, onToggle } = renderSubtasks();

    fireEvent.click(screen.getByRole('button', { name: `Remove from subtasks: ${OPEN.title}` }));
    expect(onDetach).toHaveBeenCalledWith(OPEN.id);

    fireEvent.click(screen.getByRole('button', { name: `Mark “${OPEN.title}” as done` }));
    expect(onToggle).toHaveBeenCalledWith(OPEN, true);
  });

  it('links every row to its task', () => {
    renderSubtasks();

    expect(screen.getByRole('link', { name: OPEN.title })).toHaveAttribute(
      'href',
      `/orgs/org_1/tasks/${OPEN.id}`,
    );
  });

  it('offers no way to change anything to a viewer who cannot edit', () => {
    renderSubtasks({ canEdit: false });

    expect(screen.queryByRole('button', { name: 'Add subtask' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove from subtasks/ })).not.toBeInTheDocument();
  });
});

const TASK_ID = '01BX5ZZKBKACTAV9WEVGEMMVT9';
const BLOCKER = { ...ref('R1', 'Write the brief'), projectId: null };
const ELSEWHERE = {
  ...ref('R2', 'Order signage'),
  projectId: '01BX5ZZKBKACTAV9WEVGEMMVJ2',
} as TaskRef;

function renderRelations(overrides: Partial<Parameters<typeof TaskRelations>[0]> = {}) {
  const props = {
    orgId: 'org_1',
    taskId: TASK_ID,
    projectId: '01BX5ZZKBKACTAV9WEVGEMMVJ1',
    blockedBy: [BLOCKER],
    blocking: [],
    related: [ELSEWHERE],
    projectName: () => 'Signage',
    canEdit: true,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  render(
    <TaskRelationCommandsProvider>
      <TaskRelations {...props} />
    </TaskRelationCommandsProvider>,
  );
  return props;
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
    renderRelations({ blockedBy: [], related: [] });

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
  ] as const)('%s searches for a task and adds it as %s', async (menu, kind) => {
    const { onAdd } = renderRelations();

    await chooseFromMenu(menu);
    fireEvent.click(await screen.findByRole('button', { name: PICKED.title }));

    expect(onAdd).toHaveBeenCalledWith(kind, PICKED);
  });

  it('never offers this task, or a task already linked to it in any way', async () => {
    renderRelations();

    await chooseFromMenu('Add blocked task');
    await screen.findByRole('button', { name: PICKED.title });

    // The blocker cannot also become a blocked task, and the related task is not offered twice.
    expect([...(searches.last?.exclude ?? [])].sort()).toEqual(
      [TASK_ID, BLOCKER.id, ELSEWHERE.id].sort(),
    );
  });

  it('removes a link, never the task', () => {
    const { onRemove } = renderRelations();

    fireEvent.click(screen.getByRole('button', { name: `Remove blocker: ${BLOCKER.title}` }));
    expect(onRemove).toHaveBeenCalledWith('blockedBy', BLOCKER.id);

    fireEvent.click(
      screen.getByRole('button', { name: `Remove related task: ${ELSEWHERE.title}` }),
    );
    expect(onRemove).toHaveBeenCalledWith('related', ELSEWHERE.id);
  });

  it('offers no way to change links to a viewer who cannot edit', () => {
    renderRelations({ canEdit: false });

    expect(screen.queryByRole('button', { name: 'Add relation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});
