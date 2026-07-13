'use client';

import type { JSX, MouseEventHandler, PointerEventHandler, ReactNode } from 'react';

import type { ScheduleItem } from './scheduling-types';

/** Visual density selected from the card's rendered height. */
export type ScheduleItemDensity = 'marker' | 'compact' | 'full';

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
  return density === 'marker' ? (
    <span
      aria-hidden="true"
      className="bg-primary my-auto block h-1 w-full rounded-full"
      style={item.color ? { backgroundColor: item.color } : undefined}
    />
  ) : (
    <>
      <span className="block w-full truncate">{content}</span>
      {density === 'full' ? (
        <span className="text-on-surface-variant block w-full truncate text-[10px] leading-4 font-normal tabular-nums">
          {timeRange}
        </span>
      ) : (
        <span className="sr-only">, {timeRange}</span>
      )}
    </>
  );
}

/** Keep busy-only/private items readable without presenting a control that cannot open. */
export function SchedulingItemBody(props: SchedulingItemBodyProps): JSX.Element {
  const { item, density, timeRange, readOnlyDescriptionId, editable, openable, movable } = props;
  const bodyClassName =
    density === 'marker'
      ? 'focus-visible:ring-ring relative z-10 size-full overflow-hidden rounded-sm p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset'
      : 'text-on-surface focus-visible:ring-ring relative z-10 flex size-full min-w-0 flex-col overflow-hidden rounded-sm px-2 py-1 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset';
  const ariaLabel = density === 'marker' ? `${item.title}, ${timeRange}` : undefined;
  const describedBy = !editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined;
  const title = density === 'full' ? undefined : `${item.title} · ${timeRange}`;
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
      className={`${bodyClassName} ${movable ? 'cursor-grab' : ''}`}
      data-schedule-item-body={item.id}
      title={title}
      onPointerDown={movable ? props.onPointerDown : undefined}
      onClick={openable ? props.onClick : undefined}
    >
      {children}
    </button>
  );
}
