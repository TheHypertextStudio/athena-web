'use client';

import {
  type DragEvent as ReactDragEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react';

import { isScheduleItemEditable, type ScheduleItemLaneBounds } from './scheduling-date-lanes';
import {
  readScheduleDragObject,
  SCHEDULE_DRAG_MIME,
  writeScheduleDragObject,
} from './scheduling-drag-object';
import { laneIndexAtOffset, MINUTES_PER_DAY, pixelDeltaToMinutes } from './scheduling-geometry';
import {
  scheduleOverlapHorizontalStyle,
  type ScheduleOverlapPlacement,
} from './scheduling-overlap-layout';
import type {
  ScheduleItem,
  ScheduleItemResize,
  ScheduleLane,
  SchedulingCanvasProps,
} from './scheduling-types';

/** Props for one timed item rendered inside a scheduling lane. */
export interface SchedulingItemCardProps {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly laneWidth: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly bounds: ScheduleItemLaneBounds;
  readonly top: number;
  readonly height: number;
  readonly placement: ScheduleOverlapPlacement;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveItem?: SchedulingCanvasProps['onMoveItem'];
  readonly onResizeItem?: SchedulingCanvasProps['onResizeItem'];
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
}

/** Keep a moved interval inside one 24-hour lane without changing its duration. */
function clampMovedInterval(
  startMinutes: number,
  endMinutes: number,
  deltaMinutes: number,
): { startMinutes: number; endMinutes: number } {
  const duration = endMinutes - startMinutes;
  const nextStart = Math.max(0, Math.min(MINUTES_PER_DAY - duration, startMinutes + deltaMinutes));
  return { startMinutes: nextStart, endMinutes: nextStart + duration };
}

type ScheduleItemDensity = 'marker' | 'compact' | 'full';

const WALL_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  hour: 'numeric',
  minute: '2-digit',
});

/** Choose how much card detail fits without obscuring adjacent times. */
function itemDensity(height: number): ScheduleItemDensity {
  if (height < 24) return 'marker';
  if (height < 48) return 'compact';
  return 'full';
}

/** Format clipped wall-minute bounds with the viewer's locale conventions. */
function formatTimeRange(bounds: ScheduleItemLaneBounds): string {
  const atWallMinutes = (minutes: number): Date =>
    new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  const start = WALL_TIME_FORMATTER.format(atWallMinutes(bounds.startMinutes));
  const end = WALL_TIME_FORMATTER.format(atWallMinutes(bounds.endMinutes));
  return `${start} – ${end}`;
}

