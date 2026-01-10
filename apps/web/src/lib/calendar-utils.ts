/**
 * Calendar Utility Functions
 *
 * Pure utility functions for time/position conversions and formatting.
 * Used by DayCalendar and related components.
 */

import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar';
import type { Event, TimeBlock, CreateEventInput, CreateTimeBlockInput } from '@/lib/api-client';

// =============================================================================
// Constants
// =============================================================================

export const MIN_HOUR_HEIGHT = 32; // Minimum readable height
export const BASE_HOUR_HEIGHT = 60; // Base pixels per hour (shows ~10-12 hours in view)
export const MAX_ZOOM = 3;
export const MIN_ZOOM = 1;
export const MIN_SLOT_MINUTES = 5; // 5-minute granularity

// =============================================================================
// Time/Position Conversions
// =============================================================================

/**
 * Converts a Y coordinate to a Date, snapping to the configured grid.
 */
export function getTimeFromY(y: number, date: Date, startHour: number, hourHeight: number): Date {
  const hours = startHour + y / hourHeight;
  const wholeHours = Math.floor(hours);
  const minutes = Math.round(((hours - wholeHours) * 60) / MIN_SLOT_MINUTES) * MIN_SLOT_MINUTES;

  const result = new Date(date);
  result.setHours(wholeHours, minutes, 0, 0);
  return result;
}

/**
 * Converts a Date to a Y coordinate relative to the calendar grid.
 */
export function getYFromTime(time: Date, startHour: number, hourHeight: number): number {
  const hours = time.getHours() + time.getMinutes() / 60;
  return (hours - startHour) * hourHeight;
}

/**
 * Snaps a value to a grid increment.
 */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Formats an hour number to a display string (e.g., "9 AM", "12 PM").
 */
