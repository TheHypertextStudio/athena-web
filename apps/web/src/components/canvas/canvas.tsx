'use client';

/**
 * `components/canvas/canvas` — a generic, dataset-agnostic infinite canvas.
 *
 * @remarks
 * Wraps `@xyflow/react` with pan/zoom, a dagre layout pass, and (at full density) a minimap +
 * controls. It knows nothing about tasks — callers pass xyflow `nodes`/`edges` plus a `nodeTypes`
 * map, so the same canvas renders any graph. Interaction is opt-in via callbacks: drag between
 * handles to create an edge (`onConnectEdge`), select an edge + Delete to remove it
 * (`onDeleteEdge`), single-click to select (`onSelectNode`), double-click to `onNavigate`. Hovering
 * or selecting a node lights its connected chain and dims the rest. Hosts inject overlays (legend,
 * toolbar, peek) as `children` (rendered inside the flow, e.g. `<Panel>`). Incoming graph changes
 * apply inside a View Transition so shared nodes morph between arrangements.
 */
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeTypes,
  type OnBeforeDelete,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { stateTypeOf } from '@/lib/work-state';
import { startViewTransition } from '@/lib/view-transition';

import { type CanvasDensity, type LayoutDirection, useDagreLayout } from './use-dagre-layout';

/** Props for {@link Canvas}. */
export interface CanvasProps {
  /** Unpositioned nodes; the canvas lays them out with dagre. */
  nodes: Node[];
  /** Directed edges between nodes. */
  edges: Edge[];
  /** Custom node renderers keyed by node `type`. */
  nodeTypes?: NodeTypes;
  /** `compact` for small embeds (no minimap), `full` for the focused view. Default `full`. */
  density?: CanvasDensity;
  /** Layout flow direction (dagre rankdir). Default `LR`. */
  layoutDirection?: LayoutDirection;
  /** When true, handles are connectable and dependency edges are deletable. */
  interactive?: boolean;
  /** When provided, renders an expand affordance that calls this. */
  onExpand?: () => void;
  /** Called when a node is single-clicked (selected), or null when the pane is clicked. */
  onSelectNode?: (id: string | null) => void;
  /** Called when a node is double-clicked (navigate to it). */
  onNavigate?: (id: string) => void;
  /** Called when the user drags a connection between two nodes (create a dependency edge). */
  onConnectEdge?: (source: string, target: string) => void;
  /** Called for each dependency edge the user deletes. */
  onDeleteEdge?: (edge: Edge) => void;
  /** Overlays rendered inside the flow (e.g. `<Panel>` legend/toolbar/peek). */
  children?: ReactNode;
  /** Extra classes for the canvas container. */
  className?: string;
}

/** A structural+data signature so we re-sync xyflow state only when the graph changes. */
function graphSignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  return `${nodes.map((n) => `${n.id}:${JSON.stringify(n.data)}`).join('|')}::${edges
    .map((e) => e.id)
    .join('|')}`;
}

/** Add a value to a Map-of-arrays bucket. */
function pushTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** All node ids reachable from `id` along edges in either direction (its dependency chain). */
function relatedIds(id: string, edges: readonly Edge[]): Set<string> {
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const e of edges) {
    pushTo(out, e.source, e.target);
    pushTo(inn, e.target, e.source);
  }
  const seen = new Set<string>([id]);
  const walk = (adj: Map<string, string[]>): void => {
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined) continue;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  };
  walk(out);
  walk(inn);
  return seen;
}

/** Minimap node color by workflow-state type (uses the `--color-state-*` tokens). */
function miniMapNodeColor(node: Node): string {
  const state = (node.data as { state?: string }).state;
  const type = typeof state === 'string' ? stateTypeOf(state) : 'backlog';
  return `var(--color-state-${type})`;
}

