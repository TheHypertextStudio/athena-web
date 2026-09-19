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
  COMPONENT_GAP,
  componentEdgeSignature,
  type GraphLayoutComponent,
  type GraphLayoutDiagnostics,
  type GraphLayoutOptions,
  type GraphLayoutPoint,
  type GraphLayoutResult,
  layoutComponent,
  type LocalComponent,
  type MeasuredGraphNode,
  primaryComponentOf,
  type ProjectedGraphEdge,
  weakComponents,
} from './graph-layout-engine';

/** A component classified against the previous layout and positioned in the packing order. */
interface StagedComponent {
  readonly local: LocalComponent;
  readonly anchorId: string;
  readonly edgeSignature: string;
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

/** A component's own geometry and the signature that decided whether it was reused. */
interface ClassifiedComponent {
  readonly local: LocalComponent;
  readonly edgeSignature: string;
}

/** The packing slot a component inherits from the previous layout. */
interface InheritedSlot {
  readonly slot: number;
  readonly holdsParentAnchor: boolean;
}

/** Component origins from one fixed-row walk and the bounds they span. */
interface FixedRowPacking {
  readonly origins: readonly GraphLayoutPoint[];
  readonly width: number;
  readonly height: number;
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
  edges: readonly ProjectedGraphEdge[],
  options: GraphLayoutOptions,
  byId: ReadonlyMap<string, MeasuredGraphNode>,
  prior: GraphLayoutComponent | undefined,
): ClassifiedComponent {
  const edgeSignature = componentEdgeSignature(nodeIds, edges, options.direction);
  if (prior?.edgeSignature === edgeSignature) {
    return {
      edgeSignature,
      local: {
        nodeIds,
        positions: prior.localPositions,
        width: prior.bounds.width,
        height: prior.bounds.height,
      },
    };
  }
  const members = nodeIds.flatMap((id) => {
    const node = byId.get(id);
    return node === undefined ? [] : [node];
  });
  return { edgeSignature, local: layoutComponent(members, edges, options.direction) };
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

/** Walk rows with a fixed count per row; the same walk as the engine's packer without scoring. */
function packFixedRows(components: readonly LocalComponent[], perRow: number): FixedRowPacking {
  const origins: GraphLayoutPoint[] = [];
  let y = 0;
  let width = 0;
  for (let start = 0; start < components.length; start += perRow) {
    const row = components.slice(start, start + perRow);
    let x = 0;
    let rowHeight = 0;
    for (const component of row) {
      origins.push({ x, y });
      x += component.width + COMPONENT_GAP;
      rowHeight = Math.max(rowHeight, component.height);
    }
    width = Math.max(width, x - COMPONENT_GAP);
    y += rowHeight + COMPONENT_GAP;
  }
  return { origins, width: Math.max(width, 0), height: Math.max(y - COMPONENT_GAP, 0) };
}

function stageComponents(
  nodes: readonly MeasuredGraphNode[],
  edges: readonly ProjectedGraphEdge[],
  options: GraphLayoutOptions,
  previous: GraphLayoutResult,
): StagedComponent[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const index = indexPrevious(previous);
  return weakComponents(nodes, edges)
    .map((nodeIds, sourceIndex) => {
      const prior = index.byMemberKey.get(memberKey(nodeIds));
      const { local, edgeSignature } = localComponentFor(nodeIds, edges, options, byId, prior);
      return {
        local,
        edgeSignature,
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
  const started = performance.now();
  const staged = stageComponents(nodes, edges, options, previous);
  const perRow = Math.max(1, previous.packing.perRow);
  const packed = packFixedRows(
    staged.map(({ local }) => local),
    perRow,
  );
  const positions = new Map<string, GraphLayoutPoint>();
  const components = staged.map(({ local, anchorId, edgeSignature }, index) => {
    const origin = packed.origins[index] ?? { x: 0, y: 0 };
    for (const [id, position] of local.positions) {
      positions.set(id, { x: position.x + origin.x, y: position.y + origin.y });
    }
    return {
      nodeIds: local.nodeIds,
      bounds: { x: origin.x, y: origin.y, width: local.width, height: local.height },
      anchorId,
      edgeSignature,
      localPositions: local.positions,
    };
  });
  const bounds = { x: 0, y: 0, width: packed.width, height: packed.height };
  const occupiedArea = staged.reduce((area, { local }) => area + local.width * local.height, 0);
  const packedArea = packed.width * packed.height;
  const diagnostics: GraphLayoutDiagnostics = {
    nodeCount: nodes.length,
    componentCount: components.length,
    durationMs: performance.now() - started,
    bounds,
    packingDensity: packedArea === 0 ? 0 : occupiedArea / packedArea,
  };
  return {
    positions,
    components,
    bounds,
    primary: primaryComponentOf(components, edges, bounds),
    diagnostics,
    packing: { perRow, order: components.map(({ anchorId }) => anchorId) },
  };
}
