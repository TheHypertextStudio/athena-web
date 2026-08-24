import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const wiring = vi.hoisted(() => ({
  canEdit: true,
  canvasProps: null as null | Record<string, unknown>,
  commandProviderProps: null as null | Record<string, unknown>,
  actions: null as null | Record<string, unknown>,
  openCreate: vi.fn(),
  routerPush: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  history: {
    execute: vi.fn().mockResolvedValue({
      appliedIds: [],
      conflictingIds: [],
      deniedIds: [],
      receipt: {
        commandId: 'receipt',
        objectKind: 'task',
        action: 'replace_property',
        entries: [],
      },
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    undoLabel: 'Change task hierarchy',
    redoLabel: 'Change status',
    pending: false,
    notice: null,
    clearNotice: vi.fn(),
  },
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../src/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ push: wiring.routerPush }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: wiring.invalidateQueries }),
}));
vi.mock('../../../src/lib/app-location', () => ({ useAppPathname: () => '/orgs/org-1/graph' }));
vi.mock('../../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: wiring.openCreate }),
}));
vi.mock('../../../src/lib/query', () => ({
  apiQueryOptions: () => ({}),
  queryKeys: {
    members: () => ['members'],
    agents: () => ['agents'],
    projects: () => ['projects'],
    roles: () => ['roles'],
    teams: () => ['teams'],
    milestones: () => ['milestones'],
    taskGraph: () => ['task-graph'],
    tasks: () => ['tasks'],
  },
  useApiListQuery: () => ({ data: { items: [] }, isPending: false }),
}));
vi.mock('../../../src/lib/use-org-capability', () => ({
  useOrgCapability: () => wiring.canEdit,
}));
vi.mock('../../../src/components/statuses/status-registry', () => ({
  useStatusRegistry: () => ({
    firstOfCategory: () => ({ key: 'done' }),
    defaultOf: () => ({ key: 'todo' }),
  }),
}));
vi.mock('../../../src/components/canvas/use-task-graph', () => ({
  useTaskGraph: () => ({ nodes: [], edges: [], isLoading: false, error: null, isEmpty: true }),
}));
vi.mock('../../../src/components/canvas/use-task-graph-creation', () => ({
  useTaskGraphCreation: () => ({
    createSubtask: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}));
vi.mock('../../../src/components/canvas/task-hierarchy-layout', () => ({
  retainTaskHierarchyAncestors: (nodes: unknown[]) => nodes,
  useTaskHierarchyLayout: (nodes: unknown[]) => nodes,
}));
vi.mock('../../../src/components/canvas/use-canvas-aspect-ratio', () => ({
  useCanvasAspectRatio: () => ({ containerRef: { current: null }, aspectRatio: 1, ready: true }),
}));
vi.mock('../../../src/components/canvas/canvas', () => ({
  default: (props: { minimap: boolean; children: ReactNode }) => {
    wiring.canvasProps = props;
    return (
      <div data-testid="task-canvas" data-minimap={String(props.minimap)}>
        {props.children}
      </div>
    );
  },
}));
vi.mock('../../../src/components/canvas/canvas-command-context', () => ({
  CanvasCommandProvider: (props: { children: ReactNode }) => {
    wiring.commandProviderProps = props;
    return <>{props.children}</>;
  },
  CanvasCommandProviderWithHistory: (props: { children: ReactNode }) => {
    wiring.commandProviderProps = props;
    return <>{props.children}</>;
  },
}));
vi.mock('../../../src/components/canvas/use-canvas-command-history', () => ({
  canvasCommandId: () => `command-${String(wiring.history.execute.mock.calls.length + 1)}`,
  useCanvasCommandHistory: () => wiring.history,
}));
vi.mock('../../../src/components/canvas/canvas-selection-frame', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../../src/components/canvas/canvas-actions-context', () => ({
  CanvasActionsProvider: ({
    children,
    value,
  }: {
    children: ReactNode;
    value: Record<string, unknown>;
  }) => {
    wiring.actions = value;
    return <>{children}</>;
  },
}));
vi.mock('../../../src/components/canvas/canvas-selection-bridge', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/bulk-actions-bar', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/canvas-command-notice', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/canvas-created-hidden-notice', () => ({
  default: (props: {
    message?: string;
    actionLabel?: string;
    onAction?: () => void;
    onClearFilters?: () => void;
  }) => (
    <div role="status">
      {props.message ?? 'Created, but hidden by current filters'}
      <button type="button" onClick={props.onAction ?? props.onClearFilters}>
        {props.actionLabel ?? 'Clear filters'}
      </button>
    </div>
  ),
}));
vi.mock('../../../src/components/canvas/graph-view-bar', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/group-node', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/task-node', () => ({
  default: () => null,
  taskData: (node: { data: unknown }) => node.data,
}));
vi.mock('../../../src/components/canvas/task-branch-node', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/dependency-edge', () => ({ default: () => null }));

import { DEFAULT_GRAPH_DISPLAY } from '../../../src/components/canvas/graph-display';
import TaskGraphPanel from '../../../src/components/canvas/task-graph-panel';

describe('focused Task graph navigation', () => {
  it('keeps the minimap mounted when the saved display setting is off', () => {
    render(
      <TaskGraphPanel
        scope={{ orgId: 'org-1' }}
        density="full"
        display={{ ...DEFAULT_GRAPH_DISPLAY, minimap: false }}
        renderChrome={(bar) => <header>{bar}</header>}
      />,
    );

    expect(screen.getByTestId('task-canvas')).toHaveAttribute('data-minimap', 'true');
  });

  it('routes dependency, status, hierarchy, and reverse edits through one command history', async () => {
    wiring.canEdit = true;
    wiring.history.execute.mockClear();
    const panel = () => (
      <TaskGraphPanel
        scope={{ orgId: 'org-1' }}
        density="full"
        display={DEFAULT_GRAPH_DISPLAY}
        renderChrome={(bar) => <header>{bar}</header>}
      />
    );
    const rendered = render(panel());
    const canvas = wiring.canvasProps as {
      onConnectEdge: (source: string, target: string) => void;
      onDeleteEdge: (edge: { source: string; target: string }) => void;
      onReparentEdge: (childId: string, parentId: string) => void;
    };
    const actions = wiring.actions as {
      setComplete: (id: string, complete: boolean) => void;
    };

    canvas.onConnectEdge('task-a', 'task-b');
    canvas.onDeleteEdge({ source: 'task-a', target: 'task-b' });
    actions.setComplete('task-a', true);
    canvas.onReparentEdge('task-a', 'task-parent');

    await waitFor(() => {
      expect(wiring.history.execute.mock.calls.map(([command]) => command.operation)).toEqual([
        { type: 'add_dependency', blockingId: 'task-a', blockedId: 'task-b' },
        { type: 'remove_dependency', blockingId: 'task-a', blockedId: 'task-b' },
        { type: 'replace_property', property: 'state', value: 'done' },
        { type: 'change_parent', parentId: 'task-parent' },
      ]);
    });
    expect(wiring.actions).not.toHaveProperty('reverseDependency');
    expect(wiring.canvasProps).not.toHaveProperty('onReverseDependency');
    expect(wiring.commandProviderProps?.['history']).toBe(wiring.history);

    wiring.canEdit = false;
    rendered.rerender(panel());
    expect(wiring.commandProviderProps).toMatchObject({
      canEdit: false,
      history: wiring.history,
    });
  });

  it('keeps a Project-scoped graph mounted when the composer creates a Task outside its scope', async () => {
    wiring.openCreate.mockClear();
    wiring.routerPush.mockClear();
    wiring.invalidateQueries.mockClear();
    render(
      <TaskGraphPanel
        scope={{ orgId: 'org-1', projectId: 'project-current' }}
        density="full"
        display={DEFAULT_GRAPH_DISPLAY}
        renderChrome={(bar) => <header>{bar}</header>}
      />,
    );

    act(() => {
      (wiring.commandProviderProps?.['onCreateObject'] as () => void)();
    });
    const request = wiring.openCreate.mock.calls[0]?.[0] as {
      defaultProjectId?: string;
      sameWorkspaceCompletion: string;
      onCreated: (created: { id: string; projectId?: string | null }) => void;
    };
    expect(request).toMatchObject({
      defaultProjectId: 'project-current',
      sameWorkspaceCompletion: 'stay',
    });

    act(() => {
      request.onCreated({ id: 'task-created', projectId: 'project-other' });
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Created, but outside this Project',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Task' }));
    expect(wiring.routerPush).toHaveBeenCalledWith('/orgs/org-1/tasks/task-created');
    expect(screen.getByTestId('task-canvas')).toBeInTheDocument();
  });
});
