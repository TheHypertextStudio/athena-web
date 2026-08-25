'use client';

/**
 * `components/canvas/canvas` — a generic, dataset-agnostic infinite canvas.
 *
 * @remarks
 * A thin composition over `@xyflow/react`: it lays nodes out with dagre and wires three focused
 * hooks — {@link useControlledFlow} (external-data sync + View-Transition morph), {@link
 * useGraphInteractions} (connect / delete / reparent), and {@link useGraphHighlight} (hover /
 * selection / critical-path dimming, reading selection from xyflow itself). It knows nothing about
 * tasks — callers pass xyflow `nodes`/`edges` + a `nodeTypes` map and opt into interaction via
 * callbacks. Hosts inject overlays (legend, toolbar, peek) as `children` (rendered inside the flow,
 * e.g. `<Panel>`).
 */
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type OnInit,
  type OnNodeDrag,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useCanvasMenus } from './canvas-menus';
import CanvasViewportToolbar from './canvas-viewport-toolbar';
import { useControlledFlow, useFitViewOnChange } from './use-controlled-flow';
import { deriveGraphInitialFrame } from './graph-initial-frame';
import { type CanvasDensity, type LayoutDirection, useDagreLayout } from './use-dagre-layout';
import { useGraphHighlight } from './use-graph-highlight';
import {
  edgeKind,
  type GraphInteractionHandlers,
  useGraphInteractions,
} from './use-graph-interactions';
import { LodProvider, useLodValue } from './use-lod';
import { isCanvasEditableTarget } from './canvas-keyboard';

const READABLE_INITIAL_ZOOM = 0.5;
const WORKING_AREA_PADDING = 24;

/** Props for {@link Canvas}. */
export interface CanvasProps extends GraphInteractionHandlers {
  /** Unpositioned nodes; the canvas lays them out with dagre. */
  nodes: Node[];
  /** Directed edges between nodes. */
  edges: Edge[];
  /** Custom node renderers keyed by node `type`. */
  nodeTypes?: NodeTypes | undefined;
  /** Custom edge renderers keyed by edge `type`; hosts override `default` to skin every edge. */
  edgeTypes?: EdgeTypes | undefined;
  /** `compact` for small embeds (no minimap), `full` for the focused view. Default `full`. */
  density?: CanvasDensity | undefined;
  /** Layout flow direction (dagre rankdir). Default `LR`. */
  layoutDirection?: LayoutDirection | undefined;
  /** Skip the dagre pass and render `nodes` at their given positions (e.g. swimlane layout). */
  disableLayout?: boolean | undefined;
  /** Whether an aspect-aware host has applied its first measured layout. Defaults to true. */
  layoutReady?: boolean | undefined;
  /** When true, handles are connectable and dependency edges are deletable/reconnectable. */
  interactive?: boolean | undefined;
  /** When set, persistently dims everything off this id set (e.g. the critical path). */
  highlightIds?: Set<string> | null | undefined;
  /**
   * When false, hovering or selecting a node no longer dims the rest of the graph off its
   * dependency chain (the persistent `highlightIds` set is still honored). Defaults to true; a
   * small portfolio graph opts out so hovering a card leaves its neighbors untouched.
   */
  highlightChains?: boolean | undefined;
  /** When it changes, the canvas pans/zooms to fit these node ids (e.g. search matches). */
  focusOn?: readonly string[] | undefined;
  /**
   * The largest zoom a *user* may reach by pinching or pressing the zoom-in control.
   *
   * @remarks
   * Deliberately separate from {@link CanvasProps.fitMaxZoom}. These used to be one number, which
   * meant capping the automatic fit also took away the user's ability to zoom in, and leaving the
   * user free meant a one-node graph opened at 200%.
   */
  maxZoom?: number | undefined;
  /**
   * The largest zoom the canvas will apply *on its own* when fitting the graph into view.
   *
   * @remarks
   * `fitView` scales up as readily as down, so without a cap a graph of one or two nodes opens
   * magnified past life size with a single card filling the viewport — the "way too zoomed in"
   * reading. Fitting should mean fitting, so this defaults to `1`: the canvas may shrink a large
   * graph to fit, and never enlarges one past its natural size. The user can still zoom in by hand
   * up to {@link CanvasProps.maxZoom}.
   */
  fitMaxZoom?: number | undefined;
  /** Optional minimap node colorer; hosts inject any dataset-specific coloring. */
  nodeColor?: ((node: Node) => string) | undefined;
  /**
   * Whether to render the minimap. Defaults to `density === 'full'`.
   *
   * @remarks
   * The focused Task and Project graph hosts keep it visible so navigation remains available when
   * component-aware layout places work beyond the first readable frame.
   */
  minimap?: boolean | undefined;
  /** When provided, renders an expand affordance that calls this. */
  onExpand?: (() => void) | undefined;
  /** Called when a node is single-clicked (selected), or null when the pane is clicked. */
  onSelectNode?: ((id: string | null) => void) | undefined;
  /** Called when a node is double-clicked (navigate to it). */
  onNavigate?: ((id: string) => void) | undefined;
  /** Receives the initialized xyflow instance for host-specific spatial interactions. */
  onInit?: OnInit | undefined;
  /** Generic node-drag lifecycle callbacks; hosts assign domain meaning. */
  onNodeDragStart?: OnNodeDrag | undefined;
  onNodeDrag?: OnNodeDrag | undefined;
  onNodeDragStop?: OnNodeDrag | undefined;
  /** Recompute the host's deterministic structural layout. */
  onRelayout?: (() => void) | undefined;
  /** Overlays rendered inside the flow (e.g. `<Panel>` legend/toolbar/peek). */
  children?: ReactNode | undefined;
  /** Extra classes for the canvas container. */
  className?: string | undefined;
}

