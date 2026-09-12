/**
 * `components/canvas/canvas-viewport-insets` — how much of the canvas floating chrome covers.
 *
 * @remarks
 * A canvas that runs edge to edge under a floating bar and floating panels still has to frame its
 * graph in the part a person can see. Every number that turns "a panel is open" into "this much
 * of the right edge is spoken for" lives here, pure and tested, so the fit padding, the initial
 * frame, and the bottom chrome all agree.
 */

/** Pixels of the canvas covered by floating chrome, per edge. */
export interface CanvasOverlayInsets {
  /** Covered from the top, e.g. by a floating bar. */
  readonly top?: number;
  /** Covered from the right, e.g. by a floating inspector or conversation. */
  readonly right?: number;
}

/** The gap floating chrome keeps from the canvas edge and from each other. */
export const CANVAS_OVERLAY_GUTTER = 12;

/** A CSS pixel length, the unit form xyflow's `fitView` padding accepts. */
export type PixelLength = `${number}px`;

/** Padding in the CSS-length form xyflow's `fitView` accepts. */
export interface FitPadding {
  readonly top: PixelLength;
  readonly right: PixelLength;
  readonly bottom: PixelLength;
  readonly left: PixelLength;
}

/** A number of pixels as the CSS length xyflow accepts. */
function px(value: number): PixelLength {
  return `${String(value)}px` as PixelLength;
}

/** What floating chrome covers from the top, 0 when nothing does. */
export function insetTop(insets: CanvasOverlayInsets): number {
  return insets.top ?? 0;
}

/** What floating chrome covers from the right, 0 when nothing does. */
export function insetRight(insets: CanvasOverlayInsets): number {
  return insets.right ?? 0;
}

/** One floating part on the right edge: whether it is open, and how wide it is when open. */
export interface OccludingPart {
  readonly open: boolean;
  readonly width: number;
}

/**
 * The fit padding for a canvas with these insets: the base gutter on every side, plus the covered
 * distance on the top and right.
 *
 * @param insets - What floating chrome covers.
 * @param base - The gutter kept clear inside the visible area on every side.
 * @returns the padding to hand to `fitView`.
 */
export function fitPaddingFor(insets: CanvasOverlayInsets = {}, base = 24): FitPadding {
  return {
    top: px(base + insetTop(insets)),
    right: px(base + insetRight(insets)),
    bottom: px(base),
    left: px(base),
  };
}

/** The width left for the graph once the gutter and the right-edge chrome are taken. */
export function availableCanvasWidth(
  clientWidth: number,
  insets: CanvasOverlayInsets = {},
  pad = 24,
): number {
  return Math.max(1, clientWidth - pad * 2 - insetRight(insets));
}

/** The height left for the graph once the gutter and the top chrome are taken. */
export function availableCanvasHeight(
  clientHeight: number,
  insets: CanvasOverlayInsets = {},
  pad = 24,
): number {
  return Math.max(1, clientHeight - pad * 2 - insetTop(insets));
}

/**
 * How far the right edge is covered by a row of floating parts, each followed by the gutter.
 *
 * @param parts - The parts from the edge inward.
 * @param gutter - The gap after each open part.
 * @returns the covered distance, 0 when nothing is open.
 */
export function occludedRight(
  parts: readonly OccludingPart[],
  gutter = CANVAS_OVERLAY_GUTTER,
): number {
  return parts.reduce((sum, part) => (part.open ? sum + part.width + gutter : sum), 0);
}