/** The inner canvas; must live under a {@link ReactFlowProvider}. */
function CanvasInner({
  nodes: rawNodes,
  edges: rawEdges,
  nodeTypes,
  density = 'full',
  layoutDirection = 'LR',
  interactive = false,
  onExpand,
  onSelectNode,
  onNavigate,
  onConnectEdge,
  onDeleteEdge,
  children,
  className,
}: CanvasProps): React.JSX.Element {
  const laidOut = useDagreLayout(rawNodes, rawEdges, density, layoutDirection);
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);
  const { getEdges } = useReactFlow();
  const [focusId, setFocusId] = useState<string | null>(null);

  // Re-sync xyflow's internal state when the incoming graph changes, morphing via a View
  // Transition. The effect only fires on a genuine graph change, so pan/drag stays uninterrupted.
  const signature = useMemo(() => graphSignature(laidOut, rawEdges), [laidOut, rawEdges]);
  const prevSignature = useRef(signature);
  useEffect(() => {
    if (prevSignature.current === signature) return;
    prevSignature.current = signature;
    startViewTransition(() => {
      setNodes(laidOut);
      setEdges(rawEdges);
    });
  }, [signature, laidOut, rawEdges, setNodes, setEdges]);

  // Reject obvious bad connections client-side; the server is the cycle/duplicate authority.
  const isValidConnection = useCallback(
    (c: Connection | Edge): boolean => {
      if (c.source === c.target) return false;
      return !getEdges().some((e) => e.source === c.source && e.target === c.target);
    },
    [getEdges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source !== c.target) onConnectEdge?.(c.source, c.target);
    },
    [onConnectEdge],
  );

  // Only dependency edges are deletable (no reparent API for subtask edges); nodes never delete.
  const onBeforeDelete = useCallback<OnBeforeDelete>(async ({ edges: toDelete }) => {
    const deletable = toDelete.filter((e) => (e.data as { kind?: string }).kind !== 'subtask');
    if (deletable.length === 0) return false;
    return { nodes: [], edges: deletable };
  }, []);

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const e of deleted) onDeleteEdge?.(e);
    },
    [onDeleteEdge],
  );

  // Hover/selection chain highlight: dim everything off the focused node's chain.
  const display = useMemo(() => {
    if (focusId === null) return { nodes, edges };
    const related = relatedIds(focusId, edges);
    const dim = (on: boolean) => (on ? undefined : 'opacity-20 transition-opacity duration-200');
    return {
      nodes: nodes.map((n) => ({ ...n, className: cn(n.className, dim(related.has(n.id))) })),
      edges: edges.map((e) => ({
        ...e,
        className: cn(e.className, dim(related.has(e.source) && related.has(e.target))),
      })),
    };
  }, [nodes, edges, focusId]);

  return (
    <div className={cn('relative h-full min-h-0 w-full', className)}>
      <ReactFlow
        nodes={display.nodes}
        edges={display.edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectNode?.(node.id)}
        onNodeDoubleClick={(_, node) => onNavigate?.(node.id)}
        onPaneClick={() => onSelectNode?.(null)}
        onNodeMouseEnter={(_, node) => {
          setFocusId(node.id);
        }}
        onNodeMouseLeave={() => {
          setFocusId(null);
        }}
        nodesConnectable={interactive}
        isValidConnection={isValidConnection}
        onConnect={onConnect}
        onBeforeDelete={onBeforeDelete}
        onEdgesDelete={onEdgesDelete}
        deleteKeyCode={interactive ? ['Delete', 'Backspace'] : null}
        elementsSelectable
        onlyRenderVisibleElements
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} className="!bg-surface" />
        <Controls showInteractive={false} />
        {density === 'full' ? (
          <MiniMap
            pannable
            zoomable
            nodeColor={miniMapNodeColor}
            maskColor="color-mix(in srgb, var(--color-surface) 70%, transparent)"
            bgColor="var(--color-surface-container)"
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
          className="border-outline-variant bg-surface-container text-on-surface-variant hover:text-on-surface absolute top-2 right-2 z-10 inline-flex size-8 items-center justify-center rounded-md border shadow-sm transition-colors"
        >
          <Maximize className="size-4" />
        </button>
      ) : null}
    </div>
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
