/**
 * `components/canvas/graph-first-frame-viewport` — where the first frame puts the graph.
 *
 * @remarks
 * `fitView` centres a graph in the viewport. A board read left to right, the way a plan is, sits
 * better anchored to the left edge with the spare room on the right, where floating chrome lives.
 * The choice is a pure function of the graph's bounds, the visible area, and the anchor, so the
 * canvas can call it from its framing effect without growing that effect.
 */

/** Which edge the first frame anchors the graph to. */
export type FrameAnchor = 'center' | 'start';

/** A rectangle in graph units. */
export interface FrameBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Pixels kept clear inside the viewport on each side. */
export interface FramePadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** What the first frame needs to know. */
export interface FirstFrameInput {
  /** The graph's extent in graph units. */
  readonly bounds: FrameBounds;
  /** The viewport's size in pixels. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** Pixels kept clear on each side. */
  readonly padding: FramePadding;
  /** The zoom the frame will use. */
  readonly zoom: number;
  readonly anchor: FrameAnchor;
}

/** An xyflow viewport transform. */
export interface FrameViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/**
 * Place the graph at `zoom`: vertically centred in the clear area, and either centred or anchored
 * to the left of it.
 *
 * @param input - Bounds, viewport, padding, zoom, and anchor.
 * @returns the viewport transform to set.
 */
export function computeFirstFrameViewport(input: FirstFrameInput): FrameViewport {
  const { bounds, viewport, padding, zoom, anchor } = input;
  const clearWidth = Math.max(0, viewport.width - padding.left - padding.right);
  const clearHeight = Math.max(0, viewport.height - padding.top - padding.bottom);
  const spareX = Math.max(0, clearWidth - bounds.width * zoom);
  const spareY = Math.max(0, clearHeight - bounds.height * zoom);
  const offsetX = anchor === 'start' ? 0 : spareX / 2;
  return {
    x: padding.left + offsetX - bounds.x * zoom,
    y: padding.top + spareY / 2 - bounds.y * zoom,
    zoom,
  };
}
