import '@testing-library/jest-dom/vitest';

import type { ProjectOverviewItem } from '../../../src/lib/contracts/project';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ObjectCommandReceipt } from '../../../src/lib/contracts/object-command';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { bridgeState, canvasState, commandState, createState, fitView } = vi.hoisted(() => ({
  bridgeState: { props: null as null | Record<string, unknown> },
  createState: { request: null as null | Record<string, unknown> },
  canvasState: {
    onInit: null as null | ((instance: Record<string, unknown>) => void),
    props: null as null | Record<string, unknown>,
  },
  commandState: {
    historyArgs: null as null | readonly unknown[],
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
  useCreateObject: () => ({
    openCreate: (request: Record<string, unknown>) => {
      createState.request = request;
    },
    closeCreate: vi.fn(),
    request: null,
  }),
}));

vi.mock('../../../src/components/canvas/canvas-command-context', () => ({
  useCanvasCommandContext: () => null,
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
  useCanvasCommandHistory: (...args: readonly unknown[]) => {
    commandState.historyArgs = args;
    return commandState.history;
  },
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
vi.mock('../../../src/components/canvas/bulk-actions-bar', () => ({
  default: () => null,
  BulkPropertiesDialogHost: () => null,
  BulkSelectionActions: () => null,
}));
vi.mock('../../../src/components/canvas/canvas-command-notice', () => ({ default: () => null }));
vi.mock('../../../src/components/canvas/project-graph-bar', () => ({
  ProjectGraphBar: ({
    onCreate,
  }: {
    onCreate?: (returnFocusTo: HTMLElement) => void;
  }): ReactNode =>
    onCreate === undefined ? null : (
      <button
        type="button"
        onClick={(event) => {
          onCreate(event.currentTarget);
        }}
      >
        New project
      </button>
    ),
}));

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
  it('selects, frames, focuses, and peeks a Project created from the canvas', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    createState.request = null;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const renderPanel = (rows: readonly ProjectOverviewItem[]) => (
      <QueryClientProvider client={client}>
        <ProjectGraphPanel rows={rows} orgId="org_1" />
      </QueryClientProvider>
    );
    const rendered = render(renderPanel([project(EXISTING_ID, 'Existing Project')]));
    act(() => {
      canvasState.onInit?.({ fitView });
    });

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(createState.request).toMatchObject({
      kind: 'project',
      initialWorkspaceId: 'org_1',
      sameWorkspaceCompletion: 'stay',
    });
    act(() => {
      (createState.request as { onCreated: (created: { id: string }) => void }).onCreated({
        id: CREATED_ID,
      });
    });

    expect(screen.queryByRole('complementary', { name: 'Project details' })).toBeNull();

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
    expect(fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: CREATED_ID }], maxZoom: 1 }),
    );
    expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: CREATED_ID }));
  });

  it('offers creation from the empty canvas', () => {
    const client = new QueryClient();
    const rendered = render(
      <QueryClientProvider client={client}>
        <ProjectGraphPanel rows={[]} orgId="org_1" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(createState.request).toMatchObject({ kind: 'project' });
    rendered.unmount();
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
    expect(commandState.history.execute.mock.calls.map(([, feedback]) => feedback?.detail)).toEqual(
      [
        'Created Project depends on Existing Project',
        'Created Project no longer depends on Existing Project',
      ],
    );
  });
  describe('optimistic dependency edges', () => {
    const OVERVIEW_KEY = ['orgs', 'org_1', 'projects', 'overview'];

    function setup(items: ProjectOverviewItem[]) {
      commandState.history.execute.mockReset();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      client.setQueryData(OVERVIEW_KEY, { items });
      render(
        <QueryClientProvider client={client}>
          <ProjectGraphPanel rows={items} orgId="org_1" />
        </QueryClientProvider>,
      );
      const canvas = canvasState.props as {
        onConnectEdge: (source: string, target: string) => void;
        onDeleteEdge: (edge: { source: string; target: string }) => void;
      };
      const row = (id: string) =>
        client
          .getQueryData<{ items: ProjectOverviewItem[] }>(OVERVIEW_KEY)
          ?.items.find((item) => item.id === id);
      return { client, canvas, row };
    }

    const rows = () => [
      project(EXISTING_ID, 'Existing Project'),
      project(CREATED_ID, 'Created Project'),
    ];

    it('draws the edge in the overview before the command resolves, then keeps it', async () => {
      const { canvas, row } = setup(rows());
      let resolveCommand: (value: unknown) => void = () => undefined;
      let blockedByAtPost: readonly string[] | undefined;
      commandState.history.execute.mockImplementationOnce(() => {
        blockedByAtPost = row(CREATED_ID)?.blockedByIds;
        return new Promise((resolve) => {
          resolveCommand = resolve;
        });
      });

      canvas.onConnectEdge(EXISTING_ID, CREATED_ID);

      expect(blockedByAtPost).toEqual([EXISTING_ID]);
      expect(row(CREATED_ID)?.blockedByIds).toEqual([EXISTING_ID]);
      expect(row(EXISTING_ID)?.blocksIds).toEqual([CREATED_ID]);

      await act(async () => {
        resolveCommand({ appliedIds: [], conflictingIds: [], deniedIds: [], receipt: {} });
        await Promise.resolve();
      });

      expect(row(CREATED_ID)?.blockedByIds).toEqual([EXISTING_ID]);
    });

    it('removes the edge from the overview before the command resolves', () => {
      const linked = rows();
      linked[1] = { ...linked[1], blockedByIds: [EXISTING_ID] } as unknown as ProjectOverviewItem;
      const { canvas, row } = setup(linked);
      commandState.history.execute.mockReturnValueOnce(new Promise(() => undefined));

      canvas.onDeleteEdge({ source: EXISTING_ID, target: CREATED_ID });

      expect(row(CREATED_ID)?.blockedByIds).toEqual([]);
    });

    it('restores the overview when the command is refused', async () => {
      const { canvas, row } = setup(rows());
      let refuse: (value: null) => void = () => undefined;
      commandState.history.execute.mockReturnValueOnce(
        new Promise((resolve) => {
          refuse = resolve;
        }),
      );

      canvas.onConnectEdge(EXISTING_ID, CREATED_ID);
      expect(row(CREATED_ID)?.blockedByIds).toEqual([EXISTING_ID]);

      await act(async () => {
        refuse(null);
        await Promise.resolve();
      });

      expect(row(CREATED_ID)?.blockedByIds).toEqual([]);
      expect(row(EXISTING_ID)?.blocksIds).toEqual([]);
    });

    it('keeps a fresher overview when the refusal arrives after a refetch replaced the patch', async () => {
      const { client, canvas, row } = setup(rows());
      let refuse: (value: null) => void = () => undefined;
      commandState.history.execute.mockReturnValueOnce(
        new Promise((resolve) => {
          refuse = resolve;
        }),
      );

      canvas.onConnectEdge(EXISTING_ID, CREATED_ID);
      const refetched = [project(EXISTING_ID, 'Existing Project'), project(CREATED_ID, 'Renamed')];
      client.setQueryData(OVERVIEW_KEY, { items: refetched });
      await act(async () => {
        refuse(null);
        await Promise.resolve();
      });

      expect(row(CREATED_ID)?.name).toBe('Renamed');
    });

    it('patches the overview for undone and redone dependency receipts', () => {
      const { row } = setup(rows());
      const receipt = {
        commandId: 'command',
        objectKind: 'project',
        action: 'add_dependency',
        entries: [
          {
            kind: 'relation',
            objectId: EXISTING_ID,
            relation: 'dependency',
            relatedId: CREATED_ID,
            before: false,
            after: true,
          },
        ],
      } as ObjectCommandReceipt;
      const onReceipt = commandState.historyArgs?.[3] as (
        receipt: ObjectCommandReceipt,
        direction: 'forward' | 'undo' | 'redo',
      ) => void;

      act(() => {
        onReceipt(receipt, 'redo');
      });
      expect(row(CREATED_ID)?.blockedByIds).toEqual([EXISTING_ID]);

      act(() => {
        onReceipt(receipt, 'undo');
      });
      expect(row(CREATED_ID)?.blockedByIds).toEqual([]);
      expect(row(EXISTING_ID)?.blocksIds).toEqual([]);
    });

    it('still posts the command when the overview is not cached yet', () => {
      commandState.history.execute.mockReset();
      commandState.history.execute.mockResolvedValue(null);
      const client = new QueryClient();
      render(
        <QueryClientProvider client={client}>
          <ProjectGraphPanel rows={rows()} orgId="org_1" />
        </QueryClientProvider>,
      );
      const canvas = canvasState.props as {
        onConnectEdge: (source: string, target: string) => void;
      };

      canvas.onConnectEdge(EXISTING_ID, CREATED_ID);

      expect(commandState.history.execute).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(OVERVIEW_KEY)).toBeUndefined();
    });
  });
});
