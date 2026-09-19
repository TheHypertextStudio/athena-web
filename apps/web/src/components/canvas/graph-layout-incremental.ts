/**
 * `components/canvas/graph-layout-incremental` — re-lay out only the components an edit touched.
 *
 * @remarks
 * The full engine re-runs Dagre for every component and re-scores every row count whenever one
 * edge changes, so most cards move after a single dependency edit. This module takes the previous
 * result as the frame of reference: a component whose members and induced edges are unchanged
 * reuses its geometry, a changed one is laid out on its own, and the row packing keeps the previous
 * `perRow` and order so only the cards to the right of and below a resized component move, and
 * only by the size delta. A full repack is the caller's decision (no previous result, an explicit
 * re-layout, or a coarse aspect-bucket change).
 */
import {
  assembleLayoutResult,
  type ComponentEdges,
  componentEdgesOf,
  type GraphLayoutComponent,
  type GraphLayoutOptions,
  type GraphLayoutResult,
  layoutComponent,
  type LocalComponent,
  type MeasuredGraphNode,
  membersOf,
  packRows,
  type ProjectedGraphEdge,
  type StagedLayoutComponent,
  weakComponents,
} from './graph-layout-engine';

/** A component classified against the previous layout and positioned in the packing order. */
interface StagedComponent extends StagedLayoutComponent {
  /** Previous packing slot inherited from the earliest parent, or `Infinity` for a new component. */
  readonly slot: number;
  /** Whether the component carries the anchor of the parent whose slot it inherited. */
  readonly holdsParentAnchor: boolean;
  /** Source order, the final tie-breaker. */
  readonly sourceIndex: number;
}

/** Where each member lived in the previous layout. */
interface PreviousIndex {
  readonly byMemberKey: ReadonlyMap<string, GraphLayoutComponent>;
  readonly componentByMember: ReadonlyMap<string, GraphLayoutComponent>;
  readonly slotByAnchor: ReadonlyMap<string, number>;
}

/** The packing slot a component inherits from the previous layout. */
interface InheritedSlot {
  readonly slot: number;
  readonly holdsParentAnchor: boolean;
}

function memberKey(nodeIds: readonly string[]): string {
  return [...nodeIds].sort().join(',');
}

function indexPrevious(previous: GraphLayoutResult): PreviousIndex {
  return {
    byMemberKey: new Map(previous.components.map((c) => [memberKey(c.nodeIds), c])),
    componentByMember: new Map(
      previous.components.flatMap((c) => c.nodeIds.map((id) => [id, c] as const)),
    ),
    slotByAnchor: new Map(previous.packing.order.map((anchorId, index) => [anchorId, index])),
  };
}

/** Reuse the previous geometry when nothing inside the component changed; otherwise run Dagre. */
function localComponentFor(
  nodeIds: readonly string[],
  componentEdges: ComponentEdges,
  options: GraphLayoutOptions,
  byId: ReadonlyMap<string, MeasuredGraphNode>,
  prior: GraphLayoutComponent | undefined,
): LocalComponent {
  if (prior?.edgeSignature === componentEdges.signature) {
    return {
      nodeIds,
      positions: prior.localPositions,
      width: prior.bounds.width,
      height: prior.bounds.height,
    };
  }
  return layoutComponent(membersOf(nodeIds, byId), componentEdges.induced, options.direction);
}

/**
 * Find the earliest previous slot among the parents of a component's members.
 *
 * @remarks
 * A merged component inherits the earliest slot of its parents. A split-off piece shares its
 * parent's slot with its siblings, and the piece holding the parent's anchor sorts first among
 * them so it stays where the parent was.
 */
function inheritedSlot(nodeIds: readonly string[], previous: PreviousIndex): InheritedSlot {
  let slot = Number.POSITIVE_INFINITY;
  let parentAnchor: string | null = null;
  for (const id of nodeIds) {
    const parent = previous.componentByMember.get(id);
    if (parent === undefined) continue;
    const parentSlot = previous.slotByAnchor.get(parent.anchorId) ?? Number.POSITIVE_INFINITY;
    if (parentSlot < slot) {
      slot = parentSlot;
      parentAnchor = parent.anchorId;
    }
  }
  return { slot, holdsParentAnchor: parentAnchor !== null && nodeIds.includes(parentAnchor) };
}

function compareStaged(left: StagedComponent, right: StagedComponent): number {
  if (left.slot !== right.slot) return left.slot - right.slot;
  if (left.holdsParentAnchor !== right.holdsParentAnchor) return left.holdsParentAnchor ? -1 : 1;
  return left.sourceIndex - right.sourceIndex;
}

function stageComponents(
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  options: GraphLayoutOptions,
  previous: GraphLayoutResult,
): StagedComponent[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const index = indexPrevious(previous);
  const components = weakComponents(nodes, edges);
  const componentEdges = componentEdgesOf(components, edges, options.direction);
  return components
    .map((nodeIds, sourceIndex): StagedComponent => {
      const edgesOfComponent = componentEdges[sourceIndex] ?? { induced: [], signature: '' };
      const prior = index.byMemberKey.get(memberKey(nodeIds));
      return {
        local: localComponentFor(nodeIds, edgesOfComponent, options, byId, prior),
        edgeSignature: edgesOfComponent.signature,
        anchorId: nodeIds[0] ?? '',
        sourceIndex,
        ...inheritedSlot(nodeIds, index),
      };
    })
    .sort(compareStaged);
}

/**
 * Lay out measured objects against a previous result so unchanged components keep their geometry.
 *
 * @param nodes - Measured top-level objects in stable source order.
 * @param edges - Projected edges.
 * @param options - Rank direction and coarse aspect ratio (the aspect is carried, not re-scored).
 * @param previous - The result the canvas currently shows.
 * @returns A result whose packing reuses `previous.packing.perRow` and the previous slot order.
 */
export function layoutMeasuredGraphIncrementally(
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  options: GraphLayoutOptions,
  previous: GraphLayoutResult,
): GraphLayoutResult {
  const startedAt = performance.now();
  const staged = stageComponents(nodes, edges, options, previous);
  const perRow = Math.max(1, previous.packing.perRow);
  const packed = packRows(
    staged.map(({ local }) => local),
    perRow,
  );
  return assembleLayoutResult({
    nodeCount: nodes.length,
    staged,
    packed,
    perRow,
    edges,
    startedAt,
  });
}
