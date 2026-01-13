'use client';

import type { MouseEvent } from 'react';
import { useMemo, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import { cn } from '@/lib/utils';
import { getYFromTime, MIN_SLOT_MINUTES } from '@/lib/calendar-utils';
import { useCalendarTimezoneOptional } from '@/contexts/TimezoneContext';
import type { CalendarEntry, LinkedTask } from './types';

/**
 * Converts a hex color to RGB values.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result?.[1] || !result[2] || !result[3]) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Calculates relative luminance of a color for contrast checking.
 * Returns value between 0 (black) and 1 (white).
 */
function getLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Determines if dark text should be used on a given background color.
 * Uses WCAG relative luminance formula.
 */
function shouldUseDarkText(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true; // Default to dark text if parsing fails
  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);
  // Use dark text if background is light (luminance > 0.179)
  return luminance > 0.179;
}

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
function TimeBlockTask({
  task,
  onClick,
  useDarkText,
}: {
  task: LinkedTask;
  onClick?: (e: MouseEvent) => void;
  useDarkText: boolean;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 py-0.5 text-left"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <PriorityDot priority={task.priority} />
      <span
        className={cn('flex-1 truncate text-xs', useDarkText ? 'text-gray-800' : 'text-white/90')}
      >
        {task.title}
      </span>
      {task.estimateMinutes && (
        <span
          className={cn('shrink-0 text-[10px]', useDarkText ? 'text-gray-600' : 'text-white/60')}
        >
          {task.estimateMinutes}m
        </span>
      )}
    </button>
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

  // Use display times for positioning (clipped to day bounds for multi-day events)
  // Fall back to entry times if display times not set
  const positionStartTime = entry.displayStartTime ?? entry.startTime;
  const positionEndTime = entry.displayEndTime ?? entry.endTime;

  const baseTop = getYFromTime(positionStartTime, startHour, hourHeight);
  const bottom = getYFromTime(positionEndTime, startHour, hourHeight);
  const baseHeight = Math.max(bottom - baseTop, 24);

  // Use preview values when resizing
  const top = isResizing && resizePreviewTop !== undefined ? resizePreviewTop : baseTop;
  const height = isResizing && resizePreviewHeight !== undefined ? resizePreviewHeight : baseHeight;

  const isTimeBlock = entry.type === 'time-block';
  const hasTasks = isTimeBlock && entry.tasks && entry.tasks.length > 0;

  // Multi-day event continuation flags
  const continuesFromPreviousDay = entry.continuesFromPreviousDay ?? false;
  const continuesToNextDay = entry.continuesToNextDay ?? false;

  // All entries get a solid color fill
  const DEFAULT_ENTRY_COLOR = '#5f6368'; // Neutral gray
  const entryColor = entry.color ?? entry.accountColor ?? DEFAULT_ENTRY_COLOR;
  const useDarkText = shouldUseDarkText(entryColor);

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
    ...(!isPreview && { backgroundColor: entryColor }),
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
        'group absolute right-2 left-14 cursor-pointer overflow-hidden',
        'duration-medium2 ease-emphasized-decelerate transition-[top,height]',
        // Adjust border-radius for multi-day events
        !continuesFromPreviousDay && !continuesToNextDay && 'rounded-md',
        continuesFromPreviousDay && !continuesToNextDay && 'rounded-b-md',
        !continuesFromPreviousDay && continuesToNextDay && 'rounded-t-md',
        // No rounded corners if continues both ways
        isPreview && 'bg-primary/20 cursor-grab',
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
      {/* Continuation indicator - event continues from previous day */}
      {continuesFromPreviousDay && !isPreview && (
        <div
          className={cn(
            'absolute top-0 right-0 left-0 h-1',
            useDarkText ? 'bg-black/10' : 'bg-white/20',
          )}
          title="Continues from previous day"
        />
      )}

      {/* Top resize handle - not for preview or events continuing from previous day */}
      {!isPreview && !continuesFromPreviousDay && (
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
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'truncate text-sm font-medium',
                  useDarkText ? 'text-gray-900' : 'text-white',
                )}
              >
                {entry.title}
              </p>
              {!hasTasks && height > 40 && (
                <p
                  className={cn(
                    'truncate text-xs',
                    useDarkText ? 'text-gray-700' : 'text-white/80',
                  )}
                >
                  {formatTime(displayStartTime)} - {formatTime(displayEndTime)}
                </p>
              )}
              {!isTimeBlock && entry.location && height > 40 && (
                <p
                  className={cn(
                    'flex items-center gap-1 truncate text-xs',
                    useDarkText ? 'text-gray-700' : 'text-white/80',
                  )}
                >
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
                <TimeBlockTask
                  key={task.id}
                  task={task}
                  onClick={(e) => onTaskClick?.(task, e)}
                  useDarkText={useDarkText}
                />
              ))}
              {hiddenTaskCount > 0 && (
                <p
                  className={cn(
                    'pl-4 text-[10px]',
                    useDarkText ? 'text-gray-500' : 'text-white/50',
                  )}
                >
                  +{hiddenTaskCount} more
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Bottom resize handle - not for preview or events continuing to next day */}
      {!isPreview && !continuesToNextDay && (
        <div
          className="hover:bg-primary/20 absolute right-0 bottom-0 left-0 z-10 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart?.('bottom', e);
          }}
        />
      )}

      {/* Continuation indicator - event continues to next day */}
      {continuesToNextDay && !isPreview && (
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
