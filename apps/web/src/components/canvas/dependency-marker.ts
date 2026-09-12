/**
 * `components/canvas/dependency-marker` — the one arrowhead every dependency edge shares.
 *
 * @remarks
 * A dependency has a direction, and an edge without an arrowhead reads as a divider. The Task
 * graph and the plan canvas draw the same closed arrow so a blocking relationship looks the same
 * wherever it appears.
 */
import { type EdgeMarker, MarkerType } from '@xyflow/react';

/** The arrowhead's width and height in pixels. */
export const DEPENDENCY_MARKER_SIZE = 14;

/**
 * The arrowhead for a dependency edge.
 *
 * @param color - The stroke colour the arrow should take; omitted, xyflow uses its default.
 * @returns the marker to set as an edge's `markerEnd`.
 */
export function dependencyMarkerEnd(color?: string): EdgeMarker {
  return {
    type: MarkerType.ArrowClosed,
    width: DEPENDENCY_MARKER_SIZE,
    height: DEPENDENCY_MARKER_SIZE,
    ...(color === undefined ? {} : { color }),
  };
}
