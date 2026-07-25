/**
 * `timeline` — the vertical geometry model: row tracks, bar geometry, and pointer targets.
 *
 * @remarks
 * These are **three independent dimensions**, and keeping them independent is a hard architectural
 * rule rather than a stylistic preference. Collapsing them is the classic timeline bug: bar height
 * gets expressed as `rowHeight - padding`, then a taller bar is wanted, so rows grow, and now
 * interaction ergonomics silently drive layout.
 *
 * 1. **Row height** — a single value, uniform across every row in a render, derived only from the
 *    active {@link ViewDisplayState}. Heterogeneous row heights are not representable here: there
 *    is no per-row input to {@link rowHeightFor}, so a row cannot be taller because its subject
 *    happens to carry more content. Uniformity is what makes virtualization measurement-free, what
 *    keeps gridlines and group bands aligned, and what lets the dependency layer route edges from
 *    row *indices* instead of reading the DOM.
 * 2. **Bar height** — a constant, centered within the row track. It does not fill the row and does
 *    not vary with density. That is the decoupling made visible: at `compact` density the track
 *    tightens around the same bar, and a marker-only row or a group summary can occupy an
 *    identical track without any of them reflowing the timeline.
 * 3. **Hit geometry** — the pointer target, which deliberately *exceeds* the drawn bar. Comfortable
 *    grabbing comes from transparent padding and invisible edge zones, never from inflating the
 *    bar or the row, so a modest bar still resizes comfortably including by touch.
 *
 * Every consumer reads geometry through this module; no component hard-codes a pixel height.
 */
import type { ViewDensity, ViewDisplayState } from '@/components/views/field-catalog';

/**
 * The uniform row track height per density, in pixels.
 *
 * @remarks
 * Density is the *only* display option permitted to move this value (see
 * `DISPLAY_GEOMETRY_TOKEN`), and it moves it for every row simultaneously.
 */
const ROW_HEIGHT: Record<ViewDensity, number> = {
  comfortable: 56,
  compact: 40,
};

/** The height of a group band header row, in pixels (also uniform, also density-driven). */
const GROUP_HEADER_HEIGHT: Record<ViewDensity, number> = {
  comfortable: 40,
  compact: 32,
};

/**
 * The drawn bar height, in pixels — a constant, independent of row density.
 *
 * @remarks
 * Sized to seat a single line of label text alongside a progress fill legibly. Because it never
 * varies, a bar looks identical at both densities and only the surrounding air changes.
 */
export const BAR_HEIGHT = 26;

/** The drawn size of a checkpoint marker diamond, in pixels. */
export const MARKER_SIZE = 10;

/**
 * The width of the invisible resize zone at each bar edge, in pixels.
 *
 * @remarks
 * Extends symmetrically across the edge so the target is reachable from just outside the bar as
 * well as just inside it — a bar narrower than twice this value is still resizable because the
 * outer halves remain grabbable.
 */
export const EDGE_HANDLE_WIDTH = 14;

/** The minimum comfortable pointer-target extent, in pixels (touch-target guidance). */
const TOUCH_TARGET_MIN = 44;

/**
 * The uniform row height for the active display options.
 *
 * @remarks
 * Takes no row argument by design — see the module note. This is *the* row height for the whole
 * render.
 *
 * @param display - The active presentation toggles.
 * @returns the row track height in pixels.
 */
export function rowHeightFor(display: ViewDisplayState): number {
  return ROW_HEIGHT[display.density];
}

/**
 * The uniform group-band header height for the active display options.
 *
 * @param display - The active presentation toggles.
 * @returns the group header height in pixels.
 */
export function groupHeaderHeightFor(display: ViewDisplayState): number {
  return GROUP_HEADER_HEIGHT[display.density];
}

/**
 * The vertical extent of a bar's pointer target, in pixels.
 *
 * @remarks
 * Grows the drawn bar toward the comfortable touch minimum, but never past the row track — a hit
 * area that spilled into neighbouring rows would make the wrong bar respond to a drag.
 *
 * @param display - The active presentation toggles.
 * @returns the pointer-target height in pixels.
 */
export function hitHeightFor(display: ViewDisplayState): number {
  return Math.min(TOUCH_TARGET_MIN, rowHeightFor(display));
}

/**
 * The vertical inset that centers the drawn bar within its row track.
 *
 * @param display - The active presentation toggles.
 * @returns the offset from the row's top edge to the bar's top edge, in pixels.
 */
export function barInsetFor(display: ViewDisplayState): number {
  return (rowHeightFor(display) - BAR_HEIGHT) / 2;
}

/**
 * The vertical center of a bar's row track, measured from the top of the row.
 *
 * @remarks
 * The anchor the dependency layer routes edges through, so waypoints stay a pure function of row
 * index and display options.
 *
 * @param display - The active presentation toggles.
 * @returns the row's vertical midpoint in pixels.
 */
export function rowCenterFor(display: ViewDisplayState): number {
  return rowHeightFor(display) / 2;
}
