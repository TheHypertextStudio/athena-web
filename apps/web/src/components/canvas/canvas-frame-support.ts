'use client';

/**
 * `components/canvas/canvas-frame-support` — the canvas's first frame, dot grid, and selection
 * reporting, kept beside `canvas.tsx` as pure pieces it composes.
 */
import type { OnSelectionChangeFunc, ReactFlowInstance } from '@xyflow/react';
import { useCallback, useRef } from 'react';

import {
  type CanvasOverlayInsets,
  fitPaddingFor,
  insetRight,
  insetTop,
} from './canvas-viewport-insets';
import { computeFirstFrameViewport, type FrameAnchor } from './graph-first-frame-viewport';

/** The padding the first frame keeps around the graph, before any floating chrome. */
export const WORKING_AREA_PADDING = 24;

/** The dot grid drawn under a graph. */
export interface CanvasDotGrid {
  /** Distance between dots, in canvas pixels. */
  readonly gap: number;
  /** Dot radius; xyflow's default when omitted. */
  readonly size?: number;
  /** Dot colour; the tone's default when omitted. */
  readonly color?: string;
}

/** The grid the Task and Project graphs draw. */
export const DEFAULT_DOT_GRID: CanvasDotGrid = { gap: 20 };

/** xyflow `Background` props for a dot grid, with only the fields the grid sets. */
export function dotGridProps(grid: CanvasDotGrid): { gap: number; size?: number; color?: string } {
  return {
    gap: grid.gap,
    ...(grid.size === undefined ? {} : { size: grid.size }),
    ...(grid.color === undefined ? {} : { color: grid.color }),
  };
}

/** What the first frame needs beyond the graph: where to anchor it, and what is in the way. */
export interface FirstFrameSpec {
  readonly anchor: FrameAnchor;
  readonly insets: CanvasOverlayInsets;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly minZoom: number;
  readonly maxZoom: number;
}

/**
 * Frame `nodeIds` at `zoom`: centred through xyflow's own fit, or anchored to the left edge
 * through the pure placement, so the graph never centres under floating chrome.
 */
export function applyFirstFrame(
  flowInstance: ReactFlowInstance,
  nodeIds: readonly string[],
  zoom: number,
  spec: FirstFrameSpec,
): void {
  if (spec.anchor === 'center') {
    void flowInstance.fitView({
      nodes: nodeIds.map((id) => ({ id })),
      minZoom: spec.minZoom,
      maxZoom: spec.maxZoom,
      padding: fitPaddingFor(spec.insets, WORKING_AREA_PADDING),
    });
    return;
  }
  void flowInstance.setViewport(
    computeFirstFrameViewport({
      bounds: flowInstance.getNodesBounds([...nodeIds]),
      viewport: spec.viewport,
      padding: {
        top: WORKING_AREA_PADDING + insetTop(spec.insets),
        right: WORKING_AREA_PADDING + insetRight(spec.insets),
        bottom: WORKING_AREA_PADDING,
        left: WORKING_AREA_PADDING,
      },
      zoom: Math.max(spec.minZoom, Math.min(zoom, spec.maxZoom)),
      anchor: 'start',
    }),
  );
}

/**
 * Report the selected node ids to the host, once per change of the id set.
 *
 * @remarks
 * xyflow calls its selection handler on every change event, including ones that leave the set
 * as it was; the host only hears about a different set.
 */
export function useSelectionReporter(
  onSelectionChange: ((ids: readonly string[]) => void) | undefined,
): OnSelectionChangeFunc {
  const lastSelection = useRef('');
  return useCallback<OnSelectionChangeFunc>(
    ({ nodes: selected }) => {
      const ids = selected.map(({ id }) => id);
      const key = ids.join(' ');
      if (key === lastSelection.current) return;
      lastSelection.current = key;
      onSelectionChange?.(ids);
    },
    [onSelectionChange],
  );
}

/** Clear every node's selected flag; the selection reporter then empties the provider. */
export function deselectAllNodes(flowInstance: ReactFlowInstance | null): void {
  flowInstance?.setNodes((current) =>
    current.map((node) => (node.selected ? { ...node, selected: false } : node)),
  );
}

/** A stable callback that clears the canvas's selection through {@link deselectAllNodes}. */
export function useDeselectAll(flowInstance: ReactFlowInstance | null): () => void {
  return useCallback(() => {
    deselectAllNodes(flowInstance);
  }, [flowInstance]);
}
