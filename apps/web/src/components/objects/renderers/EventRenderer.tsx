'use client';

/**
 * EventRenderer - Visual Representation of Events
 *
 * Renders calendar events and time blocks with appropriate variants.
 * Follows MD3 Expressive design language.
 */

import { forwardRef, type MouseEvent } from 'react';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import InsertLinkOutlined from '@mui/icons-material/InsertLinkOutlined';
import DragIndicator from '@mui/icons-material/DragIndicator';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { EventObject, RenderVariant, DragHandleProps } from '../types';

// =============================================================================
// Types
// =============================================================================

interface EventRendererProps {
  /** The event object */
  object: EventObject;

  /** Display variant */
  variant?: RenderVariant;

  /** Selection state */
  selected?: boolean;

  /** Focus state */
  focused?: boolean;

  /** Drag state */
  dragging?: boolean;

  /** Drop target state */
  dropTarget?: boolean;

  /** Drag handle props (for handle-based dragging) */
  dragHandleProps?: DragHandleProps | null;

  /** Whether this is a time block (scheduled task) */
  isTimeBlock?: boolean;

  /** Linked task title (for time blocks) */
  linkedTaskTitle?: string;

  /** Event category for styling */
  category?: 'work' | 'personal' | 'deadline' | 'external';

  /** Callback when event is clicked */
  onClick?: (event: MouseEvent) => void;

  /** Whether resize handles should be shown */
  showResizeHandles?: boolean;

  /** Callback for resize start */
  onResizeStart?: (edge: 'top' | 'bottom') => void;

  /** Additional class names */
  className?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function formatTimeRange(start: Date, end?: Date): string {
  const startStr = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (!end) return startStr;

  const endStr = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${startStr} - ${endStr}`;
}

function getDurationMinutes(start: Date, end?: Date): number {
  if (!end) return 0;
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(mins)}m`;
}

// =============================================================================
// Category Styles
// =============================================================================

const categoryStyles = {
  work: {
    container: 'bg-primary-container border-primary',
    text: 'text-on-primary-container',
  },
  personal: {
    container: 'bg-tertiary-container border-tertiary',
    text: 'text-on-tertiary-container',
  },
  deadline: {
    container: 'bg-error-container border-error',
    text: 'text-on-error-container',
  },
  external: {
    container: 'bg-surface-container-high border-outline',
    text: 'text-on-surface',
  },
};

const timeBlockStyles = {
  container: 'bg-secondary-container/50 border-secondary-container border-dashed',
  text: 'text-on-secondary-container',
};

// =============================================================================
// Compact Variant (for lists)
// =============================================================================

function EventCompact({
  object,
  selected,
  dragging,
  isTimeBlock,
  category = 'work',
  onClick,
  className,
}: EventRendererProps) {
  const event = object.data;
  const styles = isTimeBlock ? timeBlockStyles : categoryStyles[category];
  const duration = getDurationMinutes(event.startTime, event.endTime);

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
        'border',
        styles.container,
        selected && 'ring-primary ring-2',
        dragging && 'opacity-50',
        className,
      )}
      onClick={onClick}
    >
      {isTimeBlock && <span className="text-xs">▦</span>}
      <span className={cn('flex-1 truncate text-sm', styles.text)}>{event.title}</span>
      {duration > 0 && (
        <span className="text-on-surface-variant text-xs">{formatDuration(duration)}</span>
      )}
    </div>
  );
}

// =============================================================================
// Normal Variant (calendar block)
// =============================================================================

