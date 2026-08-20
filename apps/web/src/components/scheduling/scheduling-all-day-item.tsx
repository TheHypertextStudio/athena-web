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
import { SchedulingLinkIcon } from './scheduling-item-icons';
import {
  scheduleAvailabilityFill,
  scheduleBusyFill,
  scheduleEventFill,
  scheduleTimeboxFill,
} from './scheduling-item-surface';
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

/** Render one all-day semantic surface with date manipulation and relationship controls. */
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
  const appearance = item.appearance ?? 'event';
  const itemTextClassName = appearance === 'event' ? 'text-on-primary' : 'text-on-surface';
  const edgePadding = `${exposesStartResize ? 'pl-3 [@media(pointer:coarse)]:pl-10' : ''} ${exposesEndResize ? 'pr-3 [@media(pointer:coarse)]:pr-10' : ''}`;
  const acceptsDrop = (event: ReactDragEvent<HTMLElement>): boolean =>
    item.dropTarget === true && event.dataTransfer.types.includes(SCHEDULE_DRAG_MIME);

  return (
    <div
      className={
        dropActive
          ? `${DRAGGABLE} ring-primary bg-primary-container group relative flex max-w-full items-center rounded-sm ring-2 ${edgePadding}`
          : gesture.preview
            ? `${DRAGGABLE} bg-primary-container ring-primary group relative z-40 flex max-w-full items-center rounded-sm ring-2 ${edgePadding}`
            : `${DRAGGABLE} group relative flex max-w-full items-center rounded-sm ${edgePadding}`
      }
      data-schedule-all-day-item={item.id}
      data-schedule-item-appearance={appearance}
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
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-sm ${
          dropActive || gesture.preview
            ? 'bg-primary-container'
            : appearance === 'timebox'
              ? 'border-outline border border-dashed'
              : appearance === 'availability' || appearance === 'busy'
                ? 'border-outline-variant border'
                : ''
        }`}
        data-schedule-item-surface=""
        style={
          dropActive || gesture.preview
            ? undefined
            : appearance === 'event'
              ? { backgroundColor: scheduleEventFill(item.color) }
              : appearance === 'timebox'
                ? {
                    backgroundColor: scheduleTimeboxFill(item.color),
                    borderLeftColor: 'var(--color-outline)',
                  }
                : {
                    backgroundColor:
                      appearance === 'availability'
                        ? scheduleAvailabilityFill(item.color)
                        : scheduleBusyFill(),
                  }
        }
      />
      <div
        className="contents"
        data-schedule-relationship-covered=""
        inert={isRelationshipTarget ? true : undefined}
      >
        {openable ? (
          <button
            type="button"
            aria-describedby={!editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined}
            className={`${itemTextClassName} text-label-medium focus-visible:ring-ring min-w-0 flex-1 touch-none truncate rounded px-1.5 py-0.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none [@media(pointer:coarse)]:min-h-10 ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
            data-schedule-item-body={item.id}
            onPointerDown={gesture.onBodyPointerDown}
            onClick={gesture.onBodyClick}
          >
            {renderItem?.({ item, lane, allDay: true, density: 'compact' }) ?? item.title}
            {previewLabel ? (
              <span className="text-label-large ml-1 tabular-nums">· {previewLabel}</span>
            ) : null}
          </button>
        ) : (
          <span
            aria-describedby={!editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined}
            className={`${itemTextClassName} text-label-medium min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left`}
            data-schedule-item-body={item.id}
          >
            {renderItem?.({ item, lane, allDay: true, density: 'compact' }) ?? item.title}
          </span>
        )}
        {/* The `id` sits on the text, not on the icon's box, so `aria-describedby` resolves to the
            words alone and a query for those words lands on the described element. */}
        {!editable && item.readOnlyLabel ? (
          <span id={readOnlyDescriptionId} className="sr-only">
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
            className="text-on-secondary-container focus-visible:ring-ring hover:bg-surface-container-high mx-0.5 size-4 shrink-0 cursor-grab rounded opacity-0 transition-[color,background-color,opacity] outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none [@media(pointer:coarse)]:size-10 [@media(pointer:coarse)]:opacity-100"
            activeClassName="bg-primary-container ring-primary/40 opacity-100 ring-2"
          >
            {/* Was a raw `↗` text glyph — a different symbol from the chain link the timed card
                uses for this same relationship-drag control, at a stroke weight nothing else on the
                surface shares. One control, one icon. It is also revealed on hover/focus now,
                matching the timed card, so a chip at rest is its title and nothing else. */}
            <SchedulingLinkIcon />
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
