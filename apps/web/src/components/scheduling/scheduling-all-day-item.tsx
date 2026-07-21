'use client';

import { DRAGGABLE } from '@docket/ui/lib/draggable';
import { type DragEvent as ReactDragEvent, type JSX, type RefObject, useId, useState } from 'react';

import { readScheduleDragObject, SCHEDULE_DRAG_MIME } from './scheduling-drag-object';
import {
  formatAllDayDateRange,
  scheduleAllDayEditCapabilities,
} from './scheduling-all-day-editing';
import {
  SchedulingAllDayMoveControl,
  SchedulingAllDayResizeControl,
} from './scheduling-all-day-edit-controls';
import { isScheduleItemEditable } from './scheduling-date-lanes';
import {
  SchedulingRelationshipSourceControl,
  SchedulingRelationshipTargetControl,
} from './scheduling-relationship-controls';
import type { ScheduleItem, ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
import { useSchedulingAllDayGesture } from './use-scheduling-all-day-gesture';
import type { SchedulingRelationshipMode } from './use-scheduling-relationship-mode';

/** Props for one openable and relationship-capable all-day pill. */
interface SchedulingAllDayItemProps {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly displayTimezone: string;
  readonly laneWidth: number;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveAllDayItem?: SchedulingCanvasProps['onMoveAllDayItem'];
  readonly onResizeAllDayItem?: SchedulingCanvasProps['onResizeAllDayItem'];
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
  readonly relationshipMode: SchedulingRelationshipMode;
  readonly onGestureAnnouncementChange: (announcement: string) => void;
}

/** Render one all-day segment with true-edge date manipulation and relationship controls. */
export function SchedulingAllDayItem({
  item,
  lane,
  laneIndex,
  lanes,
  displayTimezone,
  laneWidth,
  viewportRef,
  renderItem,
  onOpenItem,
  onMoveAllDayItem,
  onResizeAllDayItem,
  onDropObjectOnItem,
  relationshipMode,
  onGestureAnnouncementChange,
}: SchedulingAllDayItemProps): JSX.Element {
  const [dropActive, setDropActive] = useState(false);
  const readOnlyDescriptionId = useId();
  const dragObject = item.dragObject;
  const editable = isScheduleItemEditable(item, lane);
  const openable = item.openable !== false;
  const editCapabilities = scheduleAllDayEditCapabilities(item, lane, displayTimezone);
  const gesture = useSchedulingAllDayGesture({
    item,
    lane,
    laneIndex,
    lanes,
    laneWidth,
    displayTimezone,
    viewportRef,
    canMove: editCapabilities.canMove,
    canResizeStart: editCapabilities.canResizeStart,
    canResizeEnd: editCapabilities.canResizeEnd,
    onOpenItem: openable ? onOpenItem : undefined,
    onMoveAllDayItem,
    onResizeAllDayItem,
    onAnnouncementChange: onGestureAnnouncementChange,
  });
  const movable = editCapabilities.canMove && onMoveAllDayItem !== undefined;
  const previewLabel = gesture.preview
    ? formatAllDayDateRange(gesture.preview.startDate, gesture.preview.endDate)
    : null;
  const laneTranslation = gesture.preview ? (gesture.preview.laneIndex - laneIndex) * laneWidth : 0;
  const exposesStartResize = editCapabilities.canResizeStart && onResizeAllDayItem !== undefined;
  const exposesEndResize = editCapabilities.canResizeEnd && onResizeAllDayItem !== undefined;
  const isRelationshipTarget = relationshipMode.isTarget(item);
  const edgePadding = `${exposesStartResize ? 'pl-3 [@media(pointer:coarse)]:pl-10' : ''} ${exposesEndResize ? 'pr-3 [@media(pointer:coarse)]:pr-10' : ''}`;
  const acceptsDrop = (event: ReactDragEvent<HTMLElement>): boolean =>
    item.dropTarget === true && event.dataTransfer.types.includes(SCHEDULE_DRAG_MIME);

  return (
    <div
      className={
        dropActive
          ? `${DRAGGABLE} ring-primary bg-primary-container group relative flex max-w-full items-center rounded ring-2 ${edgePadding}`
          : gesture.preview
            ? `${DRAGGABLE} border-primary bg-primary-container ring-primary/40 group relative z-40 flex max-w-full items-center rounded border shadow-lg ring-2 ${edgePadding}`
            : `${DRAGGABLE} bg-secondary-container group relative flex max-w-full items-center rounded ${edgePadding}`
      }
      data-schedule-all-day-item={item.id}
      data-schedule-all-day-preview={gesture.preview ? gesture.previewMode : undefined}
      style={{
        transform: laneTranslation === 0 ? undefined : `translateX(${String(laneTranslation)}px)`,
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
    >
      <div
        className="contents"
        data-schedule-relationship-covered=""
        inert={isRelationshipTarget ? true : undefined}
      >
        {openable ? (
          <button
            type="button"
            aria-describedby={!editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined}
            className={`text-on-secondary-container focus-visible:ring-ring hover:bg-surface-container-high min-w-0 flex-1 touch-none truncate rounded px-1.5 py-0.5 text-left text-[10px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none [@media(pointer:coarse)]:min-h-10 ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
            data-schedule-item-body={item.id}
            style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
            onPointerDown={gesture.onBodyPointerDown}
            onClick={gesture.onBodyClick}
          >
            {renderItem?.({ item, lane, allDay: true, density: 'compact' }) ?? item.title}
            {previewLabel ? (
              <span className="ml-1 font-semibold tabular-nums">· {previewLabel}</span>
            ) : null}
          </button>
        ) : (
          <span
            aria-describedby={!editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined}
            className="text-on-secondary-container min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-[10px]"
            data-schedule-item-body={item.id}
            style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
          >
            {renderItem?.({ item, lane, allDay: true, density: 'compact' }) ?? item.title}
          </span>
        )}
        {!editable && item.readOnlyLabel ? (
          <span
            id={readOnlyDescriptionId}
            className="text-on-secondary-container pointer-events-none shrink-0 px-1 text-[9px] leading-none font-semibold"
          >
            {item.readOnlyLabel}
          </span>
        ) : null}
        {exposesStartResize ? (
          <SchedulingAllDayResizeControl itemTitle={item.title} edge="start" gesture={gesture} />
        ) : null}
        {editCapabilities.canMove && onMoveAllDayItem ? (
          <SchedulingAllDayMoveControl itemTitle={item.title} gesture={gesture} />
        ) : null}
        {dragObject ? (
          <SchedulingRelationshipSourceControl
            item={item}
            object={dragObject}
            mode={relationshipMode}
            className="text-on-secondary-container focus-visible:ring-ring hover:bg-surface-container-high mx-0.5 size-4 shrink-0 cursor-grab rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none [@media(pointer:coarse)]:size-10"
            activeClassName="bg-primary-container ring-primary/40 ring-2"
          >
            <span aria-hidden="true">↗</span>
          </SchedulingRelationshipSourceControl>
        ) : null}
        {exposesEndResize ? (
          <SchedulingAllDayResizeControl itemTitle={item.title} edge="end" gesture={gesture} />
        ) : null}
      </div>
      <SchedulingRelationshipTargetControl
        item={item}
        lane={lane}
        mode={relationshipMode}
        className="ring-primary/70 focus-visible:ring-ring bg-primary/5 absolute inset-0 z-50 cursor-pointer rounded ring-2 outline-none ring-inset focus-visible:ring-4"
      />
    </div>
  );
}
