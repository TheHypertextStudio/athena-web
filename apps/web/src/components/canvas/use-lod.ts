'use client';

/**
 * `components/canvas/use-lod` — a zoom-driven level-of-detail flag for nodes.
 *
 * @remarks
 * On a large graph, full node cards become noise when zoomed out. Rather than have every node
 * subscribe to the viewport (which would re-render them on every zoom tick), the canvas computes a
 * single boolean from xyflow's store — `true` once the zoom drops below the threshold — and shares
 * it through context. Because the selector returns a boolean, the value only changes when the zoom
 * actually crosses the threshold, so nodes re-render at most twice across a full zoom sweep.
 */
import { useStore } from '@xyflow/react';
import { createContext, useContext } from 'react';

/** Below this zoom, nodes drop to their low-detail rendering. */
const LOD_ZOOM_THRESHOLD = 0.55;

const LodContext = createContext(false);

/** Provides the current low-detail flag to the nodes below. */
export const LodProvider = LodContext.Provider;

/** Read whether the canvas is zoomed out past the low-detail threshold. */
export function useLod(): boolean {
  return useContext(LodContext);
}

/** Compute the low-detail flag from the live zoom (must run under a `ReactFlowProvider`). */
export function useLodValue(): boolean {
  return useStore((s) => s.transform[2] < LOD_ZOOM_THRESHOLD);
}