function EventNormal({
  object,
  selected,
  focused,
  dragging,
  dragHandleProps,
  isTimeBlock,
  linkedTaskTitle,
  category = 'work',
  onClick,
  showResizeHandles,
  onResizeStart,
  className,
}: EventRendererProps) {
  const event = object.data;
  const styles = isTimeBlock ? timeBlockStyles : categoryStyles[category];
  const duration = getDurationMinutes(event.startTime, event.endTime);

  return (
    <div
      className={cn(
        'relative h-full rounded-lg border p-2 transition-all',
        styles.container,
        selected && 'ring-primary shadow-md ring-2',
        focused && 'ring-primary ring-2',
        dragging && 'opacity-90 shadow-lg',
        className,
      )}
      onClick={onClick}
    >
      {/* Top resize handle */}
      {showResizeHandles && (
        <div
          className="hover:bg-primary/20 absolute top-0 right-0 left-0 h-2 cursor-ns-resize rounded-t-lg"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart?.('top');
          }}
        />
      )}

      {/* Content */}
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-1">
          {isTimeBlock && <span className={cn('text-xs', styles.text)}>▦</span>}
          <p className={cn('flex-1 truncate text-sm font-medium', styles.text)}>{event.title}</p>
          {dragHandleProps && (
            <div
              ref={dragHandleProps.setNodeRef}
              className="cursor-grab opacity-50 hover:opacity-100 active:cursor-grabbing"
              {...dragHandleProps.attributes}
              {...dragHandleProps.listeners}
            >
              <DragIndicator sx={{ fontSize: 12 }} />
            </div>
          )}
        </div>

        {/* Location or Duration */}
        <div className="mt-1 space-y-0.5">
          {event.location && (
            <div className="flex items-center gap-1">
              <PlaceOutlined sx={{ fontSize: 12 }} className="text-on-surface-variant" />
              <span className="text-on-surface-variant truncate text-xs">{event.location}</span>
            </div>
          )}

          {duration > 0 && (
            <div className="flex items-center gap-1">
              <ScheduleOutlined sx={{ fontSize: 12 }} className="text-on-surface-variant" />
              <span className="text-on-surface-variant text-xs">{formatDuration(duration)}</span>
            </div>
          )}

          {linkedTaskTitle && (
            <div className="flex items-center gap-1">
              <InsertLinkOutlined sx={{ fontSize: 12 }} className="text-on-surface-variant" />
              <span className="text-on-surface-variant truncate text-xs">{linkedTaskTitle}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom resize handle */}
      {showResizeHandles && (
        <div
          className="hover:bg-primary/20 absolute right-0 bottom-0 left-0 flex h-2 cursor-ns-resize items-center justify-center rounded-b-lg"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeStart?.('bottom');
          }}
        >
          <span className="text-on-surface-variant text-xs opacity-0 group-hover:opacity-100">
            ↕
          </span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Expanded Variant (detail view)
// =============================================================================

function EventExpanded({
  object,
  selected,
  isTimeBlock,
  linkedTaskTitle,
  category = 'work',
  onClick,
  className,
}: EventRendererProps) {
  const event = object.data;
  const styles = isTimeBlock ? timeBlockStyles : categoryStyles[category];
  const duration = getDurationMinutes(event.startTime, event.endTime);

  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border p-4',
        styles.container,
        selected && 'ring-primary ring-2',
        className,
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        {isTimeBlock && <span className={cn('text-lg', styles.text)}>▦</span>}
        <h3 className={cn('text-lg font-medium', styles.text)}>{event.title}</h3>
      </div>

      {/* Description */}
      {event.description && <p className="text-on-surface-variant text-sm">{event.description}</p>}

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-on-surface-variant">Time</span>
          <p className="mt-1">{formatTimeRange(event.startTime, event.endTime)}</p>
        </div>

        {duration > 0 && (
          <div>
            <span className="text-on-surface-variant">Duration</span>
            <p className="mt-1">{formatDuration(duration)}</p>
          </div>
        )}

        {event.location && (
          <div>
            <span className="text-on-surface-variant">Location</span>
            <p className="mt-1 flex items-center gap-1">
              <PlaceOutlined sx={{ fontSize: 16 }} />
              {event.location}
            </p>
          </div>
        )}

        {linkedTaskTitle && (
          <div>
            <span className="text-on-surface-variant">Linked Task</span>
            <p className="mt-1 flex items-center gap-1">
              <InsertLinkOutlined sx={{ fontSize: 16 }} />
              {linkedTaskTitle}
            </p>
          </div>
        )}

        {event.isAllDay && (
          <div>
            <span className="text-on-surface-variant">Type</span>
            <p className="mt-1">All Day</p>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export const EventRenderer = forwardRef<HTMLDivElement, EventRendererProps>(function EventRenderer(
  { variant = 'normal', ...props },
  ref,
) {
  const Component = {
    compact: EventCompact,
    normal: EventNormal,
    expanded: EventExpanded,
  }[variant];

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
    >
      <Component {...props} />
    </motion.div>
  );
});
