'use client';

import { type DragEvent as ReactDragEvent, type JSX, type RefObject, useId, useState } from 'react';

import { isScheduleItemEditable, type ScheduleItemLaneBounds } from './scheduling-date-lanes';
import {
  readScheduleDragObject,
  SCHEDULE_DRAG_MIME,
  writeScheduleDragObject,
} from './scheduling-drag-object';
import { MINUTES_PER_DAY, minutesToPixels } from './scheduling-geometry';
import {
  scheduleOverlapHorizontalStyle,
  type ScheduleOverlapPlacement,
} from './scheduling-overlap-layout';
import { SchedulingItemBody, type ScheduleItemDensity } from './scheduling-item-body';
import { formatScheduleItemTimeRange } from './scheduling-time-label';
import type { ScheduleItem, ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
import { useSchedulingGesture } from './use-scheduling-gesture';

const MINIMUM_PREVIEW_HEIGHT = 18;

/** Props for one timed item rendered inside a scheduling lane. */
export interface SchedulingItemCardProps {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly displayTimezone: string;
  readonly laneWidth: number;
  readonly gutterWidth: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly bounds: ScheduleItemLaneBounds;
  readonly top: number;
  readonly height: number;
  readonly placement: ScheduleOverlapPlacement;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveItem?: SchedulingCanvasProps['onMoveItem'];
  readonly onResizeItem?: SchedulingCanvasProps['onResizeItem'];
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
  readonly onGestureAnnouncementChange: (announcement: string) => void;
}

/** Choose how much card detail fits without obscuring adjacent times. */
function itemDensity(height: number): ScheduleItemDensity {
  if (height < 24) return 'marker';
  if (height < 48) return 'compact';
  return 'full';
}

/** Render and gesture-wire one timed item without owning any persistence. */
export function SchedulingItemCard({
  item,
  lane,
  laneIndex,
  lanes,
  displayTimezone,
  laneWidth,
  gutterWidth,
  pixelsPerHour,
  snapMinutes,
  bounds,
  top,
  height,
  placement,
  viewportRef,
  renderItem,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  onDropObjectOnItem,
  onGestureAnnouncementChange,
}: SchedulingItemCardProps): JSX.Element {
  const [dropActive, setDropActive] = useState(false);
  const readOnlyDescriptionId = useId();
  const editable = isScheduleItemEditable(item, lane);
  const gesture = useSchedulingGesture({
    item,
    lane,
    laneIndex,
    lanes,
    laneWidth,
    gutterWidth,
    pixelsPerHour,
    snapMinutes,
    bounds,
    editable,
    viewportRef,
    onOpenItem: item.openable === false ? undefined : onOpenItem,
    onMoveItem,
    onResizeItem,
    formatPreviewTimeRange: (mode, preview) =>
      formatScheduleItemTimeRange({
        item,
        lane,
        laneIndex,
        lanes,
        displayTimezone,
        bounds,
        preview,
        previewMode: mode,
      }),
    onAnnouncementChange: onGestureAnnouncementChange,
  });
  const visibleBounds = gesture.preview ?? bounds;
  const visibleTop = gesture.preview
    ? minutesToPixels(visibleBounds.startMinutes, pixelsPerHour)
    : top;
  const visibleHeight = gesture.preview
    ? Math.max(
        MINIMUM_PREVIEW_HEIGHT,
        minutesToPixels(visibleBounds.endMinutes - visibleBounds.startMinutes, pixelsPerHour),
      )
    : height;
  const laneTranslation = gesture.preview ? (gesture.preview.laneIndex - laneIndex) * laneWidth : 0;
  const density = itemDensity(visibleHeight);
  const startsAtDayBoundary = visibleBounds.startMinutes === 0;
  const endsAtDayBoundary = visibleBounds.endMinutes === MINUTES_PER_DAY;
  const resizeTargetClassName =
    'focus-visible:ring-ring absolute z-20 size-6 max-w-full cursor-ns-resize touch-none bg-transparent pointer-events-none outline-none group-focus-within:pointer-events-auto group-hover:pointer-events-auto focus-visible:ring-2 focus-visible:ring-inset [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:pointer-events-auto';
  const resizeIndicatorClassName =
    'bg-primary/70 pointer-events-none absolute h-0.5 w-3 max-w-full rounded-full opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:opacity-100';
  const timeRange = formatScheduleItemTimeRange({
    item,
    lane,
    laneIndex,
    lanes,
    displayTimezone,
    bounds,
    preview: gesture.preview,
    previewMode: gesture.previewMode,
  });
  const content = renderItem?.({ item, lane, allDay: false }) ?? item.title;
  const dragObject = item.dragObject;
  const bodyOpenable = item.openable !== false;
  const bodyMovable = editable && onMoveItem !== undefined;
  const horizontalStyle = scheduleOverlapHorizontalStyle(placement);
  const acceptsDrop = (event: ReactDragEvent<HTMLElement>): boolean =>
    item.dropTarget === true && event.dataTransfer.types.includes(SCHEDULE_DRAG_MIME);

  return (
    <article
      className={
        dropActive
          ? 'border-primary bg-primary-container ring-primary/30 group absolute z-30 overflow-visible rounded-md border shadow-md ring-2'
          : 'border-outline-variant bg-surface-container-low group absolute z-10 overflow-visible rounded-md border shadow-sm transition-shadow focus-within:z-20 focus-within:shadow-md hover:z-20 hover:shadow-md motion-reduce:transition-none'
      }
      data-item-density={density}
      data-layout-column={placement.columnIndex}
      data-layout-column-count={placement.columnCount}
      data-schedule-item={item.id}
      data-gesture-preview={gesture.preview ? gesture.previewMode : undefined}
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
        top: visibleTop,
        ...horizontalStyle,
        height: visibleHeight,
        transform: laneTranslation === 0 ? undefined : `translateX(${String(laneTranslation)}px)`,
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
          className={`${resizeTargetClassName} left-0 ${startsAtDayBoundary ? 'top-0' : '-top-3 [@media(pointer:coarse)]:-top-8'}`}
          data-schedule-resize-target="start"
          onPointerDown={gesture.onStartResizePointerDown}
          onKeyDown={gesture.onStartResizeKeyDown}
        >
          <span
            aria-hidden="true"
            className={`${resizeIndicatorClassName} right-0 ${startsAtDayBoundary ? 'top-0' : 'bottom-2.5'}`}
            data-schedule-resize-indicator="start"
          />
        </button>
      ) : null}
      <SchedulingItemBody
        item={item}
        density={density}
        timeRange={timeRange}
        content={content}
        readOnlyDescriptionId={readOnlyDescriptionId}
        editable={editable}
        openable={bodyOpenable}
        movable={bodyMovable}
        onPointerDown={gesture.onBodyPointerDown}
        onClick={gesture.onBodyClick}
      />
      {!editable && item.readOnlyLabel ? (
        <span
          id={readOnlyDescriptionId}
          className="bg-surface/90 text-on-surface-variant pointer-events-none absolute right-0.5 bottom-0.5 z-30 max-w-[calc(100%-0.25rem)] truncate rounded px-1 py-0.5 text-[9px] leading-none font-semibold"
        >
          {item.readOnlyLabel}
        </span>
      ) : null}
      {editable && onMoveItem ? (
        <button
          type="button"
          aria-label={`Move ${item.title}`}
          className="text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container-highest focus-visible:ring-ring absolute top-1 right-1 z-30 size-4 cursor-move rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
          onPointerDown={gesture.onMovePointerDown}
          onKeyDown={gesture.onMoveKeyDown}
        >
          <span aria-hidden="true">⋮</span>
        </button>
      ) : null}
      {dragObject ? (
        <button
          type="button"
          draggable
          aria-label={`Drag ${item.title} to create a relationship`}
          className="text-on-surface-variant hover:bg-surface-container-high active:bg-surface-container-highest focus-visible:ring-ring absolute bottom-1 left-1 z-30 size-4 cursor-grab rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDragStart={(event) => {
            event.stopPropagation();
            writeScheduleDragObject(event.dataTransfer, dragObject);
          }}
        >
          <span aria-hidden="true">↗</span>
        </button>
      ) : null}
      {editable && onResizeItem ? (
        <button
          type="button"
          aria-label={`Resize ${item.title} from end`}
          className={`${resizeTargetClassName} right-0 ${endsAtDayBoundary ? 'bottom-0' : '-bottom-3 [@media(pointer:coarse)]:-bottom-8'}`}
          data-schedule-resize-target="end"
          onPointerDown={gesture.onEndResizePointerDown}
          onKeyDown={gesture.onEndResizeKeyDown}
        >
          <span
            aria-hidden="true"
            className={`${resizeIndicatorClassName} left-0 ${endsAtDayBoundary ? 'bottom-0' : 'top-2.5'}`}
            data-schedule-resize-indicator="end"
          />
        </button>
      ) : null}
    </article>
  );
}