/** The inner canvas; must live under a {@link ReactFlowProvider}. */
function CanvasInner({
  nodes: rawNodes,
  edges: rawEdges,
  nodeTypes,
  edgeTypes,
  density = 'full',
  layoutDirection = 'LR',
  disableLayout = false,
  layoutReady = true,
  interactive = false,
  highlightIds,
  highlightChains = true,
  focusOn,
  maxZoom = 2,
  fitMaxZoom = 1,
  nodeColor,
  minimap,
  onExpand,
  onSelectNode,
  onNavigate,
  onInit,
  onNodeDragStart,
  onNodeDrag,
  onNodeDragStop,
  onRelayout,
  onConnectEdge,
  onDeleteEdge,
  onReparentEdge,
  children,
  className,
}: CanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [flowInstance, setFlowInstance] = useState<Parameters<OnInit>[0] | null>(null);
  const [shiftSelecting, setShiftSelecting] = useState(false);
  const [oneShotSelecting, setOneShotSelecting] = useState(false);
  const framed = useRef(false);
  // Grouped/swimlane layouts arrive pre-positioned; otherwise dagre lays the flat graph out.
  const dagreLaidOut = useDagreLayout(rawNodes, rawEdges, density, layoutDirection);
  const laidOut = disableLayout ? rawNodes : dagreLaidOut;
  const { nodes, edges, onNodesChange, onEdgesChange, layoutApplied } = useControlledFlow(
    laidOut,
    rawEdges,
  );

  const interactions = useGraphInteractions({ onConnectEdge, onDeleteEdge, onReparentEdge });
  const highlight = useGraphHighlight(nodes, edges, highlightIds, highlightChains);
  useFitViewOnChange(focusOn, fitMaxZoom, layoutReady && layoutApplied);
  // An edge and the empty pane are not core objects, so the app's object-level right-click handler
  // never claims them; these are the canvas's own menus for the two.
  const menus = useCanvasMenus({
    onSelectArea: () => {
      setOneShotSelecting(true);
      containerRef.current?.focus();
    },
    onRelayout: () => {
      framed.current = false;
      onRelayout?.();
    },
    onRemoveDependency:
      onDeleteEdge === undefined
        ? undefined
        : (sourceId, targetId) => {
            const edge = rawEdges.find(
              (candidate) => candidate.source === sourceId && candidate.target === targetId,
            );
            if (edge !== undefined) onDeleteEdge(edge);
          },
  });
  const lod = useLodValue();
  const initialFrame = useMemo(() => deriveGraphInitialFrame(nodes, edges), [nodes, edges]);
  const areaSelecting = shiftSelecting || oneShotSelecting;
  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (
        !interactive ||
        onDeleteEdge === undefined ||
        isCanvasEditableTarget(event.target) ||
        (event.key !== 'Delete' && event.key !== 'Backspace') ||
        nodes.some(({ selected }) => selected)
      ) {
        return;
      }
      const selectedDependencies = edges.filter(
        (edge) => edge.selected === true && edgeKind(edge) !== 'subtask',
      );
      if (selectedDependencies.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      for (const edge of selectedDependencies) onDeleteEdge(edge);
    },
    [edges, interactive, nodes, onDeleteEdge],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') setShiftSelecting(true);
      if (event.key !== 'Escape' || isCanvasEditableTarget(event.target)) return;
      if (!containerRef.current?.contains(document.activeElement)) return;
      setOneShotSelecting(false);
      flowInstance?.setNodes((current) =>
        current.map((node) => (node.selected ? { ...node, selected: false } : node)),
      );
      onSelectNode?.(null);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') setShiftSelecting(false);
    };
    const onBlur = (): void => {
      setShiftSelecting(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [flowInstance, onSelectNode]);
  const initializeFlow = useCallback<OnInit>(
    (instance) => {
      setFlowInstance(instance);
      onInit?.(instance);
    },
    [onInit],
  );
  useEffect(() => {
    if (
      flowInstance === null ||
      !layoutReady ||
      !layoutApplied ||
      framed.current ||
      initialFrame.nodeIds.length === 0
    ) {
      return;
    }
    if (focusOn !== undefined && focusOn.length > 0) {
      framed.current = true;
      return;
    }
    let canceled = false;
    let frameId = 0;
    const frameGraph = (): void => {
      if (canceled) return;
      const measured = initialFrame.nodeIds.every((id) => {
        const node = flowInstance.getInternalNode(id);
        return (node?.measured.width ?? 0) > 0 && (node?.measured.height ?? 0) > 0;
      });
      if (!measured) {
        frameId = requestAnimationFrame(frameGraph);
        return;
      }
      const element = containerRef.current;
      if (element === null) return;
      framed.current = true;
      const allNodeIds = flowInstance
        .getNodes()
        .filter((node) => node.type !== 'group')
        .map(({ id }) => id);
      const availableWidth = Math.max(1, element.clientWidth - WORKING_AREA_PADDING * 2);
      const availableHeight = Math.max(1, element.clientHeight - WORKING_AREA_PADDING * 2);
      const allBounds = flowInstance.getNodesBounds(allNodeIds);
      const allZoom = Math.min(
        availableWidth / Math.max(allBounds.width, 1),
        availableHeight / Math.max(allBounds.height, 1),
        fitMaxZoom,
      );
      if (allZoom >= READABLE_INITIAL_ZOOM) {
        void flowInstance.fitView({
          nodes: allNodeIds.map((id) => ({ id })),
          minZoom: READABLE_INITIAL_ZOOM,
          maxZoom: fitMaxZoom,
          padding: 0.15,
        });
        return;
      }
      const primaryBounds = flowInstance.getNodesBounds([...initialFrame.nodeIds]);
      const primaryZoom = Math.min(
        availableWidth / Math.max(primaryBounds.width, 1),
        availableHeight / Math.max(primaryBounds.height, 1),
        fitMaxZoom,
      );
      if (primaryZoom >= READABLE_INITIAL_ZOOM) {
        void flowInstance.fitView({
          nodes: initialFrame.nodeIds.map((id) => ({ id })),
          minZoom: READABLE_INITIAL_ZOOM,
          maxZoom: fitMaxZoom,
          padding: 0.15,
        });
        return;
      }
      const anchor =
        initialFrame.anchorNodeId === null
          ? undefined
          : flowInstance.getInternalNode(initialFrame.anchorNodeId);
      if (anchor === undefined) return;
      const position = anchor.internals.positionAbsolute;
      void flowInstance.setViewport({
        x: WORKING_AREA_PADDING - position.x * READABLE_INITIAL_ZOOM,
        y: WORKING_AREA_PADDING - position.y * READABLE_INITIAL_ZOOM,
        zoom: READABLE_INITIAL_ZOOM,
      });
    };
    frameId = requestAnimationFrame(frameGraph);
    return () => {
      canceled = true;
      cancelAnimationFrame(frameId);
    };
  }, [fitMaxZoom, flowInstance, focusOn, initialFrame, layoutApplied, layoutReady]);

  return (
    <LodProvider value={lod}>
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleCanvasKeyDown}
        className={cn('relative h-full min-h-0 w-full focus:outline-none', className)}
      >
        <ReactFlow
          nodes={highlight.nodes}
          edges={highlight.edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          {...(nodeTypes !== undefined ? { nodeTypes } : {})}
          {...(edgeTypes !== undefined ? { edgeTypes } : {})}
          onNodeClick={(_, node) => onSelectNode?.(node.id)}
          onNodeContextMenu={(event, node) => {
            if (!node.selected) {
              flowInstance?.setNodes((current) =>
                current.map((candidate) => ({ ...candidate, selected: candidate.id === node.id })),
              );
              onSelectNode?.(node.id);
            }
            menus.onNodeContextMenu(event, node);
          }}
          onNodeDoubleClick={(_, node) => onNavigate?.(node.id)}
          onInit={initializeFlow}
          {...(onNodeDragStart !== undefined ? { onNodeDragStart } : {})}
          {...(onNodeDrag !== undefined ? { onNodeDrag } : {})}
          {...(onNodeDragStop !== undefined ? { onNodeDragStop } : {})}
          onPaneClick={() => onSelectNode?.(null)}
          onEdgeContextMenu={menus.onEdgeContextMenu}
          onPaneContextMenu={menus.onPaneContextMenu}
          onNodeMouseEnter={highlight.onNodeMouseEnter}
          onNodeMouseLeave={highlight.onNodeMouseLeave}
          nodesConnectable={interactive}
          edgesReconnectable={interactive}
          isValidConnection={interactions.isValidConnection}
          onConnect={interactions.onConnect}
          onReconnect={interactions.onReconnect}
          onBeforeDelete={interactions.onBeforeDelete}
          onEdgesDelete={interactions.onEdgesDelete}
          // Object deletion is a recoverable server command owned by the host. Letting xyflow
          // consume this key would remove selected nodes only from local render state.
          deleteKeyCode={null}
          panOnDrag={!areaSelecting}
          selectionOnDrag={areaSelecting}
          onSelectionEnd={() => {
            if (oneShotSelecting) setOneShotSelecting(false);
          }}
          elementsSelectable
          nodesFocusable={false}
          onlyRenderVisibleElements
          fitView={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.1}
          maxZoom={maxZoom}
          fitViewOptions={{ maxZoom: fitMaxZoom, padding: 0.15 }}
        >
          {/*
            The canvas takes the page's own surface. It used to force `surface-container`, so the
            graph sat on a visibly darker slab than the panel around it and read as a widget
            embedded in the page rather than as the page.
          */}
          <Background variant={BackgroundVariant.Dots} gap={20} className="!bg-surface" />
          {/*
            Controls and minimap: tonal, no strokes. The overrides used to force a 1px outline on
            every control and a divider between them, which is the wireframe look this canvas was
            called out for.
          */}
          <Panel
            position="bottom-left"
            className="pointer-events-none !right-[15px] !bottom-[15px] !left-[15px] !m-0 flex items-end justify-between gap-2"
          >
            <Controls
              showInteractive={false}
              className="[&_button]:!bg-surface-container-high [&_button]:!fill-on-surface-variant [&_button:hover]:!bg-surface-container-highest pointer-events-auto !static shrink-0 overflow-hidden !rounded-lg !shadow-none [&_button]:!border-0"
            />
            <CanvasViewportToolbar
              onRelayout={() => {
                framed.current = false;
                onRelayout?.();
              }}
            />
            {(minimap ?? density === 'full') ? (
              <MiniMap
                pannable
                zoomable
                {...(nodeColor !== undefined ? { nodeColor } : {})}
                maskColor="color-mix(in srgb, var(--color-surface) 70%, transparent)"
                bgColor="var(--color-surface-container-low)"
                className="pointer-events-auto !static !m-0 !h-20 !w-32 shrink-0 !rounded-lg sm:!h-[150px] sm:!w-[200px]"
              />
            ) : null}
          </Panel>
          {children}
        </ReactFlow>
        {menus.menu}
        {onExpand ? (
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand graph"
            className="bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface absolute top-2 right-2 z-10 inline-flex size-9 items-center justify-center rounded-full transition-colors"
          >
            <Maximize className="size-4" />
          </button>
        ) : null}
      </div>
    </LodProvider>
  );
}

/** A pan/zoom infinite canvas with a dagre layout; provider-wrapped so it is drop-in. */
export default function Canvas(props: CanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
