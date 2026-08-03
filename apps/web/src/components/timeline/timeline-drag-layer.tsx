'use client';

/**
 * `timeline` — what a drag looks like: the object in hand, and where it will land.
 *
 * @remarks
 * A schedule drag used to be invisible. The bar moved under the pointer and nothing else changed,
 * so there was no held object and no statement of the outcome — you found out what you had done
 * by reading the row afterwards. Two elements fix that, and they answer two different questions:
 *
 * - {@link TimelineDragPreview} answers *what am I holding*. It is a small card carrying the row's
 *   own identity — its tone dot, its name, and the duration it will have — pinned to the pointer,
 *   portalled to `document.body` so no ancestor's `overflow` can clip it and no stacking context
 *   can bury it. It is the object, not a shadow of the row.
 * - {@link TimelineDropIndicator} answers *where will it go*. It bands the target row across the
 *   full plot width, marks the snapped start and end edges the drop will actually commit to, and
 *   states those two dates in words. Because the marks are drawn from the same snapped span that
 *   `onCommit` receives, the indicator cannot disagree with the result.
 *
 * Both are `pointer-events-none`: a drag preview that can be hovered would eat the very
 * `pointermove` events driving it.
 */
import { cn } from '@docket/ui';
import { type JSX, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { type TimelineSpan, type TimelineTint } from './timeline-catalog';
import { DAY_MS, type TimeWindow, pct } from './time-scale';
import { TINT_DOT_CLASS } from './timeline-tint';

/** How far from the pointer the preview card sits, in pixels, on both axes. */
const PREVIEW_OFFSET_PX = 14;

/** The date format shared by the preview and the drop readout. */
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * Whole days covered by a span, counting a single-date anchor as one day.
 *
 * @param span - The span to measure.
 * @returns the day count, never below one.
 */
export function spanDays(span: TimelineSpan): number {
  return Math.max(1, Math.round((span.end - span.start) / DAY_MS));
}

/**
 * The span stated as a sentence a person can check against the bar.
 *
 * @param span - The snapped span the drop will commit.
 * @returns e.g. `Mar 3 – Mar 17 · 14 days`.
 */
export function describeSpan(span: TimelineSpan): string {
  const days = spanDays(span);
  const unit = days === 1 ? 'day' : 'days';
  if (span.start === span.end) return `${DAY_FORMAT.format(new Date(span.start))} · 1 day`;
  return `${DAY_FORMAT.format(new Date(span.start))} – ${DAY_FORMAT.format(
    new Date(span.end),
  )} · ${String(days)} ${unit}`;
}

/** Props for {@link TimelineDragPreview}. */
export interface TimelineDragPreviewProps {
  /** The dragged row's display name. */
  readonly label: string;
  /** The dragged row's semantic tone, so the preview is recognisably *that* row. */
  readonly tint: TimelineTint;
  /** The live snapped span the drop would commit. */
  readonly span: TimelineSpan;
  /** The pointer's viewport x. */
  readonly pointerX: number;
  /** The pointer's viewport y. */
  readonly pointerY: number;
}

/**
 * The object in hand: a card pinned to the pointer for the life of the drag.
 *
 * @param props - The {@link TimelineDragPreviewProps}.
 * @returns the portalled preview, or `null` before the document is available.
 */
export function TimelineDragPreview({
  label,
  tint,
  span,
  pointerX,
  pointerY,
}: TimelineDragPreviewProps): JSX.Element | null {
  // Portalling needs a document; render nothing on the server pass and mount on the client. A
  // drag cannot begin before hydration, so nothing is ever missing when it matters.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready) return null;

  return createPortal(
    <div
      aria-hidden="true"
      data-timeline-drag-preview=""
      className="pointer-events-none fixed z-50 max-w-[18rem]"
      style={{ left: pointerX + PREVIEW_OFFSET_PX, top: pointerY + PREVIEW_OFFSET_PX }}
    >
      {/*
        Tone, not elevation. Shadows are reserved for the overlay primitives (dialog, menu,
        popover, tooltip) and the build fails on one drawn anywhere else, so the preview lifts off
        whatever it is over by taking the top of the tonal ramp plus a hairline ring.
      */}
      <div className="bg-surface-container-highest text-on-surface ring-outline-variant flex items-center gap-2 rounded-md px-2.5 py-1.5 ring-1">
        <span className={cn('size-2 shrink-0 rounded-full', TINT_DOT_CLASS[tint])} />
        <span className="text-label-medium min-w-0 truncate">{label}</span>
        <span className="text-on-surface-variant text-label-small shrink-0 tabular-nums">
          {describeSpan(span)}
        </span>
      </div>
    </div>,
    document.body,
  );
}

/** Props for {@link TimelineDropIndicator}. */
export interface TimelineDropIndicatorProps {
  /** The target row's vertical offset within the plot, in pixels. */
  readonly top: number;
  /** The target row's height, in pixels. */
  readonly height: number;
  /** The snapped span the drop will commit. */
  readonly span: TimelineSpan;
  /** The viewport the span is projected against. */
  readonly window: TimeWindow;
}

/**
 * Where the object will land: the target row band, the snapped edges, and the dates in words.
 *
 * @param props - The {@link TimelineDropIndicatorProps}.
 * @returns the rendered indicator.
 */
export function TimelineDropIndicator({
  top,
  height,
  span,
  window,
}: TimelineDropIndicatorProps): JSX.Element {
  const left = pct(span.start, window);
  const right = pct(span.end, window);

  return (
    <div
      aria-hidden="true"
      data-timeline-drop-indicator=""
      className="pointer-events-none absolute inset-x-0 z-[4]"
      style={{ top, height }}
    >
      {/* The target row band — full plot width, so the row being landed in is unambiguous. */}
      <div className="bg-primary/8 absolute inset-0" />
      {/* The two snapped edges the commit will actually use. */}
      <div className="bg-primary/70 absolute inset-y-0 w-px" style={{ left: `${left}%` }} />
      <div className="bg-primary/70 absolute inset-y-0 w-px" style={{ left: `${right}%` }} />
      <div
        className="bg-primary/25 absolute inset-y-0"
        style={{ left: `${left}%`, width: `${Math.max(right - left, 0)}%` }}
      />
      {/* The outcome in words, pinned to the leading edge so it cannot drift off-screen right. */}
      <div
        className="absolute top-1/2 -translate-y-1/2 pl-1.5"
        style={{ left: `${Math.min(Math.max(left, 0), 88)}%` }}
      >
        <span className="bg-primary text-on-primary text-label-small rounded-md px-1.5 py-0.5 whitespace-nowrap tabular-nums">
          {describeSpan(span)}
        </span>
      </div>
    </div>
  );
}
