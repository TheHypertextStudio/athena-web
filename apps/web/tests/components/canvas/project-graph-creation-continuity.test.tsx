import '@testing-library/jest-dom/vitest';

import type { ProjectOverviewItem } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { bridgeState, canvasState, commandState, fitView } = vi.hoisted(() => ({
  bridgeState: { props: null as null | Record<string, unknown> },
  canvasState: {
    onInit: null as null | ((instance: Record<string, unknown>) => void),
    props: null as null | Record<string, unknown>,
  },
  commandState: {
    providerProps: null as null | Record<string, unknown>,
    history: {
      execute: vi.fn().mockResolvedValue({
        appliedIds: [],
        conflictingIds: [],
        deniedIds: [],
        receipt: {
          commandId: 'receipt',
          objectKind: 'project',
          action: 'add_dependency',
          entries: [],
        },
      }),
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: true,
      canRedo: false,
      undoLabel: 'Add dependency',
      redoLabel: null,
      pending: false,
      notice: null,
      clearNotice: vi.fn(),
    },
  },
  fitView: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../src/lib/app-location', () => ({
  useAppPathname: () => '/orgs/org_1/projects',
}));

vi.mock('../../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => ({ openCreate: vi.fn(), closeCreate: vi.fn(), request: null }),
}));

vi.mock('../../../src/components/canvas/canvas-command-context', () => ({
  CanvasCommandProvider: (props: { children: ReactNode }) => {
    commandState.providerProps = props;
    return <>{props.children}</>;
  },
  CanvasCommandProviderWithHistory: (props: { children: ReactNode }) => {
    commandState.providerProps = props;
    return <>{props.children}</>;
  },
}));
vi.mock('../../../src/components/canvas/use-canvas-command-history', () => ({
  canvasCommandId: () =>
    `project-command-${String(commandState.history.execute.mock.calls.length + 1)}`,
  useCanvasCommandHistory: () => commandState.history,
}));

vi.mock('../../../src/components/canvas/canvas-selection-frame', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-selection-surface="project-graph:org_1">{children}</div>
  ),
}));

