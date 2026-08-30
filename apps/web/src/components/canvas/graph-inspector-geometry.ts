/**
 * `components/canvas/graph-inspector-geometry` — the pan the canvas makes when the inspector docks.
 *
 * @remarks
 * Docking the inspector takes ~300px off the right of the canvas viewport, which can leave the node
 * the user just selected sitting underneath it. The obvious fix — `fitView()` — is the wrong one:
 * it discards the pan and zoom the user chose, and on a graph that pan *is* the reading position.
 * Re-framing the whole graph because a panel opened is a bigger change than the one the user asked
 * for.
 *
 * So the canvas makes the **smallest** horizontal move that keeps the selected node visible, and
 * never touches zoom. If the node is already in the clear, it makes no move at all.
 *
 * Pure and separately tested because the alternative is verifying a translation by looking at it.
 */

/** Inputs for {@link keepNodeInViewDeltaX}. */
export interface KeepNodeInViewArgs {
  /** The node's x in flow coordinates. */
  readonly nodeX: number;
  /** The node's rendered width in flow coordinates. */
  readonly nodeWidth: number;
  /** The viewport's current zoom. */
  readonly zoom: number;
  /** The viewport's current x translation. */
  readonly viewportX: number;
  /** How much of the canvas is still visible once the inspector has taken its column. */
  readonly visibleWidth: number;
  /** Breathing room to leave between the node and either edge of the visible region. */
  readonly margin: number;
}

/**
 * The x translation that brings a node back inside the still-visible canvas.
 *
 * @remarks
 * A node too wide to fit between the margins is aligned to the left edge rather than centred: its
 * leading edge is where its title and status live, so that is the half worth keeping.
 *
 * @param args - See {@link KeepNodeInViewArgs}.
 * @returns The delta to add to `viewportX`. `0` when the node already fits, which is the common
 *   case and must stay a genuine no-op rather than a zero-length animation.
 */
export function keepNodeInViewDeltaX({
  nodeX,
  nodeWidth,
  zoom,
  viewportX,
  visibleWidth,
  margin,
}: KeepNodeInViewArgs): number {
  const left = viewportX + nodeX * zoom;
  const right = left + nodeWidth * zoom;
  const limit = visibleWidth - margin;

  if (right - left > limit - margin) return margin - left;
  if (right > limit) return limit - right;
  if (left < margin) return margin - left;
  return 0;
}
