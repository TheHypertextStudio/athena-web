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
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { type ReactNode } from 'react';

import { useControlledFlow, useFitViewOnChange } from './use-controlled-flow';
import { type CanvasDensity, type LayoutDirection, useDagreLayout } from './use-dagre-layout';
import { useGraphHighlight } from './use-graph-highlight';
import { type GraphInteractionHandlers, useGraphInteractions } from './use-graph-interactions';
import { LodProvider, useLodValue } from './use-lod';

/** Props for {@link Canvas}. */
export interface CanvasProps extends GraphInteractionHandlers {
  /** Unpositioned nodes; the canvas lays them out with dagre. */
  nodes: Node[];
  /** Directed edges between nodes. */
  edges: Edge[];
  /** Custom node renderers keyed by node `type`. */
  nodeTypes?: NodeTypes;
  /** Custom edge renderers keyed by edge `type`; hosts override `default` to skin every edge. */
  edgeTypes?: EdgeTypes;
  /** `compact` for small embeds (no minimap), `full` for the focused view. Default `full`. */
  density?: CanvasDensity;
  /** Layout flow direction (dagre rankdir). Default `LR`. */
  layoutDirection?: LayoutDirection;
  /** Skip the dagre pass and render `nodes` at their given positions (e.g. swimlane layout). */
  disableLayout?: boolean;
  /** When true, handles are connectable and dependency edges are deletable/reconnectable. */
  interactive?: boolean;
  /** When set, persistently dims everything off this id set (e.g. the critical path). */
  highlightIds?: Set<string> | null;
  /**
   * When false, hovering or selecting a node no longer dims the rest of the graph off its
   * dependency chain (the persistent `highlightIds` set is still honored). Defaults to true; a
   * small portfolio graph opts out so hovering a card leaves its neighbors untouched.
   */
  highlightChains?: boolean;
  /** When it changes, the canvas pans/zooms to fit these node ids (e.g. search matches). */
  focusOn?: readonly string[];
  /**
   * The largest zoom a *user* may reach by pinching or pressing the zoom-in control.
   *
   * @remarks
   * Deliberately separate from {@link CanvasProps.fitMaxZoom}. These used to be one number, which
   * meant capping the automatic fit also took away the user's ability to zoom in, and leaving the
   * user free meant a one-node graph opened at 200%.
   */
  maxZoom?: number;
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
  fitMaxZoom?: number;
  /** Optional minimap node colorer; hosts inject any dataset-specific coloring. */
  nodeColor?: (node: Node) => string;
  /**
   * Whether to render the minimap. Defaults to `density === 'full'`.
   *
   * @remarks
   * A minimap earns its space on a graph too large to hold in view — hundreds of task nodes. On a
   * portfolio of a dozen wide project cards it is a grey block of abstracted rectangles parked over
   * the canvas, telling you nothing the canvas is not already showing. Hosts of the second kind
   * turn it off.
   */
  minimap?: boolean;
  /** When provided, renders an expand affordance that calls this. */
  onExpand?: () => void;
  /** Called when a node is single-clicked (selected), or null when the pane is clicked. */
  onSelectNode?: (id: string | null) => void;
  /** Called when a node is double-clicked (navigate to it). */
  onNavigate?: (id: string) => void;
  /** Overlays rendered inside the flow (e.g. `<Panel>` legend/toolbar/peek). */
  children?: ReactNode;
  /** Extra classes for the canvas container. */
  className?: string;
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
  onConnectEdge,
  onDeleteEdge,
  onReparentEdge,
  children,
  className,
}: CanvasProps): React.JSX.Element {
  // Grouped/swimlane layouts arrive pre-positioned; otherwise dagre lays the flat graph out.
  const dagreLaidOut = useDagreLayout(rawNodes, rawEdges, density, layoutDirection);
  const laidOut = disableLayout ? rawNodes : dagreLaidOut;
  const { nodes, edges, onNodesChange, onEdgesChange } = useControlledFlow(laidOut, rawEdges);

  const interactions = useGraphInteractions({ onConnectEdge, onDeleteEdge, onReparentEdge });
  const highlight = useGraphHighlight(nodes, edges, highlightIds, highlightChains);
  useFitViewOnChange(focusOn, fitMaxZoom);
  const lod = useLodValue();

  return (
    <LodProvider value={lod}>
      <div className={cn('relative h-full min-h-0 w-full', className)}>
        <ReactFlow
          nodes={highlight.nodes}
          edges={highlight.edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, node) => onSelectNode?.(node.id)}
          onNodeDoubleClick={(_, node) => onNavigate?.(node.id)}
          onPaneClick={() => onSelectNode?.(null)}
          onNodeMouseEnter={highlight.onNodeMouseEnter}
          onNodeMouseLeave={highlight.onNodeMouseLeave}
          nodesConnectable={interactive}
          edgesReconnectable={interactive}
          isValidConnection={interactions.isValidConnection}
          onConnect={interactions.onConnect}
          onReconnect={interactions.onReconnect}
          onBeforeDelete={interactions.onBeforeDelete}
          onEdgesDelete={interactions.onEdgesDelete}
          deleteKeyCode={interactive ? ['Delete', 'Backspace'] : null}
          elementsSelectable
          onlyRenderVisibleElements
          fitView
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
          <Controls
            showInteractive={false}
            className="[&_button]:!bg-surface-container-high [&_button]:!fill-on-surface-variant [&_button:hover]:!bg-surface-container-highest overflow-hidden !rounded-lg !shadow-none [&_button]:!border-0"
          />
          {(minimap ?? density === 'full') ? (
            <MiniMap
              pannable
              zoomable
              nodeColor={nodeColor}
              maskColor="color-mix(in srgb, var(--color-surface) 70%, transparent)"
              bgColor="var(--color-surface-container-low)"
              className="!rounded-lg"
            />
          ) : null}
          {children}
        </ReactFlow>
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
