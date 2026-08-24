/** `@docket/web` — measured-layout and initial-framing lifecycle regressions. */
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flowState = vi.hoisted(() => ({
  nodes: [] as Node[],
  fitView: vi.fn(),
  setViewport: vi.fn(),
}));

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  const boundsOf = (ids: readonly string[]) => {
    const selected = flowState.nodes.filter((node) => ids.includes(node.id));
    const minX = Math.min(...selected.map((node) => node.position.x));
    const minY = Math.min(...selected.map((node) => node.position.y));
    const maxX = Math.max(...selected.map((node) => node.position.x + 268));
    const maxY = Math.max(...selected.map((node) => node.position.y + 96));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };
  const instance = {
    fitView: flowState.fitView,
    setViewport: flowState.setViewport,
    getNodes: () => flowState.nodes,
    getEdges: () => [],
    getNodesBounds: (items: (string | { id: string })[]) =>
      boundsOf(items.map((item) => (typeof item === 'string' ? item : item.id))),
    getInternalNode: (id: string) => {
      const node = flowState.nodes.find((candidate) => candidate.id === id);
      return node === undefined
        ? undefined
        : {
            internals: { positionAbsolute: node.position },
            measured: { width: 268, height: 96 },
          };
    },
  } as unknown as ReactFlowInstance;
  const ReactFlow = ({
    nodes,
    onInit,
    children,
  }: {
    nodes: Node[];
    onInit?: (value: ReactFlowInstance) => void;
    children?: ReactNode;
  }) => {
    flowState.nodes = nodes;
    const initial = React.useRef(onInit);
    React.useEffect(() => {
      initial.current?.(instance);
    }, []);
    return (
      <div data-testid="flow">
        {nodes.map((node) => (
          <span
            key={node.id}
            data-node-id={node.id}
            data-position={`${node.position.x},${node.position.y}`}
          />
        ))}
        {children}
      </div>
    );
  };
  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: () => null,
    MiniMap: () => null,
    Panel: ({ children }: { children?: ReactNode }) => children ?? null,
    Position: { Bottom: 'bottom', Left: 'left', Right: 'right', Top: 'top' },
    ReactFlow,
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => children ?? null,
    useEdgesState: (initial: Edge[]) => {
      const [edges, setEdges] = React.useState(initial);
      return [edges, setEdges, vi.fn()] as const;
    },
    useNodesState: (initial: Node[]) => {
      const [nodes, setNodes] = React.useState(initial);
      return [nodes, setNodes, vi.fn()] as const;
    },
    useOnSelectionChange: () => undefined,
    useReactFlow: () => instance,
    useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
      selector({ transform: [0, 0, 1] }),
  };
});

vi.mock('@/components/canvas/canvas-menus', () => ({
  useCanvasMenus: () => ({
    menu: null,
    onEdgeContextMenu: vi.fn(),
    onPaneContextMenu: vi.fn(),
  }),
}));
vi.mock('@/components/canvas/use-graph-highlight', () => ({
  useGraphHighlight: (nodes: Node[], edges: Edge[]) => ({
    nodes,
    edges,
    onNodeMouseEnter: vi.fn(),
    onNodeMouseLeave: vi.fn(),
  }),
}));
vi.mock('@/components/canvas/use-graph-interactions', () => ({
  useGraphInteractions: () => ({
    isValidConnection: vi.fn(),
    onBeforeDelete: vi.fn(),
    onConnect: vi.fn(),
    onEdgesDelete: vi.fn(),
    onReconnect: vi.fn(),
  }),
}));

import Canvas from '@/components/canvas/canvas';
import { useProjectGraphLayout } from '@/components/canvas/project-graph-layout';
import { useCanvasAspectRatio } from '@/components/canvas/use-canvas-aspect-ratio';

const projects: Node[] = Array.from({ length: 8 }, (_, index) => ({
  id: `project-${index}`,
  position: { x: 0, y: 0 },
  data: { name: `Project ${index}` },
}));

function Harness({ focusOn }: { readonly focusOn?: readonly string[] }): React.JSX.Element {
  const { containerRef, aspectRatio, ready } = useCanvasAspectRatio();
  const layout = useProjectGraphLayout(projects, [], aspectRatio);
  return (
    <div ref={containerRef}>
      <Canvas
        nodes={layout.nodes}
        edges={[]}
        disableLayout
        layoutReady={ready}
        {...(focusOn === undefined ? {} : { focusOn })}
      />
    </div>
  );
}

describe('Canvas measured layout lifecycle', () => {
  let width = 0;
  let height = 0;
  let resize: ResizeObserverCallback;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    width = 0;
    height = 0;
    flowState.nodes = [];
    flowState.fitView.mockReset().mockResolvedValue(true);
    flowState.setViewport.mockReset().mockResolvedValue(true);
    frames = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width, height }) as DOMRect,
    );
    Object.defineProperties(HTMLElement.prototype, {
      clientWidth: { configurable: true, get: () => 800 },
      clientHeight: { configurable: true, get: () => 600 },
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe(): void {
          return undefined;
        }
        disconnect(): void {
          return undefined;
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function flushFrames(): void {
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
  }

  it('applies portrait positions before running the automatic first frame', async () => {
    render(<Harness />);
    flushFrames();
    expect(flowState.fitView).not.toHaveBeenCalled();

    width = 600;
    height = 900;
    act(() => {
      resize([], {} as ResizeObserver);
    });

    await waitFor(() => {
      const positions = screen.getByTestId('flow').querySelectorAll<HTMLElement>('[data-node-id]');
      expect(
        new Set([...positions].map((node) => node.dataset['position']?.split(',')[0])).size,
      ).toBe(2);
    });
    flushFrames();

    expect(flowState.fitView).toHaveBeenCalledTimes(1);
  });

  it('lets non-empty search focus win over automatic framing', async () => {
    render(<Harness focusOn={['project-7']} />);
    expect(flowState.fitView).not.toHaveBeenCalled();
    width = 600;
    height = 900;
    act(() => {
      resize([], {} as ResizeObserver);
    });
    await waitFor(() => {
      expect(flowState.fitView).toHaveBeenCalled();
    });
    flushFrames();

    expect(flowState.fitView).toHaveBeenCalledTimes(1);
    expect(flowState.fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: 'project-7' }] }),
    );
  });
});
