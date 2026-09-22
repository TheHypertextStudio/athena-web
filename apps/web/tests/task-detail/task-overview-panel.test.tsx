/**
 * The task page's sections: the Overview reads like an issue, and heavy tabs mount only when open.
 *
 * @remarks
 * Every child is replaced by a marker, so these assertions are about arrangement alone: what comes
 * first, what comes last, and which sections exist for which tab.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskDetail } from '@docket/work/task-model';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskSectionsProps } from '../../src/components/task-detail/task-sections';

const mounted = vi.hoisted(() => ({ graph: vi.fn(), resources: vi.fn() }));

vi.mock('../../src/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../src/lib/use-rename-task', () => ({ useRenameTask: () => vi.fn() }));
vi.mock('../../src/components/task-detail/task-details', () => ({
  TaskDetails: () => <div data-testid="description" />,
}));
vi.mock('../../src/components/recurrence/repeating-work-backlink', () => ({
  TaskRepeatingWorkBacklink: () => <div data-testid="backlink" />,
}));
vi.mock('../../src/components/task-detail/Subtasks', () => ({
  Subtasks: () => <div data-testid="subtasks" />,
}));
vi.mock('../../src/components/task-detail/task-relations', () => ({
  TaskRelations: () => <div data-testid="relations" />,
}));
vi.mock('../../src/lib/use-task-relations', () => ({
  useTaskRelations: () => ({
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    addRelated: vi.fn(),
    removeRelated: vi.fn(),
    attachSubtask: vi.fn(),
    detachSubtask: vi.fn(),
    setParent: vi.fn(),
    pending: false,
  }),
}));
vi.mock('../../src/components/task-detail/task-activity-feed', () => ({
  TaskActivityFeed: () => <div data-testid="activity" />,
}));
vi.mock('../../src/components/task-detail/task-resources-panel', () => ({
  TaskResourcesPanel: () => {
    mounted.resources();
    return <div data-testid="resources" />;
  },
}));
vi.mock('../../src/components/canvas/task-graph-panel', () => ({
  default: (props: { readonly density?: string }) => {
    mounted.graph(props);
    return <div data-testid="graph" data-density={props.density} />;
  },
}));

const { TaskSections } = await import('../../src/components/task-detail/task-sections');

afterEach(() => {
  cleanup();
  mounted.graph.mockClear();
  mounted.resources.mockClear();
});

function task(): TaskDetail {
  return {
    id: 'task_1',
    organizationId: 'org_1',
    title: 'Ship it',
    teamId: 'team_1',
    state: 'todo',
    priority: 'none',
    provenance: { source: 'native' },
    createdAt: '2026-08-25T00:00:00.000Z',
    labels: [],
    blocking: [],
    blockedBy: [],
    subtasks: [],
    relatedTasks: [],
  } as unknown as TaskDetail;
}

function renderSections(tab: TaskSectionsProps['tab']): void {
  render(
    <TaskSections
      tab={tab}
      orgId="org_1"
      task={task()}
      detailKey={['task']}
      currentActorId={null}
      canEdit
      canComment
      mentions={{ external: [], entities: [], isPending: false }}
      projectName={() => 'Atlas'}
      mutations={{
        patchTask: vi.fn(),
        addSubtask: vi.fn(),
        toggleSubtask: vi.fn(),
        addComment: vi.fn(),
      }}
      expansion={{ pending: false, notice: null, undoToken: null, expand: vi.fn(), undo: vi.fn() }}
    />,
  );
}

describe('TaskSections overview', () => {
  it('orders the description, backlink, subtasks, relations, then activity last', () => {
    renderSections('overview');

    const order = ['description', 'backlink', 'subtasks', 'relations', 'activity'].map((id) =>
      screen.getByTestId(id),
    );
    for (const [index, element] of order.slice(1).entries()) {
      const previous = order[index];
      expect(previous?.compareDocumentPosition(element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('names the tab panel by its tab', () => {
    renderSections('overview');

    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-overview');
  });
});

describe('TaskSections graph', () => {
  it('mounts the graph only on the Graph tab, at full density on this task', () => {
    renderSections('overview');
    renderSections('resources');
    expect(mounted.graph).not.toHaveBeenCalled();
    cleanup();

    renderSections('graph');

    expect(screen.getByTestId('graph')).toHaveAttribute('data-density', 'full');
    expect(mounted.graph).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { orgId: 'org_1', rootTaskId: 'task_1', depth: 2 } }),
    );
    expect(screen.queryByTestId('description')).not.toBeInTheDocument();
  });

  it('mounts the resources panel only on the Resources tab', () => {
    renderSections('overview');
    expect(mounted.resources).not.toHaveBeenCalled();
    cleanup();

    renderSections('resources');

    expect(screen.getByTestId('resources')).toBeInTheDocument();
    expect(screen.queryByTestId('subtasks')).not.toBeInTheDocument();
  });
});
