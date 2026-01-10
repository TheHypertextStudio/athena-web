'use client';

/**
 * MonthCalendar - Monthly grid calendar view
 *
 * Shows a full month with condensed entry indicators.
 * Clicking a day navigates to the day view.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { isSameDay, isSameMonth } from '@/lib/calendar-utils';
import { useMonthNavigation } from './hooks';
import { MonthHeader } from './MonthHeader';
import { MonthDayCell } from './MonthDayCell';
import type { MonthCalendarProps, CalendarEntry } from './types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthCalendar({
  date,
  entries,
  viewMode = 'month',
  onViewModeChange,
  onDateChange,
  onDayClick,
  onEntryClick,
  className,
}: MonthCalendarProps) {
  // Month navigation
  const navigation = useMonthNavigation({ date, onDateChange });

  // Group entries by day
  const entriesByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();

    for (const entry of entries) {
      const key = entry.startTime.toISOString().split('T')[0];
      if (key) {
        const existing = grouped.get(key);
        if (existing) {
          existing.push(entry);
        } else {
          grouped.set(key, [entry]);
        }
      }
    }

    return grouped;
  }, [entries]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Handle day click - navigate to day view
  const handleDayClick = (clickedDate: Date) => {
    onDateChange?.(clickedDate);
    onDayClick?.(clickedDate);
    // Switch to day view when clicking a day
    onViewModeChange?.('day');
  };

  return (
    <div className={cn('bg-surface-container flex flex-col overflow-hidden rounded-lg', className)}>
      <MonthHeader
        navigation={{
          goToPrevMonth: navigation.goToPrevMonth,
          goToNextMonth: navigation.goToNextMonth,
          goToToday: navigation.goToToday,
          monthLabel: navigation.monthLabel,
          isCurrentMonth: navigation.isCurrentMonth,
        }}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
      />

      {/* Weekday headers */}
      <div className="border-outline-variant/30 grid grid-cols-7 border-b">
        {WEEKDAY_LABELS.map((day) => (
          <div key={day} className="text-on-surface-variant py-2 text-center text-xs font-medium">
            {day}
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="grid flex-1 grid-cols-7">
        {navigation.gridDates.map((gridDate) => {
          const key = gridDate.toISOString().split('T')[0] ?? '';
          const dayEntries = entriesByDay.get(key) ?? [];

          return (
            <MonthDayCell
              key={key}
              date={gridDate}
              entries={dayEntries}
              isCurrentMonth={isSameMonth(gridDate, date)}
              isToday={isSameDay(gridDate, today)}
              isSelected={isSameDay(gridDate, date)}
              onDayClick={handleDayClick}
              onEntryClick={onEntryClick}
            />
          );
        })}
      </div>
    </div>
  );
}

export default MonthCalendar;
