'use client';

import { type DragEvent as ReactDragEvent, type JSX, useId, useState } from 'react';

import {
  readScheduleDragObject,
  SCHEDULE_DRAG_MIME,
  writeScheduleDragObject,
} from './scheduling-drag-object';
import { isScheduleItemEditable } from './scheduling-date-lanes';
import type { ScheduleItem, ScheduleLane, SchedulingCanvasProps } from './scheduling-types';

/** Props for one openable and relationship-capable all-day pill. */
interface SchedulingAllDayItemProps {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
}

/** Render one all-day item without exposing unsupported timed manipulation controls. */
export function SchedulingAllDayItem({
  item,
  lane,
  renderItem,
  onOpenItem,
  onDropObjectOnItem,
}: SchedulingAllDayItemProps): JSX.Element {
  const [dropActive, setDropActive] = useState(false);
  const readOnlyDescriptionId = useId();
  const dragObject = item.dragObject;
  const editable = isScheduleItemEditable(item, lane);
  const acceptsDrop = (event: ReactDragEvent<HTMLElement>): boolean =>
    item.dropTarget === true && event.dataTransfer.types.includes(SCHEDULE_DRAG_MIME);

  return (
    <div
      className={
        dropActive
          ? 'ring-primary bg-primary-container flex max-w-full items-center rounded ring-2'
          : 'bg-secondary-container flex max-w-full items-center rounded'
      }
      data-schedule-all-day-item={item.id}
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
      <button
        type="button"
        aria-describedby={!editable && item.readOnlyLabel ? readOnlyDescriptionId : undefined}
        className="text-on-secondary-container focus-visible:ring-ring hover:bg-surface-container-high min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
        data-schedule-item-body={item.id}
        style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
        onClick={() => {
          onOpenItem?.({ item, lane });
        }}
      >
        {renderItem?.({ item, lane, allDay: true }) ?? item.title}
      </button>
      {!editable && item.readOnlyLabel ? (
        <span
          id={readOnlyDescriptionId}
          className="text-on-secondary-container pointer-events-none shrink-0 px-1 text-[9px] leading-none font-semibold"
        >
          {item.readOnlyLabel}
        </span>
      ) : null}
      {dragObject ? (
        <button
          type="button"
          draggable
          aria-label={`Drag ${item.title} to create a relationship`}
          className="text-on-secondary-container focus-visible:ring-ring hover:bg-surface-container-high mx-0.5 size-4 shrink-0 cursor-grab rounded transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none"
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
    </div>
  );
}
