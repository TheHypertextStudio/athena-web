'use client';

import type { MouseEvent } from 'react';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { getYFromTime } from '@/lib/calendar-utils';
import { useCalendarTimezoneOptional } from '@/contexts/TimezoneContext';
import { EntryHeader, EntryPreview, EntryTasks } from './CalendarEntryCardParts';
import { getEntryColor, shouldUseDarkText } from './calendar-entry-card-colors';
import type { CalendarEntry, LinkedTask } from './types';
import { useCalendarEntryDrag } from './useCalendarEntryDrag';

const MIN_ENTRY_HEIGHT_PX = 24;
const HEADER_HEIGHT_PX = 28;
const TASK_ROW_HEIGHT_PX = 20;
const RESIZE_HANDLE_HEIGHT_PX = 8;
const DETAILS_MIN_HEIGHT_PX = 40;

export interface CalendarEntryCardProps {
  entry: CalendarEntry;
  startHour: number;
  hourHeight: number;
  selected?: boolean;
  isResizing?: boolean;
  resizePreviewHeight?: number;
  resizePreviewTop?: number;
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onTaskClick?: (task: LinkedTask, e: MouseEvent) => void;
  onResizeStart?: (edge: 'top' | 'bottom', e: MouseEvent) => void;
  /** Preview mode - used for entries being created */
  isPreview?: boolean;
  /** Callback when preview entry is dragged to new position */
  onPreviewMove?: (newStart: Date, newEnd: Date) => void;
  /** Bounds for dragging */
  date?: Date;
  endHour?: number;
}

export function CalendarEntryCard({
  entry,
  startHour,
  hourHeight,
  selected,
  isResizing,
  resizePreviewHeight,
  resizePreviewTop,
  onClick,
  onContextMenu,
  onTaskClick,
  onResizeStart,
  isPreview,
  onPreviewMove,
  date,
  endHour = 24,
}: CalendarEntryCardProps) {
  const { formatTime } = useCalendarTimezoneOptional();

  const positionStartTime = entry.displayStartTime ?? entry.startTime;
  const positionEndTime = entry.displayEndTime ?? entry.endTime;

  const baseTop = getYFromTime(positionStartTime, startHour, hourHeight, date);
  const bottom = getYFromTime(positionEndTime, startHour, hourHeight, date);
  const baseHeight = Math.max(bottom - baseTop, MIN_ENTRY_HEIGHT_PX);

  const currentTop = isResizing && resizePreviewTop !== undefined ? resizePreviewTop : baseTop;
  const height = isResizing && resizePreviewHeight !== undefined ? resizePreviewHeight : baseHeight;

  const isTimeBlock = entry.type === 'time-block';
  const hasTasks = isTimeBlock && (entry.tasks?.length ?? 0) > 0;

  const continuesFromPreviousDay = entry.continuesFromPreviousDay ?? false;
  const continuesToNextDay = entry.continuesToNextDay ?? false;

  const entryColor = getEntryColor(entry);
  const useDarkText = shouldUseDarkText(entryColor);
  const isPreviewEntry = Boolean(isPreview);

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    snappedTransform,
    effectiveTop,
    dragPreviewTimes,
  } = useCalendarEntryDrag({
    entry,
    baseTop,
    currentTop,
    hourHeight,
    startHour,
    endHour,
    date,
    isPreview: isPreviewEntry,
    onPreviewMove,
  });

  const displayStartTime = dragPreviewTimes?.startTime ?? positionStartTime;
  const displayEndTime = dragPreviewTimes?.endTime ?? positionEndTime;

  const style = {
    top: `${String(effectiveTop)}px`,
    height: `${String(height)}px`,
    transform: CSS.Translate.toString(snappedTransform),
    ...(!isPreviewEntry && { backgroundColor: entryColor }),
  };

  const availableHeight = height - HEADER_HEIGHT_PX - RESIZE_HANDLE_HEIGHT_PX;
  const maxVisibleTasks = Math.max(0, Math.floor(availableHeight / TASK_ROW_HEIGHT_PX));
  const tasks = entry.tasks ?? [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group absolute right-2 left-14 cursor-pointer overflow-hidden',
        !isDragging &&
          !isResizing &&
          'duration-medium2 ease-emphasized-decelerate transition-[top,height]',
        !continuesFromPreviousDay && !continuesToNextDay && 'rounded-md',
        continuesFromPreviousDay && !continuesToNextDay && 'rounded-b-md',
        !continuesFromPreviousDay && continuesToNextDay && 'rounded-t-md',
        isPreviewEntry && 'bg-primary/20 cursor-grab',
        selected && !isPreviewEntry && 'ring-primary ring-2',
        isDragging && 'ring-primary z-50 ring-2',
        isDragging && isPreviewEntry && 'cursor-grabbing shadow-lg',
        isDragging && !isPreviewEntry && 'opacity-90',
        isResizing && 'ring-primary z-50 ring-2',
      )}
      data-entry={!isPreviewEntry || undefined}
      data-entry-id={!isPreviewEntry ? entry.id : undefined}
      data-entry-title={!isPreviewEntry ? entry.title : undefined}
      data-entry-type={!isPreviewEntry ? entry.type : undefined}
      data-preview-entry={isPreviewEntry ? true : undefined}
      onClick={isPreviewEntry ? undefined : onClick}
      onContextMenu={isPreviewEntry ? undefined : onContextMenu}
      {...attributes}
      {...listeners}
    >
      {/* Continuation indicator - event continues from previous day */}
      {continuesFromPreviousDay && !isPreviewEntry && (
        <div
          className={cn(
            'absolute top-0 right-0 left-0 h-1',
            useDarkText ? 'bg-black/10' : 'bg-white/20',
          )}
          title="Continues from previous day"
        />
      )}

      {/* Top resize handle - not for preview or events continuing from previous day */}
      {!isPreviewEntry && !continuesFromPreviousDay && (
        <div
          className="hover:bg-primary/20 absolute top-0 right-0 left-0 z-10 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart?.('top', e);
          }}
        />
      )}

      {/* Preview mode: simple time display */}
      {isPreviewEntry ? (
        <EntryPreview
          startTime={displayStartTime}
          endTime={displayEndTime}
          formatTime={formatTime}
        />
      ) : (
        <>
          {/* Header */}
          <EntryHeader
            entry={entry}
            hasTasks={hasTasks}
            isTimeBlock={isTimeBlock}
            showDetails={height > DETAILS_MIN_HEIGHT_PX}
            useDarkText={useDarkText}
            startTime={displayStartTime}
            endTime={displayEndTime}
            formatTime={formatTime}
          />

          {/* Tasks inside time block */}
          {hasTasks && (
            <EntryTasks
              tasks={tasks}
              maxVisibleTasks={maxVisibleTasks}
              useDarkText={useDarkText}
              onTaskClick={onTaskClick}
            />
          )}
        </>
      )}

      {/* Bottom resize handle - not for preview or events continuing to next day */}
      {!isPreviewEntry && !continuesToNextDay && (
        <div
          className="hover:bg-primary/20 absolute right-0 bottom-0 left-0 z-10 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart?.('bottom', e);
          }}
        />
      )}

      {/* Continuation indicator - event continues to next day */}
      {continuesToNextDay && !isPreviewEntry && (
        <div
          className={cn(
            'absolute right-0 bottom-0 left-0 h-1',
            useDarkText ? 'bg-black/10' : 'bg-white/20',
          )}
          title="Continues to next day"
        />
      )}
    </div>
  );
}
