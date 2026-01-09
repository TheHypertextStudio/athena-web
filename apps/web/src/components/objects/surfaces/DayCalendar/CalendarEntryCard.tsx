'use client';

import type { MouseEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import { cn } from '@/lib/utils';
import { getYFromTime, formatTime } from '@/lib/calendar-utils';
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
}: CalendarEntryCardProps) {
  const baseTop = getYFromTime(entry.startTime, startHour, hourHeight);
  const bottom = getYFromTime(entry.endTime, startHour, hourHeight);
  const baseHeight = Math.max(bottom - baseTop, 24);

  // Use preview values when resizing
  const top = isResizing && resizePreviewTop !== undefined ? resizePreviewTop : baseTop;
  const height = isResizing && resizePreviewHeight !== undefined ? resizePreviewHeight : baseHeight;

  const isTimeBlock = entry.type === 'time-block';
  const hasTasks = isTimeBlock && entry.tasks && entry.tasks.length > 0;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.id,
    data: {
      type: entry.type,
      entry,
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
        isTimeBlock ? 'bg-surface-container-highest' : 'bg-surface-container-high',
        selected && 'ring-primary ring-2',
        isDragging && 'ring-primary z-50 opacity-90 ring-2 transition-none',
        isResizing && 'ring-primary z-50 ring-2 transition-none',
      )}
      data-entry
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      {/* Top resize handle */}
      <div
        className="hover:bg-primary/20 absolute top-0 right-0 left-0 z-10 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart?.('top', e);
        }}
      />

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
              {formatTime(entry.startTime)} - {formatTime(entry.endTime)}
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
            <p className="text-on-surface-variant/60 pl-4 text-[10px]">+{hiddenTaskCount} more</p>
          )}
        </div>
      )}

      {/* Bottom resize handle */}
      <div
        className="hover:bg-primary/20 absolute right-0 bottom-0 left-0 z-10 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart?.('bottom', e);
        }}
      />
    </div>
  );
}
