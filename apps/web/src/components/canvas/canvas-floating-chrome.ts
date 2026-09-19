'use client';

/**
 * `components/canvas/canvas-floating-chrome` — how floating chrome changes the frame of a canvas.
 *
 * @remarks
 * A host that owns the whole page runs its canvas edge to edge under one floating bar. The bar's
 * height is measured rather than assumed, and a floating inspector reports how much of the right
 * edge it covers, so the canvas can frame its graph in the part a person can see. Every host that
 * floats its chrome, the Task graph and the Project dependencies page among them, reads the same
 * numbers from this hook.
 */
import { useCallback, useMemo, useState } from 'react';

import { CANVAS_OVERLAY_GUTTER, type CanvasOverlayInsets } from './canvas-viewport-insets';

/** The window width from which the sidebar keeps its full width beside a canvas page. */
export const CANVAS_COMPACT_SIDEBAR_BELOW_PX = 1920;

/** What a canvas host reads to frame its graph around floating chrome. */
export interface CanvasFloatingChrome {
  /** Whether a host asked for view chrome, in a band or floating. */
  readonly chromed: boolean;
  /** Whether the chrome floats, which also compacts the view bar's search. */
  readonly compact: boolean;
  /** What the chrome covers, in the form the canvas frames around; undefined when it covers nothing. */
  readonly insets: CanvasOverlayInsets | undefined;
  /** Extra classes on the created-but-hidden notices, to sit below the bar. */
  readonly noticeClass: string | undefined;
  /** Pixels of the right edge a floating inspector covers, 0 while none does. */
  readonly inspectorRight: number;
  /** Receives the bar's measured height. */
  readonly onHeightChange: (height: number) => void;
  /** Receives how much of the right edge a floating inspector covers. */
  readonly onInspectorOcclusion: (rightPx: number) => void;
}

/**
 * The chrome's effect on the canvas: the insets to frame around and the callbacks that keep them
 * current.
 *
 * @param floating - Whether the host floats a bar over the canvas.
 * @param banded - Whether the host puts its view bar in a band above the canvas instead.
 */
export function useCanvasFloatingChrome(floating: boolean, banded = false): CanvasFloatingChrome {
  const [barHeight, setBarHeight] = useState(0);
  const [inspectorRight, setInspectorRight] = useState(0);
  const onHeightChange = useCallback((height: number) => {
    setBarHeight(height);
  }, []);
  const onInspectorOcclusion = useCallback((rightPx: number) => {
    setInspectorRight(rightPx);
  }, []);
  const insets = useMemo<CanvasOverlayInsets | undefined>(
    () =>
      floating
        ? {
            top: barHeight + CANVAS_OVERLAY_GUTTER,
            ...(inspectorRight > 0 ? { right: inspectorRight } : {}),
          }
        : undefined,
    [barHeight, floating, inspectorRight],
  );
  return {
    chromed: floating || banded,
    compact: floating,
    insets,
    noticeClass: floating ? '!top-12' : undefined,
    inspectorRight,
    onHeightChange,
    onInspectorOcclusion,
  };
}
