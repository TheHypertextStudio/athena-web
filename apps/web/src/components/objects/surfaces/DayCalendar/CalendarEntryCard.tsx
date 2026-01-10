'use client';

import type { MouseEvent } from 'react';
import { useMemo, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import { cn } from '@/lib/utils';
import { getYFromTime, MIN_SLOT_MINUTES } from '@/lib/calendar-utils';
import { useCalendarTimezoneOptional } from '@/contexts/TimezoneContext';
import type { CalendarEntry, LinkedTask } from './types';

// =============================================================================
// Sub-components
// =============================================================================

/** Priority indicator dot */
function PriorityDot({ priority }: { priority?: LinkedTask['priority'] }) {
  const colors = {
    urgent: 'bg-error',
    high: 'bg-warning',
    medium: 'bg-primary',
    low: 'bg-outline-variant',
  };
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', colors[priority ?? 'medium'])} />;
}

/** Task item rendered inside a time block (display only, not completable) */
function TimeBlockTask({ task, onClick }: { task: LinkedTask; onClick?: (e: MouseEvent) => void }) {
  return (
    <div
      className="flex items-center gap-1.5 py-0.5"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <PriorityDot priority={task.priority} />
      <span className="text-on-secondary-container flex-1 truncate text-xs">{task.title}</span>
      {task.estimateMinutes && (
        <span className="text-on-secondary-container/50 shrink-0 text-[10px]">
          {task.estimateMinutes}m
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

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
  // Use timezone-aware formatting
  const { formatTime } = useCalendarTimezoneOptional();

  const baseTop = getYFromTime(entry.startTime, startHour, hourHeight);
  const bottom = getYFromTime(entry.endTime, startHour, hourHeight);
  const baseHeight = Math.max(bottom - baseTop, 24);

  // Use preview values when resizing
  const top = isResizing && resizePreviewTop !== undefined ? resizePreviewTop : baseTop;
  const height = isResizing && resizePreviewHeight !== undefined ? resizePreviewHeight : baseHeight;

  const isTimeBlock = entry.type === 'time-block';
  const hasTasks = isTimeBlock && entry.tasks && entry.tasks.length > 0;

  // Use synthetic ID for preview entries
  const draggableId = isPreview ? 'preview-entry' : entry.id;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: {
      type: isPreview ? 'preview' : entry.type,
      entry,
      isPreview,
    },
  });

  // Snap transform to grid (5-minute increments) and lock horizontal movement
  const snappedTransform = transform
    ? {
        ...transform,
        x: 0, // Lock horizontal - no other days to drag to in day view
        y: Math.round(transform.y / (hourHeight / 12)) * (hourHeight / 12),
      }
    : null;

  // Calculate preview times during drag
  const dragPreviewTimes = useMemo(() => {
    if (!isDragging || !snappedTransform) return null;

    const pixelsPerMinute = hourHeight / 60;
    const deltaMinutes =
      Math.round(snappedTransform.y / pixelsPerMinute / MIN_SLOT_MINUTES) * MIN_SLOT_MINUTES;

    if (deltaMinutes === 0) return null;

    const duration = entry.endTime.getTime() - entry.startTime.getTime();
    let newStart = new Date(entry.startTime.getTime() + deltaMinutes * 60 * 1000);
    let newEnd = new Date(newStart.getTime() + duration);

    // Clamp to bounds if date is provided
    if (date) {
      const minTime = new Date(date);
      minTime.setHours(startHour, 0, 0, 0);
      const maxTime = new Date(date);
      maxTime.setHours(endHour, 0, 0, 0);

      if (newStart < minTime) {
        newStart = minTime;
        newEnd = new Date(minTime.getTime() + duration);
      }
      if (newEnd > maxTime) {
        newEnd = maxTime;
        newStart = new Date(maxTime.getTime() - duration);
      }
    }

    return { startTime: newStart, endTime: newEnd };
  }, [
    isDragging,
    snappedTransform,
    hourHeight,
    entry.startTime,
    entry.endTime,
    date,
    startHour,
    endHour,
  ]);

  // Call onPreviewMove when preview is being dragged
  useEffect(() => {
    if (isPreview && isDragging && dragPreviewTimes && onPreviewMove) {
      onPreviewMove(dragPreviewTimes.startTime, dragPreviewTimes.endTime);
    }
  }, [isPreview, isDragging, dragPreviewTimes, onPreviewMove]);

  // Use preview times when dragging, otherwise use entry times
  const displayStartTime = dragPreviewTimes?.startTime ?? entry.startTime;
  const displayEndTime = dragPreviewTimes?.endTime ?? entry.endTime;

  const style = {
    top: `${String(top)}px`,
    height: `${String(height)}px`,
    transform: CSS.Translate.toString(snappedTransform),
  };

  // Calculate how many tasks can fit based on height
  const HEADER_HEIGHT = 28;
  const TASK_HEIGHT = 20;
  const RESIZE_HANDLE_HEIGHT = 8;
  const availableHeight = height - HEADER_HEIGHT - RESIZE_HANDLE_HEIGHT;
  const maxVisibleTasks = Math.max(0, Math.floor(availableHeight / TASK_HEIGHT));
  const visibleTasks = entry.tasks?.slice(0, maxVisibleTasks) ?? [];
  const hiddenTaskCount = (entry.tasks?.length ?? 0) - visibleTasks.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group absolute right-2 left-14 cursor-pointer overflow-hidden rounded-md',
        'duration-medium2 ease-emphasized-decelerate transition-[top,height]',
        isPreview
          ? 'bg-primary/20 cursor-grab'
          : isTimeBlock
            ? 'bg-surface-container-highest'
            : 'bg-surface-container-high',
        selected && !isPreview && 'ring-primary ring-2',
        isDragging && 'ring-primary z-50 ring-2 transition-none',
        isDragging && isPreview && 'cursor-grabbing shadow-lg',
        isDragging && !isPreview && 'opacity-90',
        isResizing && 'ring-primary z-50 ring-2 transition-none',
      )}
      data-entry={!isPreview || undefined}
      data-preview-entry={isPreview ? true : undefined}
      onClick={isPreview ? undefined : onClick}
      onContextMenu={isPreview ? undefined : onContextMenu}
      {...attributes}
      {...listeners}
    >
      {/* Top resize handle - not for preview */}
      {!isPreview && (
        <div
          className="hover:bg-primary/20 absolute top-0 right-0 left-0 z-10 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart?.('top', e);
          }}
        />
      )}

      {/* Preview mode: simple time display */}
      {isPreview ? (
        <div className="flex h-full items-center justify-center px-2 py-1">
          <p className="text-primary truncate text-sm font-medium">
            {formatTime(displayStartTime)} - {formatTime(displayEndTime)}
          </p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start gap-1.5 px-2 py-1">
            {isTimeBlock && (
              <GridViewOutlinedIcon
                sx={{ fontSize: 14 }}
                className="text-on-surface-variant mt-0.5 shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-on-surface truncate text-sm font-medium">{entry.title}</p>
              {!hasTasks && height > 40 && (
                <p className="text-on-surface-variant truncate text-xs">
                  {formatTime(displayStartTime)} - {formatTime(displayEndTime)}
                </p>
              )}
              {!isTimeBlock && entry.location && height > 40 && (
                <p className="text-on-surface-variant flex items-center gap-1 truncate text-xs">
                  <PlaceOutlinedIcon sx={{ fontSize: 12 }} />
                  {entry.location}
                </p>
              )}
            </div>
          </div>

          {/* Tasks inside time block */}
          {hasTasks && (
            <div className="space-y-0.5 px-2 pb-1">
              {visibleTasks.map((task) => (
                <TimeBlockTask key={task.id} task={task} onClick={(e) => onTaskClick?.(task, e)} />
              ))}
              {hiddenTaskCount > 0 && (
                <p className="text-on-surface-variant/60 pl-4 text-[10px]">
                  +{hiddenTaskCount} more
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Bottom resize handle - not for preview */}
      {!isPreview && (
        <div
          className="hover:bg-primary/20 absolute right-0 bottom-0 left-0 z-10 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart?.('bottom', e);
          }}
        />
      )}
    </div>
  );
}
