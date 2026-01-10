import type { MouseEvent } from 'react';
import type { SurfaceId } from '../../types';

// =============================================================================
// Entry Types
// =============================================================================

/** A task linked to a time block */
export interface LinkedTask {
  id: string;
  title: string;
  completed?: boolean;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  estimateMinutes?: number;
}

export interface CalendarEntry {
  id: string;
  type: 'event' | 'time-block';
  title: string;
  startTime: Date;
  endTime: Date;
  color?: string;
  location?: string;
  /** For time blocks, the primary linked task ID */
  taskId?: string;
  /** Tasks scheduled within this time block */
  tasks?: LinkedTask[];
  /** RRULE string for recurring entries */
  recurrenceRule?: string;
  /** True if this entry is an instance of a recurring series */
  isRecurringInstance?: boolean;
  /** The date of this specific instance (for recurring entries) */
  instanceDate?: Date;
  /** The parent entry ID (for recurring instances) */
  seriesId?: string;
  /** True if this instance has been modified from the series */
  isModified?: boolean;
}

// =============================================================================
// View Mode Types
// =============================================================================

export type CalendarViewMode = 'day' | 'week' | 'month';

/** Scroll behavior mode */
export type CalendarScrollMode = 'fit' | 'scroll';

// =============================================================================
// Component Props
// =============================================================================

export interface DayCalendarProps {
  /** The date to display */
  date: Date;
  /** Calendar entries (events and time blocks) */
  entries: CalendarEntry[];
  /** Current view mode */
  viewMode?: CalendarViewMode;
  /** Called when view mode changes */
  onViewModeChange?: (mode: CalendarViewMode) => void;
  /** Scroll mode: 'fit' fills container exactly, 'scroll' allows infinite scrolling */
  scrollMode?: CalendarScrollMode;
  /** Called when scroll mode changes */
  onScrollModeChange?: (mode: CalendarScrollMode) => void;
  /** Start hour to display (default 0) */
  startHour?: number;
  /** End hour to display (default 24) */
  endHour?: number;
  /** Called when date changes via navigation */
  onDateChange?: (date: Date) => void;
  /** Called when user creates a new time selection */
  onCreateSelection?: (start: Date, end: Date, anchorRect: DOMRect) => void;
  /** Called when an entry is clicked */
  onEntryClick?: (entry: CalendarEntry, event: MouseEvent) => void;
  /** Called when an entry is right-clicked */
  onEntryContextMenu?: (entry: CalendarEntry, event: MouseEvent) => void;
  /** Called when an entry is moved */
  onEntryMove?: (entryId: string, newStart: Date, newEnd: Date) => void;
  /** Called when an entry is resized */
  onEntryResize?: (entryId: string, newStart: Date, newEnd: Date) => void;
  /** Called when a slot is clicked */
  onSlotClick?: (time: Date) => void;
  /** Called when a slot is right-clicked */
  onSlotContextMenu?: (time: Date, event: MouseEvent) => void;
  /** Called when a task inside a time block is clicked */
  onTaskClick?: (task: LinkedTask, entry: CalendarEntry, event: MouseEvent) => void;
  /** Surface ID for selection tracking */
  id?: SurfaceId;
  /** Additional class names */
  className?: string;
  /** Preview entry shown while creating */
  previewEntry?: {
    startTime: Date;
    endTime: Date;
  } | null;
  /** Called when the preview entry is dragged to a new position */
  onPreviewMove?: (newStart: Date, newEnd: Date) => void;
}
