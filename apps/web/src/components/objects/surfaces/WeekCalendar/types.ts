/**
 * WeekCalendar Types
 *
 * @packageDocumentation
 */

import type { CalendarEntry, CalendarViewMode } from '../DayCalendar/types';

export type { CalendarEntry, CalendarViewMode };

export interface WeekCalendarProps {
  /** The reference date (any date in the week to display) */
  date: Date;
  /** Calendar entries to display */
  entries: CalendarEntry[];
  /** Current view mode */
  viewMode?: CalendarViewMode;
  /** Callback when view mode changes */
  onViewModeChange?: (mode: CalendarViewMode) => void;
  /** First hour to display (0-23) */
  startHour?: number;
  /** Last hour to display (1-24) */
  endHour?: number;
  /** Callback when date changes */
  onDateChange?: (date: Date) => void;
  /** Callback when user creates a time selection */
  onCreateSelection?: (startTime: Date, endTime: Date, anchorRect: DOMRect) => void;
  /** Callback when entry is clicked */
  onEntryClick?: (entry: CalendarEntry, e: React.MouseEvent) => void;
  /** Callback when entry context menu is opened */
  onEntryContextMenu?: (entry: CalendarEntry, e: React.MouseEvent) => void;
  /** Callback when entry is moved */
  onEntryMove?: (entryId: string, newStart: Date, newEnd: Date) => void;
  /** Callback when entry is resized */
  onEntryResize?: (entryId: string, newStart: Date, newEnd: Date) => void;
  /** Callback when empty slot is right-clicked */
  onSlotContextMenu?: (time: Date, e: React.MouseEvent) => void;
  /** Surface ID for selection context */
  id?: string;
  /** Additional CSS classes */
  className?: string;
}

export interface DayColumnProps {
  /** The date for this column */
  date: Date;
  /** Entries for this specific day */
  entries: CalendarEntry[];
  /** First hour to display */
  startHour: number;
  /** Last hour to display */
  endHour: number;
  /** Height of each hour in pixels */
  hourHeight: number;
  /** Whether this is today */
  isToday: boolean;
  /** Callback when entry is clicked */
  onEntryClick?: (entry: CalendarEntry, e: React.MouseEvent) => void;
  /** Callback when entry context menu is opened */
  onEntryContextMenu?: (entry: CalendarEntry, e: React.MouseEvent) => void;
  /** Callback when entry resize starts */
  onEntryResizeStart?: (entry: CalendarEntry, edge: 'top' | 'bottom', e: React.MouseEvent) => void;
  /** Callback when time selection is created */
  onCreateSelection?: (startTime: Date, endTime: Date, anchorRect: DOMRect) => void;
  /** Column index (0-6) */
  columnIndex: number;
}

export interface WeekHeaderProps {
  /** Start date of the week */
  weekStart: Date;
  /** Navigation controls */
  navigation: {
    goToPrevWeek: () => void;
    goToNextWeek: () => void;
    goToToday: () => void;
    weekLabel: string;
    isCurrentWeek: boolean;
  };
  /** Zoom controls */
  zoom: {
    zoom: number;
    zoomIn: () => void;
    zoomOut: () => void;
    canZoomIn: boolean;
    canZoomOut: boolean;
  };
  /** Current view mode */
  viewMode: CalendarViewMode;
  /** Callback when view mode changes */
  onViewModeChange?: (mode: CalendarViewMode) => void;
  /** Whether the calendar is scrolled */
  isScrolled: boolean;
}
