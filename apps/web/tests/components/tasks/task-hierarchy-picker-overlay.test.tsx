/** `@docket/web` — searchable task parent picker behavior. */
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskHierarchyPickerOverlay } from '@/components/tasks/task-hierarchy-picker-overlay';
import { makeQueryWrapper, okResponse, problemResponse } from '../../support/query';

const { TASKS_GET, PROJECTS_GET, TEAMS_GET, REPARENT } = vi.hoisted(() => ({
  TASKS_GET: vi.fn(),
  PROJECTS_GET: vi.fn(),
  TEAMS_GET: vi.fn(),
  REPARENT: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          tasks: { $get: TASKS_GET },
          projects: { $get: PROJECTS_GET },
          teams: { $get: TEAMS_GET },
        },
      },
    },
  },
}));

vi.mock('@/components/tasks/use-task-hierarchy-mutation', () => ({
  useTaskHierarchyMutation: () => ({
    reparent: REPARENT,
    isPending: false,
    error: null,
    clearError: vi.fn(),
    undo: null,
  }),
}));

const ORG = 'org_1';
const SUBJECT = { kind: 'task' as const, id: 'a', organizationId: ORG, title: 'Alpha' };

beforeEach(() => {
  vi.clearAllMocks();
  TASKS_GET.mockResolvedValue(
    okResponse({
      items: [
        { id: 'a', title: 'Alpha', parentTaskId: null, projectId: null, teamId: 'team-1' },
        { id: 'b', title: 'Bravo child', parentTaskId: 'a', projectId: null, teamId: 'team-1' },
        {
          id: 'c',
          title: 'Charlie launch',
          parentTaskId: null,
          projectId: 'project-1',
          teamId: 'team-2',
        },
        {
          id: 'd',
          title: 'Delta operations',
          parentTaskId: null,
          projectId: null,
          teamId: 'team-1',
        },
      ],
    }),
  );
  PROJECTS_GET.mockResolvedValue(okResponse({ items: [{ id: 'project-1', name: 'Launch' }] }));
  TEAMS_GET.mockResolvedValue(
    okResponse({
      items: [
        { id: 'team-1', name: 'Core' },
        { id: 'team-2', name: 'Growth' },
      ],
    }),
  );
});

afterEach(() => {
  document.querySelectorAll('[data-test-hierarchy-anchor]').forEach((element) => {
    element.remove();
  });
});

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof TaskHierarchyPickerOverlay>> = {},
) {
  const anchor = document.createElement('button');
  anchor.textContent = 'Open hierarchy';
  anchor.dataset['testHierarchyAnchor'] = 'true';
  document.body.append(anchor);
  anchor.focus();
  const onClose = vi.fn();
  const { wrapper } = makeQueryWrapper();
  const rendered = render(
    <TaskHierarchyPickerOverlay
      request={{ kind: 'task-hierarchy', organizationId: ORG, subjects: [SUBJECT], anchor }}
      onClose={onClose}
      {...overrides}
    />,
    { wrapper },
  );
  return { ...rendered, anchor, onClose };
}

describe('TaskHierarchyPickerOverlay', () => {
  it('shows same-workspace candidates with project and team context, excluding the moved subtree', async () => {
    renderPicker();

    expect(await screen.findByRole('option', { name: /Charlie launch/ })).toHaveTextContent(
      'Launch · Growth',
    );
    expect(screen.getByRole('option', { name: /Delta operations/ })).toHaveTextContent('Core');
    expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Bravo child/ })).not.toBeInTheDocument();
  });

  it('searches task titles and immediately dispatches the complete selected set', async () => {
    const second = {
      kind: 'task' as const,
      id: 'd',
      organizationId: ORG,
      title: 'Delta operations',
    };
    const { onClose } = renderPicker({
      request: {
        kind: 'task-hierarchy',
        organizationId: ORG,
        subjects: [SUBJECT, second],
      },
    });
    const search = await screen.findByPlaceholderText('Move 2 tasks under…');
    fireEvent.change(search, { target: { value: 'charlie' } });

    fireEvent.click(
      within(screen.getByRole('option', { name: /Charlie launch/ })).getByRole('button'),
    );

    expect(REPARENT).toHaveBeenCalledWith({
      organizationId: ORG,
      moves: [
        { taskId: 'a', parentTaskId: 'c' },
        { taskId: 'd', parentTaskId: 'c' },
      ],
      preserveSelectedSubtrees: true,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders application-owned read errors', async () => {
    TASKS_GET.mockResolvedValue(problemResponse('database table task leaked'));
    renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load tasks.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('database table task leaked');
  });

  it('restores focus to the invoking control when dismissed', async () => {
    const { anchor, onClose, unmount } = renderPicker();
    await screen.findByRole('option', { name: /Charlie launch/ });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    unmount();
    expect(anchor).toHaveFocus();
  });
});
