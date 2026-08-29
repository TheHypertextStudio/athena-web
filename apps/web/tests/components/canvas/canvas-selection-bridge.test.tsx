/** `@docket/web` — xyflow-to-object selection bridge tests. */
import { act, render, waitFor } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CanvasSelectionBridge from '@/components/canvas/canvas-selection-bridge';
import { SelectionProvider, readSelectionSurface } from '@/components/selection';
import type { ObjectRef } from '@/lib/actions';

let notifySelection: ((change: { nodes: Node[] }) => void) | null = null;
const setNodes = vi.fn();
const getNode = vi.fn();
let flowNodes = new Map<string, Node>();
let flowStore = { nodeLookup: new Map<string, Node>() };
const flowStoreListeners = new Set<() => void>();

function publishFlowNode(node: Node): void {
  flowNodes = new Map(flowNodes).set(node.id, node);
  flowStore = { nodeLookup: new Map(flowNodes) };
  for (const listener of flowStoreListeners) listener();
}

vi.mock('@xyflow/react', () => ({
  useOnSelectionChange: ({ onChange }: { onChange: (change: { nodes: Node[] }) => void }) => {
    notifySelection = onChange;
  },
  useReactFlow: () => ({ setNodes, getNode }),
  useStore: (selector: (state: typeof flowStore) => unknown) =>
    useSyncExternalStore(
      (listener) => {
        flowStoreListeners.add(listener);
        return () => {
          flowStoreListeners.delete(listener);
        };
      },
      () => selector(flowStore),
      () => selector(flowStore),
    ),
}));

const items: ObjectRef[] = [
  { kind: 'task', id: 'task-a', title: 'Task A', organizationId: 'org-1' },
  { kind: 'task', id: 'task-b', title: 'Task B', organizationId: 'org-1' },
];

describe('CanvasSelectionBridge', () => {
  beforeEach(() => {
    flowNodes = new Map();
    flowStore = { nodeLookup: new Map() };
    getNode.mockReset();
    getNode.mockImplementation((id: string) => flowNodes.get(id));
    setNodes.mockReset();
  });

  it('registers the complete selected task set for global actions', async () => {
    render(
      <SelectionProvider
        items={items}
        surfaceId="task-graph"
        organizationId="org-1"
        actionScope="all"
      >
        <CanvasSelectionBridge />
      </SelectionProvider>,
    );

    act(() => {
      notifySelection?.({
        nodes: [
          { id: 'task-a', type: 'taskBranch', position: { x: 0, y: 0 }, data: {} },
          { id: 'task-b', type: 'taskBranch', position: { x: 0, y: 0 }, data: {} },
        ],
      });
    });

    await waitFor(() => {
      expect(readSelectionSurface('task-graph')?.selectedObjects.map(({ id }) => id)).toEqual([
        'task-a',
        'task-b',
      ]);
    });
  });

  it('publishes Project nodes as typed Project object references', async () => {
    const projects: ObjectRef[] = [
      { kind: 'project', id: 'project-a', title: 'Project A', organizationId: 'org-1' },
    ];
    render(
      <SelectionProvider
        items={projects}
        surfaceId="project-graph"
        organizationId="org-1"
        actionScope="all"
      >
        <CanvasSelectionBridge objectKind="project" nodeTypes={['project']} />
      </SelectionProvider>,
    );

    act(() => {
      notifySelection?.({
        nodes: [{ id: 'project-a', type: 'project', position: { x: 0, y: 0 }, data: {} }],
      });
    });

    await waitFor(() => {
      expect(readSelectionSurface('project-graph')?.selectedObjects).toEqual(projects);
    });
  });

  it('applies a created object to shared and xyflow selection before reporting it ready', async () => {
    const projects: ObjectRef[] = [
      { kind: 'project', id: 'project-created', title: 'Created', organizationId: 'org-1' },
    ];
    const node: Node = {
      id: 'project-created',
      type: 'project',
      position: { x: 0, y: 0 },
      data: {},
    };
    publishFlowNode(node);
    const onRequestedSelectionApplied = vi.fn();
    render(
      <SelectionProvider
        items={projects}
        surfaceId="project-created"
        organizationId="org-1"
        actionScope="all"
      >
        <CanvasSelectionBridge
          objectKind="project"
          nodeTypes={['project']}
          requestedSelectionId="project-created"
          onRequestedSelectionApplied={onRequestedSelectionApplied}
        />
      </SelectionProvider>,
    );

    await waitFor(() => {
      expect(readSelectionSurface('project-created')?.selectedObjects).toEqual(projects);
    });
    expect(setNodes).toHaveBeenCalled();
    expect(onRequestedSelectionApplied).toHaveBeenCalledWith(node);
  });

  it('retries after the controlled store receives a structurally ready host node', async () => {
    const projects: ObjectRef[] = [
      { kind: 'project', id: 'project-late', title: 'Late Project', organizationId: 'org-1' },
    ];
    const node: Node = {
      id: 'project-late',
      type: 'project',
      position: { x: 0, y: 0 },
      data: {},
    };
    const onRequestedSelectionApplied = vi.fn();
    const lateNodeTypes = ['project'] as const;
    const renderBridge = (requestedSelectionReady: boolean) => (
      <SelectionProvider
        items={projects}
        surfaceId="project-late"
        organizationId="org-1"
        actionScope="all"
      >
        <CanvasSelectionBridge
          objectKind="project"
          nodeTypes={lateNodeTypes}
          requestedSelectionId="project-late"
          requestedSelectionReady={requestedSelectionReady}
          onRequestedSelectionApplied={onRequestedSelectionApplied}
        />
      </SelectionProvider>
    );
    const rendered = render(renderBridge(false));

    expect(onRequestedSelectionApplied).not.toHaveBeenCalled();
    rendered.rerender(renderBridge(true));
    expect(onRequestedSelectionApplied).not.toHaveBeenCalled();

    act(() => {
      publishFlowNode(node);
    });

    await waitFor(() => {
      expect(readSelectionSurface('project-late')?.selectedObjects).toEqual(projects);
    });
    expect(onRequestedSelectionApplied).toHaveBeenCalledWith(node);
  });
});