/** Render and gesture-wire one timed item without owning any persistence. */
export function SchedulingItemCard({
  item,
  lane,
  laneIndex,
  lanes,
  laneWidth,
  pixelsPerHour,
  snapMinutes,
  bounds,
  top,
  height,
  placement,
  renderItem,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  onDropObjectOnItem,
}: SchedulingItemCardProps): JSX.Element {
  const [dropActive, setDropActive] = useState(false);
  const editable = isScheduleItemEditable(item, lane);
  const density = itemDensity(height);
  const timeRange = formatTimeRange(bounds);
  const content = renderItem?.({ item, lane, allDay: false }) ?? item.title;
  const horizontalStyle = scheduleOverlapHorizontalStyle(placement);
  const acceptsDrop = (event: ReactDragEvent<HTMLElement>): boolean =>
    item.dropTarget === true && event.dataTransfer.types.includes(SCHEDULE_DRAG_MIME);

  const beginMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!onMoveItem) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const laneRegion = event.currentTarget.closest<HTMLElement>('[data-schedule-lane-region]');
    const laneRegionLeft = laneRegion?.getBoundingClientRect().left;
    const onPointerUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointerup', onPointerUp);
      const targetIndex =
        laneRegionLeft !== undefined
          ? laneIndexAtOffset(upEvent.clientX - laneRegionLeft, lanes.length, laneWidth)
          : laneIndex;
      const toLane = targetIndex === null ? lane : (lanes[targetIndex] ?? lane);
      const deltaMinutes = pixelDeltaToMinutes(
        upEvent.clientY - startY,
        pixelsPerHour,
        snapMinutes,
      );
      const moved = clampMovedInterval(bounds.startMinutes, bounds.endMinutes, deltaMinutes);
      if (toLane.id === lane.id && moved.startMinutes === bounds.startMinutes) return;
      onMoveItem({ item, fromLane: lane, toLane, ...moved });
    };
    window.addEventListener('pointerup', onPointerUp);
  };

  const beginResize = (
    edge: ScheduleItemResize['edge'],
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (!onResizeItem) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const onPointerUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointerup', onPointerUp);
      const deltaMinutes = pixelDeltaToMinutes(
        upEvent.clientY - startY,
        pixelsPerHour,
        snapMinutes,
      );
      const next =
        edge === 'start'
          ? {
              startMinutes: Math.max(
                0,
                Math.min(bounds.endMinutes - snapMinutes, bounds.startMinutes + deltaMinutes),
              ),
              endMinutes: bounds.endMinutes,
            }
          : {
              startMinutes: bounds.startMinutes,
              endMinutes: Math.min(
                MINUTES_PER_DAY,
                Math.max(bounds.startMinutes + snapMinutes, bounds.endMinutes + deltaMinutes),
              ),
            };
      if (next.startMinutes === bounds.startMinutes && next.endMinutes === bounds.endMinutes)
        return;
      onResizeItem({ item, lane, edge, ...next });
    };
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <article
      className={
        dropActive
          ? 'border-primary bg-primary-container ring-primary/30 absolute z-30 overflow-hidden rounded-md border shadow-md ring-2'
          : 'border-outline-variant bg-surface-container-low absolute z-10 overflow-hidden rounded-md border shadow-sm transition-[box-shadow,transform] focus-within:z-20 focus-within:shadow-md hover:z-20 hover:shadow-md motion-safe:hover:-translate-y-px'
      }
      data-item-density={density}
      data-layout-column={placement.columnIndex}
      data-layout-column-count={placement.columnCount}
      data-schedule-item={item.id}
      draggable={item.dragObject !== undefined}
      onDragStart={(event) => {
        if (item.dragObject) writeScheduleDragObject(event.dataTransfer, item.dragObject);
      }}
      onDragOver={(event) => {
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'link';
        setDropActive(true);
      }}
      onDragLeave={() => {
        setDropActive(false);
      }}
      onDrop={(event) => {
        setDropActive(false);
        if (!acceptsDrop(event) || !onDropObjectOnItem) return;
        event.preventDefault();
        const object = readScheduleDragObject(event.dataTransfer);
        if (!object || (object.kind === 'calendar_item' && object.itemId === item.id)) return;
        onDropObjectOnItem({ object, targetItem: item, targetLane: lane });
      }}
      style={{
        top,
        ...horizontalStyle,
        height,
        borderLeftWidth: 3,
        ...(item.color && !dropActive
          ? {
              borderColor: item.color,
              borderLeftColor: item.color,
              backgroundColor: `color-mix(in srgb, ${item.color} 12%, var(--color-surface-container-low))`,
            }
          : {}),
      }}
    >
      {editable && onResizeItem ? (
        <button
          type="button"
          aria-label={`Resize ${item.title} from start`}
          className="focus-visible:ring-ring absolute inset-x-0 top-0 z-20 h-1.5 cursor-ns-resize rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
          onPointerDown={(event) => {
            beginResize('start', event);
          }}
        />
      ) : null}
      <button
        type="button"
        aria-label={item.title}
        className={
          density === 'marker'
            ? 'focus-visible:ring-ring relative z-10 size-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset'
            : 'text-on-surface focus-visible:ring-ring relative z-10 flex size-full min-w-0 flex-col overflow-hidden px-2 py-1 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset'
        }
        title={density === 'full' ? undefined : `${item.title} · ${timeRange}`}
        onClick={() => {
          onOpenItem?.({ item, lane });
        }}
      >
        {density === 'marker' ? (
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
            ) : null}
          </>
        )}
      </button>
      {editable && onMoveItem ? (
        <button
          type="button"
          aria-label={`Move ${item.title}`}
          className="focus-visible:ring-ring absolute top-1 right-1 z-20 size-4 cursor-move rounded outline-none focus-visible:ring-2 focus-visible:ring-inset"
          onPointerDown={beginMove}
        >
          <span aria-hidden="true">⋮</span>
        </button>
      ) : null}
      {editable && onResizeItem ? (
        <button
          type="button"
          aria-label={`Resize ${item.title} from end`}
          className="focus-visible:ring-ring absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-ns-resize rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
          onPointerDown={(event) => {
            beginResize('end', event);
          }}
        />
      ) : null}
    </article>
  );
}
