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
  /** Covered from the bottom, by the viewport toolbar, a notice, and the minimap. */
  readonly bottom?: number;
}

/**
 * The gap floating chrome keeps from the canvas edge and from each other.
 *
 * @remarks
 * The shell's main surface rounds at 16px and floating chrome at 10px, so an 8px gap keeps the
 * two curves nested where a bar or a column sits in the surface's corner, and the chrome's 2px
 * padding leaves its 8px controls concentric with it.
 */
export const CANVAS_OVERLAY_GUTTER = 8;

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

/** What floating chrome covers from the bottom, 0 when nothing does. */
export function insetBottom(insets: CanvasOverlayInsets): number {
  return insets.bottom ?? 0;
}

/** One floating part on the right edge: whether it is open, and how wide it is when open. */
export interface OccludingPart {
  readonly open: boolean;
  readonly width: number;
}

/**
 * The fit padding for a canvas with these insets: the base gutter on every side, plus the covered
 * distance on the top, right, and bottom.
 *
 * @param insets - What floating chrome covers.
 * @param base - The gutter kept clear inside the visible area on every side.
 * @returns the padding to hand to `fitView`.
 */
export function fitPaddingFor(insets: CanvasOverlayInsets = {}, base = 24): FitPadding {
  return {
    top: px(base + insetTop(insets)),
    right: px(base + insetRight(insets)),
    bottom: px(base + insetBottom(insets)),
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

/** The height left for the graph once the gutter and the top and bottom chrome are taken. */
export function availableCanvasHeight(
  clientHeight: number,
  insets: CanvasOverlayInsets = {},
  pad = 24,
): number {
  return Math.max(1, clientHeight - pad * 2 - insetTop(insets) - insetBottom(insets));
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
