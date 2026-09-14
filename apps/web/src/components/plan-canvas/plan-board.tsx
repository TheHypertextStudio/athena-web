'use client';

/**
 * `components/plan-canvas/plan-board` — the canvas a plan is drawn on.
 *
 * @remarks
 * A thin composition over the shared `Canvas`: the plan's node and edge renderers, its dot grid,
 * a frame anchored to the board's left edge and kept clear of the floating chrome, and the start
 * overlay while there is no board to read. Everything it does on a gesture comes in as a callback.
 */
import type { Edge, Node, OnNodeDrag, ReactFlowInstance } from '@xyflow/react';
import type { JSX } from 'react';

import Canvas from '@/components/canvas/canvas';
import type { CanvasOverlayInsets } from '@/components/canvas/canvas-viewport-insets';
import DependencyEdge from '@/components/canvas/dependency-edge';

import PlanInitiativeNode from './plan-initiative-node';
import { PLAN_MAX_PER_COLUMN } from './plan-layout';
import PlanLinkEdge from './plan-link-edge';
import { PLAN_EDGE_TYPE, PLAN_NODE_TYPE } from './plan-nodes';
import { PlanStartOverlay } from './plan-panel-overlays';
import { PLAN_DOT_GRID, type PlanStartState, nodeColor } from './plan-panel-support';
import PlanProjectNode from './plan-project-node';
import PlanTaskNode from './plan-task-node';
import type { PlanSearchView } from './use-plan-view';

/** The registered node renderers. */
const NODE_TYPES = {
  [PLAN_NODE_TYPE.initiative]: PlanInitiativeNode,
  [PLAN_NODE_TYPE.project]: PlanProjectNode,
  [PLAN_NODE_TYPE.task]: PlanTaskNode,
};

/** The registered edge renderers: the shared dependency edge and the quiet membership link. */
const EDGE_TYPES = {
  [PLAN_EDGE_TYPE.dependency]: DependencyEdge,
  [PLAN_EDGE_TYPE.link]: PlanLinkEdge,
};

/** Props for {@link PlanBoard}. */
export interface PlanBoardProps {
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly canEdit: boolean;
  readonly insets: CanvasOverlayInsets;
  readonly layoutReady: boolean;
  /** How many containers the board holds; past one column it earns a minimap. */
  readonly projectCount: number;
  readonly search: PlanSearchView;
  readonly startState: PlanStartState;
  readonly onAddProject: (() => void) | null;
  readonly onSelectionChange: (ids: readonly string[]) => void;
  readonly onSelectNode: (ref: string | null) => void;
  readonly onNavigate: (ref: string) => void;
  readonly onConnectEdge: (source: string, target: string) => void;
  readonly onDeleteEdge: (edge: Edge) => void;
  readonly onNodeDragStop: OnNodeDrag;
  readonly onInit: (instance: ReactFlowInstance) => void;
  readonly onRelayout: () => void;
  readonly bottomNotice: JSX.Element | undefined;
}

/** The plan's canvas. */
export function PlanBoard(props: PlanBoardProps): JSX.Element {
  return (
    <Canvas
      nodes={props.nodes}
      edges={props.edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      density="full"
      disableLayout
      layoutReady={props.layoutReady}
      overlayInsets={props.insets}
      frameAnchor="start"
      dotGrid={PLAN_DOT_GRID}
      onSelectionChange={props.onSelectionChange}
      interactive={props.canEdit}
      highlightChains={false}
      highlightIds={props.search.highlightIds}
      nodeColor={nodeColor}
      minimap={props.projectCount > PLAN_MAX_PER_COLUMN}
      focusOn={props.search.focusOn}
      onSelectNode={props.onSelectNode}
      onNavigate={props.onNavigate}
      onConnectEdge={props.onConnectEdge}
      onDeleteEdge={props.onDeleteEdge}
      onNodeDragStop={props.onNodeDragStop}
      onInit={props.onInit}
      onRelayout={props.onRelayout}
      bottomNotice={props.bottomNotice}
    >
      <PlanStartOverlay state={props.startState} onAddProject={props.onAddProject} />
    </Canvas>
  );
}
