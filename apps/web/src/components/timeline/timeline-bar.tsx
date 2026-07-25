'use client';

/**
 * `timeline` — one plotted bar: the row's span, its contents, and its drag affordances.
 *
 * @remarks
 * The bar is the timeline's primary object, so it carries real information rather than being a
 * plain coloured pill: the row's name sits *inside* it, a completion fill reads behind that name,
 * checkpoint markers ride along it, and its tone encodes the row's semantic state. All of that is
 * legible without consulting a legend.
 *
 * Geometry comes entirely from `timeline-geometry.ts`, and the three tokens stay separate here:
 * the bar is drawn at a constant {@link BAR_HEIGHT} and centered in whatever row track the active
 * density produced, while the pointer target is grown independently of both. The invisible edge
 * handles straddle each boundary so they remain grabbable even on a bar narrower than the handles
 * themselves.
 *
 * A row carrying only one date is an *anchor*, not a duration, and renders as a diamond at that
 * instant — the previous lens stretched it into a 2%-wide stub that was indistinguishable from a
 * rendering bug.
 */
import { cn } from '@docket/ui';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { ViewDisplayState } from '@/components/views/field-catalog';

import type { DragMode } from './use-timeline-drag';
import {
  type TimelineMarker,
  type TimelineSpan,
  type TimelineTint,
  isAnchor,
} from './timeline-catalog';
import { BAR_HEIGHT, EDGE_HANDLE_WIDTH, MARKER_SIZE, barInsetFor } from './timeline-geometry';
import {
  BAR_SURFACE_CLASS,
  PROGRESS_FILL_CLASS,
  TINT_ACCENT_CLASS,
  TINT_ANCHOR_BORDER_CLASS,
} from './timeline-tint';
import { type TimeWindow, pct } from './time-scale';

/** The narrowest a bar is drawn, in pixels, so a one-day span stays visible and grabbable. */
const MIN_BAR_PX = 8;

/** Props for {@link TimelineBar}. */
export interface TimelineBarProps {
  /** The row's stable id. */
  id: string;
  /** The row's display name, rendered inside the bar. */
  label: string;
  /** The span to draw — the live drag preview while a drag is in progress. */
  span: TimelineSpan;
  /** The row's semantic tone. */
  tint: TimelineTint;
  /** Completion in 0–1, or `null` when the row has no measurable progress. */
  progress: number | null;
  /** The row's dated checkpoints. */
  markers: readonly TimelineMarker[];
  /** The viewport the bar positions against. */
  window: TimeWindow;
  /** The active presentation toggles (drive geometry and which contents are drawn). */
  display: ViewDisplayState;
  /** An accessible description of the bar (name, status, span, tone). */
  description: string;
  /** Whether this bar currently violates a dependency constraint. */
  violated: boolean;
  /** Whether this bar is the one being dragged. */
  dragging: boolean;
  /** Open a drag from a pointer-down on the body or an edge handle. */
  onDragStart: (event: ReactPointerEvent<HTMLElement>, mode: DragMode) => void;
  /** Activate the row (open its detail) — a click that was not a drag. */
  onActivate: () => void;
}

/**
 * Render one positioned bar with its progress fill, markers, and drag handles.
 *
 * @param props - The {@link TimelineBarProps}.
 * @returns the rendered bar.
 */
