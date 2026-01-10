/**
 * MonthCalendar Types
 *
 * @packageDocumentation
 */

import type { CalendarEntry, CalendarViewMode } from '../DayCalendar/types';

export type { CalendarEntry, CalendarViewMode };

export interface MonthCalendarProps {
  /** The reference date (any date in the month to display) */
  date: Date;
  /** Calendar entries to display */
  entries: CalendarEntry[];
  /** Current view mode */
  viewMode?: CalendarViewMode;
  /** Callback when view mode changes */
  onViewModeChange?: (mode: CalendarViewMode) => void;
  /** Callback when date changes */
  onDateChange?: (date: Date) => void;
  /** Callback when a day is clicked (navigates to day view) */
  onDayClick?: (date: Date) => void;
  /** Callback when entry is clicked */
  onEntryClick?: (entry: CalendarEntry, e: React.MouseEvent) => void;
  /** Surface ID for selection context */
  id?: string;
  /** Additional CSS classes */
  className?: string;
}

export interface MonthDayCellProps {
  /** The date for this cell */
  date: Date;
  /** Entries for this specific day */
  entries: CalendarEntry[];
  /** Whether this date is in the current month */
  isCurrentMonth: boolean;
  /** Whether this is today */
  isToday: boolean;
  /** Whether this is the selected date */
  isSelected: boolean;
  /** Callback when day is clicked */
  onDayClick?: (date: Date) => void;
  /** Callback when entry is clicked */
  onEntryClick?: (entry: CalendarEntry, e: React.MouseEvent) => void;
}

export interface MonthHeaderProps {
  /** Navigation controls */
  navigation: {
    goToPrevMonth: () => void;
    goToNextMonth: () => void;
    goToToday: () => void;
    monthLabel: string;
    isCurrentMonth: boolean;
  };
  /** Current view mode */
  viewMode: CalendarViewMode;
  /** Callback when view mode changes */
  onViewModeChange?: (mode: CalendarViewMode) => void;
}
