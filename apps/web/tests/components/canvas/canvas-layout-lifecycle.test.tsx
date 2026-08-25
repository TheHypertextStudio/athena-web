/** `@docket/web` — measured-layout and initial-framing lifecycle regressions. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flowState = vi.hoisted<{
  nodes: Node[];
  fitView: ReturnType<typeof vi.fn>;
  setViewport: ReturnType<typeof vi.fn>;
  setNodes: ReturnType<typeof vi.fn>;
  reactFlowProps: Record<string, unknown>;
  menuOptions: Record<string, () => void>;
  commandKeyDown: ReturnType<typeof vi.fn>;
}>(() => ({
  nodes: [],
  fitView: vi.fn(),
  setViewport: vi.fn(),
  setNodes: vi.fn(),
  reactFlowProps: {},
  menuOptions: {},
  commandKeyDown: vi.fn(),
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
    setNodes: flowState.setNodes,
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
  const ReactFlow = (props: {
    nodes: Node[];
    onInit?: (value: ReactFlowInstance) => void;
    children?: ReactNode;
  }) => {
    const { nodes, onInit, children } = props;
    flowState.reactFlowProps = props;
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
    MiniMap: () => <div data-testid="minimap" />,
    Panel: ({
      children,
      className,
      position: _position,
      ...props
    }: {
      children?: ReactNode;
      className?: string;
      position?: string;
      [key: string]: unknown;
    }) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
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
    useStore: (
      selector: (state: { nodes: Node[]; transform: [number, number, number] }) => unknown,
    ) => selector({ nodes: flowState.nodes, transform: [0, 0, 1] }),
  };
});

vi.mock('@/components/canvas/canvas-menus', () => ({
  useCanvasMenus: (options: Record<string, () => void>) => {
    flowState.menuOptions = options;
    return {
      menu: null,
      onEdgeContextMenu: vi.fn(),
      onNodeContextMenu: vi.fn(),
      onPaneContextMenu: vi.fn(),
    };
  },
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
  edgeKind: (edge: Edge) => (edge.data as { kind?: string } | undefined)?.kind,
  useGraphInteractions: () => ({
    isValidConnection: vi.fn(),
    onBeforeDelete: vi.fn(),
    onConnect: vi.fn(),
    onEdgesDelete: vi.fn(),
    onReconnect: vi.fn(),
  }),
}));
vi.mock('@/components/canvas/canvas-command-context', () => ({
  useCanvasCommandContext: () => ({ onCanvasKeyDown: flowState.commandKeyDown }),
}));

import Canvas from '@/components/canvas/canvas';
import CanvasSelectionFrame from '@/components/canvas/canvas-selection-frame';
import { useProjectGraphLayout } from '@/components/canvas/project-graph-layout';
import { useCanvasAspectRatio } from '@/components/canvas/use-canvas-aspect-ratio';
import { SelectionProvider } from '@/components/selection';

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
  let chromeHeight = 150;
  let resizeCallbacks: ResizeObserverCallback[];
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    width = 0;
    height = 0;
    chromeHeight = 150;
    resizeCallbacks = [];
    flowState.nodes = [];
    flowState.fitView.mockReset().mockResolvedValue(true);
    flowState.setViewport.mockReset().mockResolvedValue(true);
    flowState.setNodes.mockReset();
    flowState.reactFlowProps = {};
    flowState.menuOptions = {};
    flowState.commandKeyDown.mockReset();
    frames = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return {
        width,
        height: this.dataset['testid'] === 'canvas-bottom-chrome-content' ? chromeHeight : height,
      } as DOMRect;
    });
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
          resizeCallbacks.push(callback);
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

  function notifyResize(): void {
    act(() => {
      for (const resize of resizeCallbacks) resize([], {} as ResizeObserver);
    });
  }

  it('applies portrait positions before running the automatic first frame', async () => {
    render(<Harness />);
    flushFrames();
    expect(flowState.fitView).not.toHaveBeenCalled();

    width = 600;
    height = 900;
    notifyResize();

    await waitFor(() => {
      const positions = screen.getByTestId('flow').querySelectorAll<HTMLElement>('[data-node-id]');
      expect(
        new Set([...positions].map((node) => node.dataset['position']?.split(',')[0])).size,
      ).toBe(2);
    });
    flushFrames();

    expect(flowState.fitView).toHaveBeenCalledTimes(1);
    expect(flowState.fitView).toHaveBeenCalledWith(
      expect.objectContaining({
        minZoom: 0.5,
        maxZoom: 1,
        padding: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
      }),
    );
    expect(screen.getByTestId('canvas-viewport')).toHaveStyle({ bottom: '180px' });
  });

  it('docks command feedback above the viewport toolbar in the top overlay layer', () => {
    render(
      <Canvas
        nodes={[]}
        edges={[]}
        bottomNotice={<div data-testid="command-feedback">Dependency added</div>}
      />,
    );

    const chrome = screen.getByTestId('canvas-bottom-chrome');
    expect(chrome).toContainElement(screen.getByTestId('command-feedback'));
    expect(chrome).toHaveClass('!z-[2000]');
    expect(screen.getByTestId('canvas-bottom-notice')).toHaveTextContent('Dependency added');
  });

  it('measures no-minimap feedback and keeps the graph viewport above the complete dock', () => {
    chromeHeight = 196;
    render(
      <Canvas
        nodes={[]}
        edges={[]}
        density="compact"
        minimap={false}
        bottomNotice={<div data-testid="command-feedback">Dependency added</div>}
      />,
    );
    notifyResize();

    expect(screen.queryByTestId('minimap')).not.toBeInTheDocument();
    expect(screen.getByTestId('canvas-viewport')).toHaveStyle({ bottom: '226px' });
    expect(screen.getByTestId('canvas-bottom-chrome')).toContainElement(
      screen.getByTestId('command-feedback'),
    );
  });

  it('lets non-empty search focus win over automatic framing', async () => {
    render(<Harness focusOn={['project-7']} />);
    expect(flowState.fitView).not.toHaveBeenCalled();
    width = 600;
    height = 900;
    notifyResize();
    await waitFor(() => {
      expect(flowState.fitView).toHaveBeenCalled();
    });
    flushFrames();

    expect(flowState.fitView).toHaveBeenCalledTimes(1);
    expect(flowState.fitView).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [{ id: 'project-7' }] }),
    );
  });

  it('keeps drag as pan until Shift or one-shot area selection activates', () => {
    render(<Harness />);

    expect(flowState.reactFlowProps['panOnDrag']).toBe(true);
    expect(flowState.reactFlowProps['selectionOnDrag']).toBe(false);
    expect(flowState.reactFlowProps['nodesFocusable']).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    });
    expect(flowState.reactFlowProps['panOnDrag']).toBe(false);
    expect(flowState.reactFlowProps['selectionOnDrag']).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    });
    expect(flowState.reactFlowProps['panOnDrag']).toBe(true);

    act(() => {
      flowState.menuOptions['onSelectArea']?.();
    });
    expect(flowState.reactFlowProps['selectionOnDrag']).toBe(true);
    act(() => {
      (flowState.reactFlowProps['onSelectionEnd'] as (() => void) | undefined)?.();
    });
    expect(flowState.reactFlowProps['selectionOnDrag']).toBe(false);
  });

  it('preserves an existing right-click selection and clears on the empty pane', async () => {
    const onSelectNode = vi.fn();
    render(
      <Canvas
        nodes={[{ id: 'project-1', type: 'project', position: { x: 0, y: 0 }, data: {} }]}
        edges={[]}
        disableLayout
        onSelectNode={onSelectNode}
      />,
    );
    await waitFor(() => {
      expect(flowState.reactFlowProps['onNodeContextMenu']).toBeTypeOf('function');
    });

    act(() => {
      (
        flowState.reactFlowProps['onNodeContextMenu'] as (
          event: { preventDefault(): void; stopPropagation(): void },
          node: Node,
        ) => void
      )(
        { preventDefault: vi.fn(), stopPropagation: vi.fn() },
        { id: 'project-1', type: 'project', selected: true, position: { x: 0, y: 0 }, data: {} },
      );
    });
    expect(flowState.setNodes).not.toHaveBeenCalled();

    act(() => {
      (flowState.reactFlowProps['onPaneClick'] as () => void)();
    });
    expect(onSelectNode).toHaveBeenCalledWith(null);
  });

  it('deletes a selected dependency edge before the gentle node-trash boundary handles the key', () => {
    const onDeleteEdge = vi.fn();
    render(
      <SelectionProvider items={[]} surfaceId="project-keyboard">
        <CanvasSelectionFrame label="Project dependency graph">
          <Canvas
            nodes={[
              { id: 'project-a', position: { x: 0, y: 0 }, data: {} },
              { id: 'project-b', position: { x: 300, y: 0 }, data: {} },
            ]}
            edges={[
              {
                id: 'project-a->project-b',
                source: 'project-a',
                target: 'project-b',
                selected: true,
                data: { kind: 'dependency' },
              },
            ]}
            disableLayout
            interactive
            onDeleteEdge={onDeleteEdge}
          />
        </CanvasSelectionFrame>
      </SelectionProvider>,
    );

    fireEvent.keyDown(screen.getByTestId('flow'), { key: 'Delete' });

    expect(onDeleteEdge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'project-a->project-b' }),
    );
    expect(flowState.commandKeyDown).not.toHaveBeenCalled();
    expect(flowState.reactFlowProps['deleteKeyCode']).toBeNull();
  });

  it('lets selected nodes reach SelectionFrame gentle trash without local React Flow deletion', () => {
    const onDeleteEdge = vi.fn();
    render(
      <SelectionProvider items={[]} surfaceId="task-keyboard">
        <CanvasSelectionFrame label="Task graph">
          <Canvas
            nodes={[{ id: 'task-a', position: { x: 0, y: 0 }, selected: true, data: {} }]}
            edges={[]}
            disableLayout
            interactive
            onDeleteEdge={onDeleteEdge}
          />
        </CanvasSelectionFrame>
      </SelectionProvider>,
    );

    fireEvent.keyDown(screen.getByTestId('flow'), { key: 'Backspace' });

    expect(flowState.commandKeyDown).toHaveBeenCalledOnce();
    expect(onDeleteEdge).not.toHaveBeenCalled();
    expect(flowState.reactFlowProps['deleteKeyCode']).toBeNull();
    expect(flowState.reactFlowProps['onNodesDelete']).toBeUndefined();
  });
});
