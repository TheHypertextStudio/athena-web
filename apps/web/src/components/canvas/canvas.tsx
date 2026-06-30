'use client';

/**
 * `components/canvas/canvas` — a generic, dataset-agnostic infinite canvas.
 *
 * @remarks
 * Wraps `@xyflow/react` with pan/zoom, a dagre layout pass, and (at full density) a minimap +
 * controls. It knows nothing about tasks — callers pass xyflow `nodes`/`edges` plus a
 * `nodeTypes` map, so the same canvas renders any graph. The host decides what `onExpand`
 * does (navigate to the focused route, maximize in place); the canvas only surfaces the
 * affordance. Incoming graph changes are applied inside a View Transition so shared nodes
 * (those carrying a stable `view-transition-name`) morph between arrangements.
 */
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Maximize } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { useEffect, useMemo, useRef } from 'react';

import { startViewTransition } from '@/lib/view-transition';

import { type CanvasDensity, useDagreLayout } from './use-dagre-layout';

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
  /** When provided, renders an expand affordance that calls this. */
  onExpand?: () => void;
  /** Called with a node id when a node is clicked. */
  onNodeClick?: (id: string) => void;
  /** Extra classes for the canvas container. */
  className?: string;
}

/** A structural+data signature so we re-sync xyflow state only when the graph changes. */
function graphSignature(nodes: readonly Node[], edges: readonly Edge[]): string {
  return `${nodes.map((n) => `${n.id}:${JSON.stringify(n.data)}`).join('|')}::${edges
    .map((e) => e.id)
    .join('|')}`;
}

/** The inner canvas; must live under a {@link ReactFlowProvider}. */
function CanvasInner({
  nodes: rawNodes,
  edges: rawEdges,
  nodeTypes,
  density = 'full',
  onExpand,
  onNodeClick,
  className,
}: CanvasProps): React.JSX.Element {
  const laidOut = useDagreLayout(rawNodes, rawEdges, density);
  const [nodes, setNodes, onNodesChange] = useNodesState(laidOut);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  // Re-sync xyflow's internal state when the incoming graph changes, morphing via a View
  // Transition (no-op fallback where unsupported). User-driven pan/drag stays uninterrupted
  // because the effect only fires on a genuine graph change, not every render.
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

  return (
    <div className={cn('relative h-full min-h-0 w-full', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        nodesConnectable={false}
        elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} gap={20} className="!bg-surface" />
        <Controls showInteractive={false} />
        {density === 'full' ? (
          <MiniMap pannable zoomable className="!bg-surface-container !rounded-lg" />
        ) : null}
      </ReactFlow>
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand graph"
          className="absolute right-2 top-2 z-10 inline-flex size-8 items-center justify-center rounded-md border border-outline-variant bg-surface-container text-on-surface-variant shadow-sm transition-colors hover:text-on-surface"
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
