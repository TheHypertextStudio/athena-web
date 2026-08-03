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
  readonly timeRange: string;
  readonly content: ReactNode;
  readonly readOnlyDescriptionId: string;
  readonly editable: boolean;
  readonly openable: boolean;
  readonly movable: boolean;
  readonly onPointerDown: PointerEventHandler<HTMLButtonElement>;
  readonly onClick: MouseEventHandler<HTMLButtonElement>;
}

/** Render the visible title/time content shared by interactive and opaque item bodies. */
function ItemBodyContent({
  item,
  density,
  timeRange,
  content,
}: Pick<SchedulingItemBodyProps, 'item' | 'density' | 'timeRange' | 'content'>): JSX.Element {
  if (density === 'marker') {
    return (
      <span
        aria-hidden="true"
        className="bg-primary my-auto block h-1 w-full rounded-full"
        style={item.color ? { backgroundColor: item.color } : undefined}
      />
    );
  }

  if (density === 'compact') {
    return (
      <span className="sticky block w-full truncate" style={STICKY_LABEL_STYLE}>
        {content}
        <span aria-hidden="true"> · </span>
        <span className="text-on-surface-variant text-body-medium tabular-nums">{timeRange}</span>
      </span>
    );
  }

  // A full-height card has room for the readable 14px title; the time line stays one step down at
  // the 12px floor. Nothing on a calendar card is ever rendered below 12px.
  return (
    <span className="sticky flex min-w-0 flex-col" style={STICKY_LABEL_STYLE}>
      <span className="text-title-small block w-full truncate">{content}</span>
      <span className="text-on-surface-variant text-body-medium block w-full truncate tabular-nums">
        {timeRange}
      </span>
    </span>
  );
}

/** Keep busy-only/private items readable without presenting a control that cannot open. */
export function SchedulingItemBody(props: SchedulingItemBodyProps): JSX.Element {
  const { item, density, timeRange, readOnlyDescriptionId, editable, openable, movable } = props;
  // No `overflow-hidden` on a labelled body: it would establish a scrollport of its own and strand
  // the sticky label at the item's top edge (see {@link STICKY_LABEL_STYLE}). The label's own
  // `truncate` clips instead, and the canvas clips everything past its edges.
  const bodyClassName =
    density === 'marker'
      ? 'focus-visible:ring-ring relative z-10 size-full overflow-hidden rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset'
      : 'text-on-surface text-label-large focus-visible:ring-ring relative z-10 flex size-full min-w-0 flex-col rounded-sm px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset';
  const ariaLabel = density === 'marker' ? `${item.title}, ${timeRange}` : undefined;
  const describedBy = !editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined;
  const title = `${item.title} · ${timeRange}`;
  const children = <ItemBodyContent {...props} />;

  if (!openable && !movable) {
    return (
      <div
        aria-describedby={describedBy}
        className={bodyClassName}
        data-schedule-item-body={item.id}
        title={title}
      >
        {density === 'marker' ? (
          <span className="sr-only">
            {item.title}, {timeRange}
          </span>
        ) : null}
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      className={`${bodyClassName} ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      data-schedule-item-body={item.id}
      title={title}
      onPointerDown={movable ? props.onPointerDown : undefined}
      onClick={openable ? props.onClick : undefined}
    >
      {children}
    </button>
  );
}
