'use client';

import type { CSSProperties, JSX, MouseEventHandler, PointerEventHandler, ReactNode } from 'react';

import type { ScheduleItem, ScheduleItemDensity } from './scheduling-types';

/**
 * Pin an item's label row to the top of the *visible* canvas while the item is still on screen.
 *
 * @remarks
 * A meeting that started before the current scroll position used to paint as a bare coloured
 * rectangle: its title and time sat at the item's own top edge, which was above the fold. The event
 * most likely to matter — the one happening right now — was the one with no label.
 *
 * `position: sticky` fixes that only if nothing between the label and the scroll container
 * establishes its own scrollport, which is why the body below is **not** `overflow-hidden`; the
 * truncating spans do the clipping instead. Sticky is bounded by its containing block, so the label
 * still leaves with the item rather than escaping into the next one, and the offset is the measured
 * height of the canvas's own sticky header (published by `scheduling-canvas.tsx`) so a clamped label
 * lands below the lane headings rather than underneath them.
 */
const STICKY_LABEL_STYLE = { top: 'var(--schedule-sticky-top, 0px)' } satisfies CSSProperties;

/** Props for the openable/movable or intentionally static body of one timed item. */
interface SchedulingItemBodyProps {
  readonly item: ScheduleItem;
  readonly density: ScheduleItemDensity;
  /** Rendered card height in pixels, which sets how many title lines fit. */
  readonly height: number;
  readonly timeRange: string;
  readonly content: ReactNode;
  readonly readOnlyDescriptionId: string;
  readonly editable: boolean;
  readonly openable: boolean;
  readonly movable: boolean;
  readonly onPointerDown: PointerEventHandler<HTMLButtonElement>;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
}

/**
 * How many lines of title a card of this height can show without spilling past its own bounds.
 *
 * @remarks
 * The old rule was `truncate` at every height, so a two-hour meeting rendered one clipped line
 * followed by 180px of empty fill. Line height is ~20px and the time line below the title takes one
 * of them, so the budget is `(height - padding - timeLine) / lineHeight`, capped at 3 because a
 * fourth line is a description, not a title, and a card is not a reading surface.
 */
function titleLineClamp(height: number): 1 | 2 | 3 {
  if (height < 64) return 1;
  if (height < 96) return 2;
  return 3;
}

const TITLE_CLAMP_CLASS = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
} as const;

/** Render the visible title/time content shared by interactive and opaque item bodies. */
function ItemBodyContent({
  density,
  height,
  timeRange,
  content,
}: Pick<SchedulingItemBodyProps, 'density' | 'height' | 'timeRange' | 'content'>): JSX.Element {
  // A block too short for a time line still gets its title. It used to render as a featureless
  // coloured bar with the title only in the accessibility tree — a dead element on the one surface
  // whose entire job is saying what is happening. Solid leading (line-height = the token's own
  // font size, via the theme variable rather than a raw utility) and no vertical padding is what
  // buys one 14px line inside an 18px block, so the round-3 type floor holds.
  if (density === 'marker') {
    return (
      <span
        className="text-label-large sticky block w-full truncate leading-[var(--text-label-large)]"
        style={STICKY_LABEL_STYLE}
      >
        {content}
      </span>
    );
  }

  if (density === 'compact') {
    return (
      <span className="sticky block w-full truncate" style={STICKY_LABEL_STYLE}>
        {content}
        <span aria-hidden="true"> · </span>
        <span className="text-body-medium text-(--schedule-item-foreground) tabular-nums">
          {timeRange}
        </span>
      </span>
    );
  }

  // A full-height card has room for the readable 14px title; the time line stays one step down at
  // the 12px floor. Nothing on a calendar card is ever rendered below 12px.
  //
  // `line-clamp-*` sets `overflow: hidden` on the *title span only*. The body above must stay
  // unclipped or it establishes a scrollport and strands the sticky label (see
  // {@link STICKY_LABEL_STYLE}); a clipped grandchild does not.
  return (
    <span className="sticky flex min-w-0 flex-col" style={STICKY_LABEL_STYLE}>
      {/* No `block` beside `line-clamp-*`: both utilities set `display`, and whichever Tailwind
          emits later wins regardless of the order they appear in this attribute. `block` won, the
          clamp silently did nothing, and a long title ran straight out of the bottom of its own
          card. `line-clamp-*` already supplies the `-webkit-box` display it needs. */}
      <span className={`text-title-small w-full ${TITLE_CLAMP_CLASS[titleLineClamp(height)]}`}>
        {content}
      </span>
      <span className="text-body-medium block w-full truncate text-(--schedule-item-foreground) tabular-nums">
        {timeRange}
      </span>
    </span>
  );
}

/** Render readable timed-item content without presenting controls the item cannot use. */
export function SchedulingItemBody(props: SchedulingItemBodyProps): JSX.Element {
  const { item, density, timeRange, readOnlyDescriptionId, editable, openable, movable } = props;
  // No `overflow-hidden` on a labelled body: it would establish a scrollport of its own and strand
  // the sticky label at the item's top edge (see {@link STICKY_LABEL_STYLE}). The label's own
  // `truncate` clips instead, and the canvas clips everything past its edges.
  const bodyClassName =
    density === 'marker'
      ? 'text-(--schedule-item-foreground) focus-visible:ring-ring relative z-10 flex size-full min-w-0 flex-col justify-center rounded-sm px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset'
      : 'text-(--schedule-item-foreground) text-label-large focus-visible:ring-ring relative z-10 flex size-full min-w-0 flex-col rounded-sm px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset';
  const describedBy = !editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined;
  const title = `${item.title} · ${timeRange}`;
  const children = <ItemBodyContent {...props} />;
  // Every density now renders the title as visible text, so the control is named by its own
  // content. The marker density used to be the exception — a bare coloured bar with an `aria-label`
  // and an `sr-only` twin — and both of those are gone with the bar. Only the time range is still
  // unrenderable in an 18px box, so it alone stays screen-reader-only, with the comma that keeps
  // the announcement reading as `Title, 9:00 AM – 9:05 AM` rather than running the two together.
  const timeRangeLabel =
    density === 'marker' ? <span className="sr-only">{`, ${timeRange}`}</span> : null;

  if (!openable && !movable) {
    return (
      <div
        aria-describedby={describedBy}
        className={bodyClassName}
        data-schedule-item-body={item.id}
        title={title}
      >
        {children}
        {timeRangeLabel}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-describedby={describedBy}
      className={`${bodyClassName} ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      data-schedule-item-body={item.id}
      title={title}
      onPointerDown={movable ? props.onPointerDown : undefined}
      onClick={openable ? props.onClick : undefined}
    >
      {children}
      {timeRangeLabel}
    </button>
  );
}
