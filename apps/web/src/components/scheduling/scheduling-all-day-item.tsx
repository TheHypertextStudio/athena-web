'use client';

import { type DragEvent as ReactDragEvent, type JSX, useState } from 'react';

import {
  readScheduleDragObject,
  SCHEDULE_DRAG_MIME,
  writeScheduleDragObject,
} from './scheduling-drag-object';
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
  const dragObject = item.dragObject;
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
        className="text-on-secondary-container min-w-0 flex-1 truncate px-1.5 py-0.5 text-left text-[10px]"
        style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
        onClick={() => {
          onOpenItem?.({ item, lane });
        }}
      >
        {renderItem?.({ item, lane, allDay: true }) ?? item.title}
      </button>
      {dragObject ? (
        <button
          type="button"
          draggable
          aria-label={`Drag ${item.title} to create a relationship`}
          className="focus-visible:ring-ring mx-0.5 size-4 shrink-0 cursor-grab rounded outline-none focus-visible:ring-2 focus-visible:ring-inset"
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
