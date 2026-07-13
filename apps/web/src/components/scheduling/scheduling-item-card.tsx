'use client';

import {
  type DragEvent as ReactDragEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react';

import { isScheduleItemEditable, itemBoundsInLane } from './scheduling-date-lanes';
import {
  readScheduleDragObject,
  SCHEDULE_DRAG_MIME,
  writeScheduleDragObject,
} from './scheduling-drag-object';
import {
  laneIndexAtOffset,
  MINUTES_PER_DAY,
  minutesToPixels,
  pixelDeltaToMinutes,
} from './scheduling-geometry';
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
  readonly displayTimezone: string;
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

/** Render and gesture-wire one timed item without owning any persistence. */
export function SchedulingItemCard({
  item,
  lane,
  laneIndex,
  lanes,
  laneWidth,
  pixelsPerHour,
  snapMinutes,
  displayTimezone,
  renderItem,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  onDropObjectOnItem,
}: SchedulingItemCardProps): JSX.Element | null {
  const bounds = itemBoundsInLane(item, lane, displayTimezone);
  const [dropActive, setDropActive] = useState(false);
  if (!bounds) return null;

  const editable = isScheduleItemEditable(item, lane);
  const top = minutesToPixels(bounds.startMinutes, pixelsPerHour);
  const height = Math.max(
    minutesToPixels(bounds.endMinutes - bounds.startMinutes, pixelsPerHour),
    18,
  );
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
          ? 'border-primary bg-primary-container absolute z-20 overflow-hidden rounded-md border shadow-md'
          : 'border-outline-variant bg-surface-container-low absolute z-10 overflow-hidden rounded-md border shadow-sm'
      }
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
        left: 4,
        right: 4,
        height,
        borderLeftWidth: 3,
        ...(item.color ? { borderLeftColor: item.color } : {}),
      }}
    >
      {editable && onResizeItem ? (
        <button
          type="button"
          aria-label={`Resize ${item.title} from start`}
          className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-ns-resize"
          onPointerDown={(event) => {
            beginResize('start', event);
          }}
        />
      ) : null}
      <button
        type="button"
        className="text-on-surface size-full truncate px-2 py-1 text-left text-xs font-medium"
        onClick={() => {
          onOpenItem?.({ item, lane });
        }}
      >
        {renderItem?.({ item, lane, allDay: false }) ?? item.title}
      </button>
      {editable && onMoveItem ? (
        <button
          type="button"
          aria-label={`Move ${item.title}`}
          className="absolute top-1 right-1 z-20 size-4 cursor-move rounded"
          onPointerDown={beginMove}
        >
          <span aria-hidden="true">⋮</span>
        </button>
      ) : null}
      {editable && onResizeItem ? (
        <button
          type="button"
          aria-label={`Resize ${item.title} from end`}
          className="absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-ns-resize"
          onPointerDown={(event) => {
            beginResize('end', event);
          }}
        />
      ) : null}
    </article>
  );
}
