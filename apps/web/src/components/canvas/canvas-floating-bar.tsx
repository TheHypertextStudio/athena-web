'use client';

/**
 * `components/canvas/canvas-floating-bar` — the one bar over an edge-to-edge canvas.
 *
 * @remarks
 * A canvas that fills its panel keeps its chrome in a single floating row at the top left: the
 * way back, the title, the view controls, and the counts. When something is selected the counts
 * give way to the selection's actions in the same row, so no second bar ever floats over the
 * graph and covers a node. While something is selected the bar is the selection's bar: a clear
 * button where the way back was, the count and labeled actions, and nothing else competing for
 * the row. The bar spans the width the floating columns leave it and reports its height so the
 * canvas can keep its frame below it.
 */
import { AppBar } from '@docket/ui/components';
import { X } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import { type JSX, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';

import { CANVAS_OVERLAY_GUTTER } from './canvas-viewport-insets';

/**
 * Whether a scrolling group's content runs past its box; while it does, the group fades at its
 * end so a cut-off label reads as "more this way" rather than as a mistake.
 */
function useOverflowing(): [boolean, (node: HTMLDivElement | null) => void] {
  const [overflowing, setOverflowing] = useState(false);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return undefined;
    const measure = (): void => {
      setOverflowing(node.scrollWidth > node.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [node]);
  return [overflowing, setNode];
}

/** Reports the referenced element's height to `onHeightChange` now and whenever it changes. */
function useReportedHeight(
  onHeightChange: ((height: number) => void) | undefined,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !onHeightChange) return undefined;
    const report = (): void => {
      onHeightChange(node.getBoundingClientRect().height);
    };
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [onHeightChange]);
  return ref;
}

/** Props for {@link CanvasFloatingBar}. */
export interface CanvasFloatingBarProps {
  readonly title: string;
  /** A `view-transition-name` on the title, for a page that morphs into this bar. */
  readonly titleTransitionName?: string | undefined;
  /** The landmark name, e.g. "Plan" or "Task graph". */
  readonly ariaLabel: string;
  /** The way back: an icon button before the title. */
  readonly navigation?: ReactNode;
  /** View controls beside the title: search, filters, an add action. */
  readonly controls?: ReactNode;
  /** What trails the controls when nothing is selected: counts, status. */
  readonly trailing?: ReactNode;
  /** The selection's actions; when non-null they replace `trailing`. */
  readonly selection?: ReactNode | null;
  /** Page-level actions pinned to the end. */
  readonly actions?: ReactNode;
  /**
   * Let go of the selection. While something is selected the bar is the selection's bar: this
   * replaces the way back, the title and the controls step aside, and the actions carry labels.
   */
  readonly onClearSelection?: (() => void) | undefined;
  /** Pixels spoken for on the right by floating columns, so the bar never runs under them. */
  readonly insetRight?: number;
  /** Receives the bar's measured height when it changes. */
  readonly onHeightChange?: ((height: number) => void) | undefined;
}

/** The floating chrome row over a canvas. Render it as a sibling before the canvas. */
export default function CanvasFloatingBar({
  title,
  titleTransitionName,
  ariaLabel,
  navigation,
  controls,
  trailing,
  selection = null,
  actions,
  onClearSelection,
  insetRight = 0,
  onHeightChange,
}: CanvasFloatingBarProps): JSX.Element {
  const ref = useReportedHeight(onHeightChange);
  const [overflowing, attachGroup] = useOverflowing();
  const selectionGroup =
    selection === null ? null : (
      <div
        ref={attachGroup}
        role="group"
        aria-label="Selection"
        data-testid="canvas-selection-bar"
        data-overflowing={overflowing || undefined}
        className={cn(
          'flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto',
          overflowing && '[mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]',
        )}
      >
        {selection}
      </div>
    );

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-2 left-2 z-(--z-canvas-chrome)"
      style={{ right: CANVAS_OVERLAY_GUTTER + insetRight }}
    >
      <AppBar
        presentation="floating"
        aria-label={ariaLabel}
        title={selection === null ? title : <span className="sr-only">{title}</span>}
        titleTransitionName={titleTransitionName}
        navigation={
          selection !== null && onClearSelection ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="Clear selection"
              title="Clear selection"
              onClick={onClearSelection}
            >
              <X className="size-4" />
            </Button>
          ) : (
            navigation
          )
        }
        controls={selection === null ? controls : undefined}
        fill={selectionGroup}
        actions={
          <>
            {selection === null ? trailing : null}
            {actions}
          </>
        }
        className="pointer-events-auto w-full"
      />
    </div>
  );
}
