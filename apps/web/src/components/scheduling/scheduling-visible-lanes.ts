import type { ScheduleLane } from './scheduling-types';

/**
 * Sub-pixel slack absorbed when deciding which lane sits at the scrolled-to edge.
 *
 * @remarks
 * The viewport is deliberately scrolled to an exact `laneIndex * laneWidth` offset (see
 * `useSchedulingViewport`'s realignment effect), but browsers snap a fractional `scrollLeft`
 * write to the nearest integer CSS pixel. When that snap rounds *down* — e.g. a target of
 * `839.25` lands at `839` — the lane is a fraction of a pixel short of its own left edge, and a
 * bare `Math.floor(scrollLeft / laneWidth)` reports the *previous* lane as first-visible. Callers
 * (calendar-client's boundary/resize recenter) treat that report as "the user is now looking at a
 * different day" and permanently shift the anchor a day early. One pixel of tolerance absorbs the
 * snap without being wide enough to misreport a genuine one-lane scroll.
 */
const LANE_INDEX_ROUNDING_EPSILON_PX = 1;

/** Derive the first and last lanes intersecting the current horizontal viewport. */
export function visibleScheduleLaneRange({
  viewport,
  lanes,
  laneWidth,
  gutterWidth,
  fallbackWidth,
}: {
  readonly viewport: HTMLElement;
  readonly lanes: readonly ScheduleLane[];
  readonly laneWidth: number;
  readonly gutterWidth: number;
  readonly fallbackWidth: number;
}): { readonly startLane: ScheduleLane; readonly endLane: ScheduleLane } | null {
  if (lanes.length === 0 || laneWidth <= 0) return null;
  const width = viewport.clientWidth || fallbackWidth;
  const visibleContentWidth = Math.max(1, width - gutterWidth);
  // The whole window fits without any horizontal overflow — this only happens for one render,
  // right when a rolling window sized for the previous (often bootstrap-default) visible-lane
  // count first gets measured against real geometry. There is no scrollable room left for the
  // canvas's own "scroll past the leading overscanned lane" positioning to land anywhere but 0, so
  // whichever lane sits at index 0 is an artifact of window sizing, not of where the viewer is
  // actually looking. Reporting it as "the visible range" would hand callers (calendar-client's
  // boundary/resize recenter) a false signal that the viewer scrolled to the window's leading
  // edge, permanently dragging the rolling anchor a day early. Skipping the report here is safe:
  // the very next commit grows the window to the real measured lane count, which always leaves
  // genuine overscan room, and reports correctly from there.
  if (laneWidth * lanes.length <= visibleContentWidth) return null;
  const startIndex = Math.min(
    lanes.length - 1,
    Math.max(0, Math.floor((viewport.scrollLeft + LANE_INDEX_ROUNDING_EPSILON_PX) / laneWidth)),
  );
  const endIndex = Math.min(
    lanes.length - 1,
    Math.max(startIndex, Math.floor((viewport.scrollLeft + visibleContentWidth - 1) / laneWidth)),
  );
  const startLane = lanes[startIndex];
  const endLane = lanes[endIndex];
  return startLane && endLane ? { startLane, endLane } : null;
}
