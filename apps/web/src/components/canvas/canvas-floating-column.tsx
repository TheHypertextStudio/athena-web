'use client';

/**
 * `components/canvas/canvas-floating-column` — a panel that floats over a canvas's right edge.
 *
 * @remarks
 * A canvas that runs edge to edge keeps its companions on top of it rather than beside it: the
 * inspector for a selection, a conversation with Athena. Each is a floating column pinned to the
 * right edge with a gutter, stacked leftward by `offsetRight` when more than one is open, and
 * reporting its measured width so the canvas can keep its frame out from under it. The column is
 * not modal: focus is not captured, the canvas stays live, and Escape closes it only when the
 * child did not already claim the key.
 */
import { cn } from '@docket/ui/lib/utils';
import { Surface } from '@docket/ui/primitives';
import { type JSX, type ReactNode, useEffect, useRef } from 'react';

import { CANVAS_OVERLAY_GUTTER } from './canvas-viewport-insets';

/** Props for {@link CanvasFloatingColumn}. */
export interface CanvasFloatingColumnProps {
  /** The landmark name of the column. */
  readonly label: string;
  /** Pixels already spoken for to the right, by another floating column. */
  readonly offsetRight?: number;
  /** Receives the column's measured width when it changes, and `0` when it unmounts. */
  readonly onWidthChange?: ((width: number) => void) | undefined;
  /** Escape pressed inside the column, when the child did not claim it. */
  readonly onEscape?: (() => void) | undefined;
  /** Width and any other classes; callers pass the width so Tailwind's scanner sees it. */
  readonly className?: string;
  readonly children: ReactNode;
}

/** A non-modal panel floating over the right edge of a canvas. */
export default function CanvasFloatingColumn({
  label,
  offsetRight = 0,
  onWidthChange,
  onEscape,
  className,
  children,
}: CanvasFloatingColumnProps): JSX.Element {
  // The shared `Surface` forwards no ref, so the measured, positioned element is a wrapper and
  // the surface fills it.
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !onWidthChange) return undefined;
    const report = (): void => {
      onWidthChange(node.getBoundingClientRect().width);
    };
    report();
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        onWidthChange(0);
      };
    }
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => {
      observer.disconnect();
      onWidthChange(0);
    };
  }, [onWidthChange]);

  return (
    <div
      ref={ref}
      data-testid="canvas-floating-column"
      className={cn(
        'absolute top-3 bottom-3 z-[2000] flex min-h-0 flex-col',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-(--dur-base)',
        className,
      )}
      style={{ right: CANVAS_OVERLAY_GUTTER + offsetRight }}
    >
      <Surface
        as="aside"
        tone="floating"
        shape="large"
        aria-label={label}
        onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key !== 'Escape' || event.defaultPrevented || !onEscape) return;
          event.stopPropagation();
          onEscape();
        }}
        className="@container flex h-full min-h-0 w-full flex-col overflow-hidden"
      >
        {children}
      </Surface>
    </div>
  );
}