vi.mock('../../../src/components/canvas/canvas-selection-bridge', () => ({
  default: (props: Record<string, unknown>) => {
    bridgeState.props = props;
    return null;
  },
}));
vi.mock('../../../src/components/canvas/bulk-actions-bar', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/canvas-command-notice', () => ({ default: () => null }));

vi.mock('../../../src/components/canvas/canvas', () => ({
  default: (props: {
    children: ReactNode;
    nodes: readonly { id: string }[];
    onInit: (instance: Record<string, unknown>) => void;
  }) => {
    const { children, nodes, onInit } = props;
    canvasState.onInit = onInit;
    canvasState.props = props;
    return (
      <div data-testid="canvas">
        {nodes.map(({ id }) => (
          <div key={id} className="react-flow__node" data-id={id}>
            <button type="button" role="treeitem" data-object-id={id}>
              {id}
            </button>
          </div>
        ))}
        {children}
      </div>
    );
  },
}));

vi.mock('../../../src/components/canvas/project-graph-layout', () => ({
  useProjectGraphLayout: (nodes: readonly unknown[]) => ({ nodes }),
}));

vi.mock('../../../src/components/canvas/project-node', () => ({
  default: () => null,
}));

vi.mock('../../../src/components/canvas/project-peek', () => ({
  default: ({ project }: { project: ProjectOverviewItem }) => (
    <aside aria-label="Project details">{project.name}</aside>
  ),
}));

vi.mock('../../../src/components/canvas/use-canvas-aspect-ratio', () => ({
  useCanvasAspectRatio: () => ({ containerRef: { current: null }, aspectRatio: 1, ready: true }),
}));

vi.mock('../../../src/lib/query', () => ({
  apiQueryOptions: () => ({}),
  queryKeys: {
    projects: (orgId: string) => ['orgs', orgId, 'projects'],
    members: (orgId: string) => ['orgs', orgId, 'members'],
    roles: (orgId: string) => ['orgs', orgId, 'roles'],
  },
  unwrap: vi.fn(),
  useApiListQuery: () => ({ data: { items: [] } }),
  useApiMutation: () => ({ error: null, mutate: vi.fn(), reset: vi.fn() }),
}));

vi.mock('../../../src/lib/use-org-capability', () => ({
  useOrgCapability: (_members: unknown, _roles: unknown, capability: string) =>
    capability === 'contribute',
}));

import { ProjectGraphPanel } from '../../../src/components/canvas/project-graph-panel';

const EXISTING_ID = '01K3CQWKHQ3GXESM7K1YS55P9A';
const CREATED_ID = '01K3CQWKHQ3GXESM7K1YS55P9B';

function project(id: string, name: string): ProjectOverviewItem {
  return {
    id,
    name,
    summary: null,
    status: 'planned',
    health: null,
    leadId: null,
    startDate: null,
    targetDate: null,
    taskCount: 0,
    completedTaskCount: 0,
    blockedByIds: [],
    blocksIds: [],
  } as unknown as ProjectOverviewItem;
}

describe('Project graph creation continuity', () => {
  it('selects, frames, focuses, and peeks a requested Project after refresh', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const onRequestedSelectionResolved = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const renderPanel = (rows: readonly ProjectOverviewItem[]) => (
      <QueryClientProvider client={client}>
        <ProjectGraphPanel
          rows={rows}
          orgId="org_1"
          requestedSelectionId={CREATED_ID}
          onRequestedSelectionResolved={onRequestedSelectionResolved}
        />
      </QueryClientProvider>
    );
    const rendered = render(renderPanel([project(EXISTING_ID, 'Existing Project')]));
    act(() => {
      canvasState.onInit?.({ fitView });
    });

    expect(screen.queryByRole('complementary', { name: 'Project details' })).toBeNull();
    expect(onRequestedSelectionResolved).not.toHaveBeenCalled();

    rendered.rerender(
      renderPanel([
        project(EXISTING_ID, 'Existing Project'),
        project(CREATED_ID, 'Created Project'),
      ]),
    );

    act(() => {
      const props = bridgeState.props as {
        requestedSelectionId: string;
        onRequestedSelectionApplied: (node: { id: string }) => void;
      };
      expect(props.requestedSelectionId).toBe(CREATED_ID);
      props.onRequestedSelectionApplied({ id: CREATED_ID });
    });

    expect(screen.getByRole('complementary', { name: 'Project details' })).toHaveTextContent(
      'Created Project',
    );
    expect(onRequestedSelectionResolved).toHaveBeenCalledWith(CREATED_ID);
    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: CREATED_ID }], maxZoom: 1 }),
    );
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: CREATED_ID }));
  });

  it('reports a requested Project that a settled refresh still excludes', () => {
    const onRequestedSelectionMissing = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const renderPanel = (requestedSelectionSettled: boolean) => (
      <QueryClientProvider client={client}>
        <ProjectGraphPanel
          rows={[project(EXISTING_ID, 'Existing Project')]}
          orgId="org_1"
          requestedSelectionId={CREATED_ID}
          requestedSelectionSettled={requestedSelectionSettled}
          onRequestedSelectionMissing={onRequestedSelectionMissing}
        />
      </QueryClientProvider>
    );
    const rendered = render(renderPanel(false));

    expect(onRequestedSelectionMissing).not.toHaveBeenCalled();

    rendered.rerender(renderPanel(true));

    expect(onRequestedSelectionMissing).toHaveBeenCalledWith(CREATED_ID);
  });

  it('uses contribute for dependency commands and manage for Project trash', () => {
    commandState.history.execute.mockClear();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <ProjectGraphPanel
          rows={[project(EXISTING_ID, 'Existing Project'), project(CREATED_ID, 'Created Project')]}
          orgId="org_1"
        />
      </QueryClientProvider>,
    );
    const canvas = canvasState.props as {
      interactive: boolean;
      onConnectEdge: (source: string, target: string) => void;
      onDeleteEdge: (edge: { source: string; target: string }) => void;
    };

    expect(canvas.interactive).toBe(true);
    expect(commandState.providerProps).toMatchObject({ canEdit: true, canTrash: false });
    canvas.onConnectEdge(EXISTING_ID, CREATED_ID);
    canvas.onDeleteEdge({ source: EXISTING_ID, target: CREATED_ID });
    expect(commandState.history.execute.mock.calls.map(([command]) => command.operation)).toEqual([
      { type: 'add_dependency', blockingId: EXISTING_ID, blockedId: CREATED_ID },
      { type: 'remove_dependency', blockingId: EXISTING_ID, blockedId: CREATED_ID },
    ]);
  });
});
