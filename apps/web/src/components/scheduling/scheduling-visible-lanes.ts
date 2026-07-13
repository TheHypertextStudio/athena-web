import type { ScheduleLane } from './scheduling-types';

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
  const startIndex = Math.min(
    lanes.length - 1,
    Math.max(0, Math.floor(viewport.scrollLeft / laneWidth)),
  );
  const endIndex = Math.min(
    lanes.length - 1,
    Math.max(startIndex, Math.floor((viewport.scrollLeft + visibleContentWidth - 1) / laneWidth)),
  );
  const startLane = lanes[startIndex];
  const endLane = lanes[endIndex];
  return startLane && endLane ? { startLane, endLane } : null;
}