export function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${String(hour)} AM`;
  return `${String(hour - 12)} PM`;
}

/**
 * Formats a Date to a time string (e.g., "9:30 AM").
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Formats a Date to day label components.
 * Returns "Today", "Tomorrow", "Yesterday", or the weekday name.
 */
export function formatDayLabel(date: Date): { primary: string; secondary: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const secondary = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (dateOnly.getTime() === today.getTime()) {
    return { primary: 'Today', secondary };
  }
  if (dateOnly.getTime() === tomorrow.getTime()) {
    return { primary: 'Tomorrow', secondary };
  }
  if (dateOnly.getTime() === yesterday.getTime()) {
    return { primary: 'Yesterday', secondary };
  }

  return {
    primary: date.toLocaleDateString('en-US', { weekday: 'long' }),
    secondary,
  };
}

// =============================================================================
// Date Helpers
// =============================================================================

/**
 * Checks if a date is today.
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);
  return dateOnly.getTime() === today.getTime();
}

/**
 * Gets the start of today (midnight).
 */
export function getTodayDate(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/**
 * Creates a date with specified hour and minute on a given base date.
 */
export function createTimeOnDate(baseDate: Date, hour: number, minute = 0): Date {
  const result = new Date(baseDate);
  result.setHours(hour, minute, 0, 0);
  return result;
}

// =============================================================================
// API Type Mapping
// =============================================================================

/**
 * Convert an API Event to a CalendarEntry.
 */
export function eventToCalendarEntry(event: Event): CalendarEntry {
  return {
    id: event.id,
    type: 'event',
    title: event.title,
    startTime: new Date(event.startTime),
    endTime: event.endTime ? new Date(event.endTime) : new Date(event.startTime),
    location: event.location ?? undefined,
  };
}

/**
 * Convert an API TimeBlock to a CalendarEntry.
 */
export function timeBlockToCalendarEntry(block: TimeBlock): CalendarEntry {
  return {
    id: block.id,
    type: 'time-block',
    title: block.label,
    startTime: new Date(block.startTime),
    endTime: new Date(block.endTime),
    color: block.color ?? undefined,
    tasks: block.linkedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      completed: t.status === 'completed',
      estimateMinutes: undefined,
    })),
  };
}

/**
 * Convert arrays of Events and TimeBlocks to CalendarEntries.
 */
export function toCalendarEntries(events: Event[], timeBlocks: TimeBlock[]): CalendarEntry[] {
  const eventEntries = events.map(eventToCalendarEntry);
  const blockEntries = timeBlocks.map(timeBlockToCalendarEntry);

  // Combine and sort by start time
  return [...eventEntries, ...blockEntries].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );
}

/**
 * Convert a CalendarEntry to CreateEventInput.
 */
export function calendarEntryToEventInput(entry: Omit<CalendarEntry, 'id'>): CreateEventInput {
  return {
    title: entry.title,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime.toISOString(),
    location: entry.location,
    isAllDay: false,
  };
}

/**
 * Convert a CalendarEntry to CreateTimeBlockInput.
 */
export function calendarEntryToTimeBlockInput(
  entry: Omit<CalendarEntry, 'id'>,
): CreateTimeBlockInput {
  return {
    label: entry.title,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime.toISOString(),
    color: entry.color,
    taskIds: entry.tasks?.map((t) => t.id),
  };
}

/**
 * Convert update data for a CalendarEntry to Event update format.
 */
export function calendarUpdateToEventUpdate(
  updates: Partial<CalendarEntry>,
): Partial<CreateEventInput> {
  const result: Partial<CreateEventInput> = {};

  if (updates.title !== undefined) result.title = updates.title;
  if (updates.startTime !== undefined) result.startTime = updates.startTime.toISOString();
  if (updates.endTime !== undefined) result.endTime = updates.endTime.toISOString();
  if (updates.location !== undefined) result.location = updates.location;

  return result;
}

/**
 * Convert update data for a CalendarEntry to TimeBlock update format.
 */
export function calendarUpdateToTimeBlockUpdate(
  updates: Partial<CalendarEntry>,
): Partial<CreateTimeBlockInput> {
  const result: Partial<CreateTimeBlockInput> = {};

  if (updates.title !== undefined) result.label = updates.title;
  if (updates.startTime !== undefined) result.startTime = updates.startTime.toISOString();
  if (updates.endTime !== undefined) result.endTime = updates.endTime.toISOString();
  if (updates.color !== undefined) result.color = updates.color;

  return result;
}

/**
 * Get date string in YYYY-MM-DD format from a Date object.
 */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Get the start and end of a day as ISO strings.
 */
export function getDayBounds(date: Date): { startDate: string; endDate: string } {
  const startDate = toDateString(date);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const endDate = toDateString(nextDay);
  return { startDate, endDate };
}

/**
 * Get the start of the week (Sunday) for a given date.
 */
export function getStartOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  return result;
}

/**
 * Get the end of the week (Saturday 23:59:59) for a given date.
 */
export function getEndOfWeek(date: Date): Date {
  const startOfWeek = getStartOfWeek(date);
  const result = new Date(startOfWeek);
  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Get the start and end of a week as ISO strings.
 * Week starts on Sunday.
 */
export function getWeekBounds(date: Date): { startDate: string; endDate: string } {
  const startOfWeek = getStartOfWeek(date);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  return {
    startDate: toDateString(startOfWeek),
    endDate: toDateString(endOfWeek),
  };
}

/**
 * Get the start of the month for a given date.
 */
export function getStartOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(1);
  return result;
}

/**
 * Get the end of the month for a given date.
 */
export function getEndOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  result.setDate(0); // Last day of previous month
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Get the start and end of a month as ISO strings.
 * For calendar grid display, includes days from adjacent months to fill the grid.
 */
export function getMonthBounds(date: Date): { startDate: string; endDate: string } {
  const startOfMonth = getStartOfMonth(date);
  // Go back to the Sunday of the week containing the 1st
  const gridStart = getStartOfWeek(startOfMonth);

  const endOfMonth = getEndOfMonth(date);
  // Go forward to the Saturday of the week containing the last day
  const gridEnd = getEndOfWeek(endOfMonth);
  // Add one day for exclusive end bound
  const gridEndExclusive = new Date(gridEnd);
  gridEndExclusive.setDate(gridEndExclusive.getDate() + 1);

  return {
    startDate: toDateString(gridStart),
    endDate: toDateString(gridEndExclusive),
  };
}

/**
 * Get an array of dates for a week starting from a given date.
 */
export function getWeekDates(startDate: Date): Date[] {
  const dates: Date[] = [];
  const start = getStartOfWeek(startDate);
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    dates.push(date);
  }
  return dates;
}

/**
 * Get an array of dates for a month grid (6 weeks, 42 days).
 */
export function getMonthGridDates(date: Date): Date[] {
  const dates: Date[] = [];
  const startOfMonth = getStartOfMonth(date);
  const gridStart = getStartOfWeek(startOfMonth);

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    dates.push(cellDate);
  }
  return dates;
}

/**
 * Check if two dates are the same day.
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if a date is in the same month as a reference date.
 */
export function isSameMonth(date: Date, referenceDate: Date): boolean {
  return (
    date.getFullYear() === referenceDate.getFullYear() &&
    date.getMonth() === referenceDate.getMonth()
  );
}
