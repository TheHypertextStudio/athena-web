'use client';

/**
 * `components/canvas/canvas-floating-bar` — the one bar over an edge-to-edge canvas.
 *
 * @remarks
 * A canvas that fills its panel keeps its chrome in a single floating row at the top left: the
 * way back, the title, the view controls, and the counts. When something is selected the counts
 * give way to the selection's actions in the same row, so no second bar ever floats over the
 * graph and covers a node. The bar reports its height so the canvas can keep its frame below it.
 */
import { AppBar } from '@docket/ui/components';
import { type JSX, type ReactNode, useEffect, useRef } from 'react';

/** Props for {@link CanvasFloatingBar}. */
export interface CanvasFloatingBarProps {
  readonly title: string;
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
  /** Pixels spoken for on the right by floating columns, so the bar never runs under them. */
  readonly insetRight?: number;
  /** Receives the bar's measured height when it changes. */
  readonly onHeightChange?: ((height: number) => void) | undefined;
}

/** The floating chrome row over a canvas. Render it as a sibling before the canvas. */
export default function CanvasFloatingBar({
  title,
  ariaLabel,
  navigation,
  controls,
  trailing,
  selection = null,
  actions,
  insetRight = 0,
  onHeightChange,
}: CanvasFloatingBarProps): JSX.Element {
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

  const tail =
    selection === null ? (
      trailing
    ) : (
      <div
        role="group"
        aria-label="Selection"
        data-testid="canvas-selection-bar"
        className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto"
      >
        {selection}
      </div>
    );

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-3 left-3 z-[2000]"
      style={{ maxWidth: `calc(100% - 1.5rem - ${String(insetRight)}px)` }}
    >
      <AppBar
        presentation="floating"
        aria-label={ariaLabel}
        title={title}
        navigation={navigation}
        controls={
          <>
            {controls}
            <span className="min-w-0 flex-1" aria-hidden="true" />
            {tail}
          </>
        }
        actions={actions}
        className="pointer-events-auto max-w-full"
      />
    </div>
  );
}
