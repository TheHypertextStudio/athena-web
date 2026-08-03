/**
 * `components/canvas/pack-isolated` — where to put the nodes that have no edges.
 *
 * @remarks
 * A layered DAG layout has nothing to say about a node with no edges, so dagre assigns every one
 * of them to rank 0 and stacks them in a single column. On a real portfolio, where most projects
 * depend on nothing, that column is the tallest thing on the canvas: twenty cards in a 700px
 * viewport force `fitView` down to a third of life size, and the handful of *connected* cards —
 * the entire reason the lens exists — end up as unreadable specks off to one side.
 *
 * Packing those nodes into a compact block instead trades a dimension the layout was not using
 * (horizontal, below the graph) for one it was starved of (vertical). The block's aspect ratio is
 * matched to the connected cluster's, so the two together stay close to the viewport's shape and
 * `fitView` has something square-ish to fit.
 *
 * The block sits **below** the graph, in the incoming order. Unconnected work is still portfolio
 * work and must remain visible and selectable; it is simply not part of any chain, and reading the
 * chains first is the point of the lens.
 */
import type { Node } from '@xyflow/react';

/** The gap between packed cards, in canvas units. */
const PACK_GAP = 24;
/** The gap between the connected cluster and the packed block, in canvas units. */
const BLOCK_GAP = 96;
/** The fewest columns the block is packed into, so two stray cards do not become one long row. */
const MIN_COLUMNS = 3;

/** A node's rendered box, for packing arithmetic. */
export interface PackNodeSize {
  /** Card width in canvas units. */
  readonly width: number;
  /** Card height in canvas units. */
  readonly height: number;
}

/** The bounding box of a set of positioned nodes, or `null` when there are none. */
function boundsOf(
  nodes: readonly Node[],
  size: PackNodeSize,
): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} | null {
  if (nodes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * How many columns to pack `count` cards into, given the width the graph already occupies.
 *
 * @remarks
 * Prefers filling the width the connected cluster already established — the block then reads as
 * part of the same drawing rather than as a separate object — but never goes narrower than
 * {@link MIN_COLUMNS} or wider than the square root of the count, which is what keeps the block
 * from becoming the long row it is trying to stop being.
 */
function columnsFor(count: number, availableWidth: number, size: PackNodeSize): number {
  const byWidth = Math.floor((availableWidth + PACK_GAP) / (size.width + PACK_GAP));
  const square = Math.ceil(Math.sqrt(count));
  return Math.max(MIN_COLUMNS, Math.min(Math.max(byWidth, MIN_COLUMNS), Math.max(square, 1)));
}

/**
 * Position the edgeless nodes as a block beneath the laid-out graph.
 *
 * @remarks
 * Pure: takes already-positioned connected nodes and unpositioned isolated ones, returns one array
 * ready for a canvas rendering with layout disabled. Handle sides are copied from the connected
 * nodes so a packed card can still be wired into the graph by dragging from its handle.
 *
 * @param connected - Nodes the layout engine has already positioned.
 * @param isolated - Nodes with no edges, in the order they should appear.
 * @param size - The rendered card box.
 * @returns every node, positioned.
 */
export function packIsolatedNodes(
  connected: readonly Node[],
  isolated: readonly Node[],
  size: PackNodeSize,
): Node[] {
  if (isolated.length === 0) return [...connected];

  const bounds = boundsOf(connected, size);
  const originX = bounds?.minX ?? 0;
  const originY = bounds === null ? 0 : bounds.maxY + BLOCK_GAP;
  const available =
    bounds === null ? size.width * 4 : Math.max(bounds.maxX - bounds.minX, size.width);
  const columns = columnsFor(isolated.length, available, size);

  const sample = connected[0];
  const packed = isolated.map((node, index) => ({
    ...node,
    position: {
      x: originX + (index % columns) * (size.width + PACK_GAP),
      y: originY + Math.floor(index / columns) * (size.height + PACK_GAP),
    },
    ...(sample?.sourcePosition ? { sourcePosition: sample.sourcePosition } : {}),
    ...(sample?.targetPosition ? { targetPosition: sample.targetPosition } : {}),
  }));

  return [...connected, ...packed];
}
