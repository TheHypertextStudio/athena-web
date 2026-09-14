'use client';

/**
 * `components/canvas/canvas-bottom-chrome` — the row of chrome along a canvas's bottom edge.
 *
 * @remarks
 * The viewport toolbar at the left, the minimap at the right, and a transient notice centred
 * between them. Kept clear of any floating column on the right, and measured by the canvas so
 * the frame keeps its bottom padding above this row.
 */
import { MiniMap } from '@xyflow/react';
import type { FitViewOptions, Node } from '@xyflow/react';
import type { JSX, ReactNode, RefObject } from 'react';

import CanvasOverlayPanel from './canvas-overlay-panel';
import CanvasViewportToolbar from './canvas-viewport-toolbar';

/** Props for {@link CanvasBottomChrome}. */
export interface CanvasBottomChromeProps {
  /** The measured row, so the canvas can pad its frame above it. */
  readonly contentRef: RefObject<HTMLDivElement | null>;
  /** Pixels a floating column takes on the right. */
  readonly insetRight: number;
  readonly bottomNotice: ReactNode | undefined;
  readonly fitPadding: FitViewOptions['padding'];
  readonly onRelayout: () => void;
  readonly showMinimap: boolean;
  readonly nodeColor: ((node: Node) => string) | undefined;
}

/** The bottom row: toolbar, notice, minimap. */
export function CanvasBottomChrome({
  contentRef,
  insetRight,
  bottomNotice,
  fitPadding,
  onRelayout,
  showMinimap,
  nodeColor,
}: CanvasBottomChromeProps): JSX.Element {
  return (
    <CanvasOverlayPanel
      position="bottom-left"
      data-testid="canvas-bottom-chrome"
      className="pointer-events-none !bottom-2 !left-2 !m-0"
      style={{ right: 15 + insetRight }}
    >
      <div
        ref={contentRef}
        data-testid="canvas-bottom-chrome-content"
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2"
      >
        {bottomNotice === undefined ? null : (
          <div
            data-testid="canvas-bottom-notice"
            className="col-span-3 col-start-1 row-start-1 flex min-w-0 justify-center sm:col-span-1 sm:col-start-2"
          >
            {bottomNotice}
          </div>
        )}
        <div className="col-start-1 row-start-2 self-end sm:row-span-2 sm:row-start-1">
          <CanvasViewportToolbar fitPadding={fitPadding} onRelayout={onRelayout} />
        </div>
        <div className="col-start-3 row-start-2 self-end sm:row-span-2 sm:row-start-1">
          {showMinimap ? (
            <MiniMap
              pannable
              zoomable
              {...(nodeColor !== undefined ? { nodeColor } : {})}
              maskColor="color-mix(in srgb, var(--color-surface) 70%, transparent)"
              bgColor="var(--color-surface-container-low)"
              className="!rounded-corner-lg pointer-events-auto !static !m-0 !h-[150px] !w-[200px] shrink-0"
            />
          ) : (
            <div aria-hidden className="w-10 shrink-0" />
          )}
        </div>
      </div>
    </CanvasOverlayPanel>
  );
}