export default function TimelineBar({
  id,
  label,
  span,
  tint,
  progress,
  markers,
  window,
  display,
  description,
  violated,
  dragging,
  onDragStart,
  onActivate,
}: TimelineBarProps): JSX.Element {
  const left = pct(span.start, window);
  const right = pct(span.end, window);
  const anchor = isAnchor(span);
  const inset = barInsetFor(display);

  // A stable, per-entity transition name so a row morphs between lenses instead of hard-swapping.
  const style: CSSProperties = {
    left: `${left}%`,
    top: `${inset}px`,
    height: `${BAR_HEIGHT}px`,
    viewTransitionName: `entity-${id}`,
  };

  if (anchor) {
    return (
      <button
        type="button"
        aria-label={description}
        title={description}
        onPointerDown={(event) => {
          onDragStart(event, 'move');
        }}
        onClick={onActivate}
        className={cn(
          'focus-visible:ring-ring absolute z-[1] flex -translate-x-1/2 items-center justify-center rounded-[3px] border-2 transition-colors focus-visible:ring-2 focus-visible:outline-none',
          'bg-surface-container-highest',
          TINT_ANCHOR_BORDER_CLASS[tint],
          violated && 'border-destructive',
          dragging && 'bg-surface-container-high',
        )}
        style={{
          ...style,
          height: `${MARKER_SIZE * 1.6}px`,
          width: `${MARKER_SIZE * 1.6}px`,
          top: `${inset + (BAR_HEIGHT - MARKER_SIZE * 1.6) / 2}px`,
          rotate: '45deg',
        }}
      />
    );
  }

  return (
    <div className="absolute" style={{ ...style, width: `max(${right - left}%, ${MIN_BAR_PX}px)` }}>
      <button
        type="button"
        aria-label={description}
        title={description}
        onPointerDown={(event) => {
          onDragStart(event, 'move');
        }}
        onClick={onActivate}
        className={cn(
          'focus-visible:ring-ring group relative flex h-full w-full min-w-0 cursor-grab items-center overflow-hidden rounded-md border pr-2 pl-2.5 text-left text-xs font-medium transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing',
          BAR_SURFACE_CLASS,
          'hover:bg-surface-container-high',
          violated && 'border-destructive',
          dragging && 'bg-surface-container-high',
        )}
      >
        {display.progress && progress !== null ? (
          <span
            aria-hidden="true"
            className={cn('absolute inset-y-0 left-0', PROGRESS_FILL_CLASS)}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        ) : null}
        {/* The semantic accent: a narrow stripe at the leading edge rather than a coloured slab. */}
        <span
          aria-hidden="true"
          className={cn('absolute inset-y-0 left-0 w-1', TINT_ACCENT_CLASS[tint])}
        />
        <span className="relative truncate">{label}</span>
      </button>

      {/* Invisible resize zones straddling each boundary — hit geometry, not visual geometry. */}
      <span
        role="presentation"
        onPointerDown={(event) => {
          onDragStart(event, 'resize-start');
        }}
        className="absolute inset-y-0 z-[2] cursor-ew-resize"
        style={{ left: `${-EDGE_HANDLE_WIDTH / 2}px`, width: `${EDGE_HANDLE_WIDTH}px` }}
      />
      <span
        role="presentation"
        onPointerDown={(event) => {
          onDragStart(event, 'resize-end');
        }}
        className="absolute inset-y-0 z-[2] cursor-ew-resize"
        style={{ right: `${-EDGE_HANDLE_WIDTH / 2}px`, width: `${EDGE_HANDLE_WIDTH}px` }}
      />

      {/*
        Checkpoint markers straddle the bar's *baseline* rather than its centre. Centred diamonds
        sit exactly on the label's x-height and shred it — "Transit Data Dashboa◇d" — whereas the
        baseline is empty, so both the date marker and the name stay legible.
      */}
      {display.markers
        ? markers.map((marker) => {
            const at = pct(marker.at, window);
            if (at < left || at > right) return null;
            const within = right > left ? ((at - left) / (right - left)) * 100 : 0;
            return (
              <span
                key={marker.id}
                aria-hidden="true"
                title={marker.name}
                className="border-on-surface/40 bg-surface pointer-events-none absolute top-full z-[3] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border shadow-sm"
                style={{
                  left: `${within}%`,
                  width: `${MARKER_SIZE}px`,
                  height: `${MARKER_SIZE}px`,
                }}
              />
            );
          })
        : null}
    </div>
  );
}
