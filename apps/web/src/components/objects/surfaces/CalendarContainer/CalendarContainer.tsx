'use client';

/**
 * CalendarContainer - Unified calendar view container
 *
 * Orchestrates switching between Day, Week, and Month views.
 * Manages shared state like selected date and view mode.
 */

import { DayCalendar } from '../DayCalendar';
import { WeekCalendar } from '../WeekCalendar';
import { MonthCalendar } from '../MonthCalendar';
import { useCalendarViewMode } from '@/hooks/useCalendarViewMode';
import type { CalendarEntry, CalendarViewMode } from '../DayCalendar/types';
import type { SurfaceId } from '@/components/objects/types';

export interface CalendarContainerProps {
  /** Current selected date */
  date: Date;
  /** Calendar entries to display */
  entries: CalendarEntry[];
  /** Callback when date changes */
  onDateChange?: (date: Date) => void;
  /** First hour to display (for day/week views) */
  startHour?: number;
  /** Last hour to display (for day/week views) */
  endHour?: number;
  /** Scroll mode for day view */
  scrollMode?: 'fit' | 'scroll';
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
  id?: SurfaceId;
  /** Additional CSS classes */
  className?: string;
  /** Preview entry for creation flow */
  previewEntry?: { startTime: Date; endTime: Date } | null;
  /** Callback when preview entry is moved */
  onPreviewMove?: (newStart: Date, newEnd: Date) => void;
  /** External view mode control (optional - uses internal state if not provided) */
  viewMode?: CalendarViewMode;
  /** External view mode change handler */
  onViewModeChange?: (mode: CalendarViewMode) => void;
}

export function CalendarContainer({
  date,
  entries,
  onDateChange,
  startHour = 0,
  endHour = 24,
  scrollMode = 'scroll',
  onCreateSelection,
  onEntryClick,
  onEntryContextMenu,
  onEntryMove,
  onEntryResize,
  onSlotContextMenu,
  id,
  className,
  previewEntry,
  onPreviewMove,
  viewMode: externalViewMode,
  onViewModeChange: externalOnViewModeChange,
}: CalendarContainerProps) {
  // Use internal view mode state if not controlled externally
  const { viewMode: internalViewMode, setViewMode: internalSetViewMode } = useCalendarViewMode();

  const viewMode = externalViewMode ?? internalViewMode;
  const handleViewModeChange = (mode: CalendarViewMode) => {
    if (externalOnViewModeChange) {
      externalOnViewModeChange(mode);
    } else {
      internalSetViewMode(mode);
    }
  };

  // Common props for all views
  const commonProps = {
    date,
    entries,
    viewMode,
    onViewModeChange: handleViewModeChange,
    onDateChange,
    onEntryClick,
    onEntryContextMenu,
    className,
  };

  switch (viewMode) {
    case 'week':
      return (
        <WeekCalendar
          {...commonProps}
          startHour={startHour}
          endHour={endHour}
          onEntryMove={onEntryMove}
          onEntryResize={onEntryResize}
          onSlotContextMenu={onSlotContextMenu}
        />
      );

    case 'month':
      return (
        <MonthCalendar
          {...commonProps}
          onDayClick={(clickedDate) => {
            onDateChange?.(clickedDate);
          }}
        />
      );

    case 'day':
    default:
      return (
        <DayCalendar
          {...commonProps}
          startHour={startHour}
          endHour={endHour}
          scrollMode={scrollMode}
          onCreateSelection={onCreateSelection}
          onEntryMove={onEntryMove}
          onEntryResize={onEntryResize}
          onSlotContextMenu={onSlotContextMenu}
          id={id}
          previewEntry={previewEntry}
          onPreviewMove={onPreviewMove}
        />
      );
  }
}

export default CalendarContainer;
