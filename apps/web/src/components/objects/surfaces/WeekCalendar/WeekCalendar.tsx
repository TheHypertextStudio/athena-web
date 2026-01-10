'use client';

/**
 * WeekCalendar - 7-day calendar view
 *
 * Shows a full week with entries distributed across day columns.
 * Supports navigation, zoom, and entry interactions.
 */

import { useRef, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { isSameDay, formatHour } from '@/lib/calendar-utils';
import { useContainerSize, useScrollState, useCalendarZoom } from '../DayCalendar/hooks';
import { useWeekNavigation } from './hooks';
import { WeekHeader } from './WeekHeader';
import { DayColumn } from './DayColumn';
import type { WeekCalendarProps, CalendarEntry } from './types';

export function WeekCalendar({
  date,
  entries,
  viewMode = 'week',
  onViewModeChange,
  startHour = 0,
  endHour = 24,
  onDateChange,
  onEntryClick,
  onEntryContextMenu,
  className,
}: WeekCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Container and scroll state
  const { height: containerHeight } = useContainerSize({ ref: scrollRef });
  const { isScrolled } = useScrollState({ scrollRef });

  // Week navigation
  const navigation = useWeekNavigation({ date, onDateChange });

  // Zoom
  const numberOfHours = endHour - startHour;
  const { zoom, hourHeight, zoomIn, zoomOut, canZoomIn, canZoomOut } = useCalendarZoom({
    scrollRef,
    containerHeight,
    numberOfHours,
    scrollMode: 'scroll',
  });

  // Group entries by day
  const entriesByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();

    for (const weekDate of navigation.weekDates) {
      const key = weekDate.toISOString().split('T')[0];
      if (key) {
        grouped.set(key, []);
      }
    }

    for (const entry of entries) {
      const key = entry.startTime.toISOString().split('T')[0];
      if (key) {
        const dayEntries = grouped.get(key);
        if (dayEntries) {
          dayEntries.push(entry);
        }
      }
    }

    return grouped;
  }, [entries, navigation.weekDates]);

  // Hour labels
  const hours = useMemo(() => {
    return Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  }, [startHour, endHour]);

  const gridHeight = (endHour - startHour) * hourHeight;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className={cn('bg-surface-container flex flex-col overflow-hidden rounded-lg', className)}>
      <WeekHeader
        weekStart={navigation.weekStart}
        navigation={{
          goToPrevWeek: navigation.goToPrevWeek,
          goToNextWeek: navigation.goToNextWeek,
          goToToday: navigation.goToToday,
          weekLabel: navigation.weekLabel,
          isCurrentWeek: navigation.isCurrentWeek,
        }}
        zoom={{ zoom, zoomIn, zoomOut, canZoomIn, canZoomOut }}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        isScrolled={isScrolled}
      />

      {/* Scrollable calendar body */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="flex" style={{ minHeight: `${String(gridHeight + 60)}px` }}>
          {/* Hour labels column */}
          <div className="sticky left-0 z-20 w-12 flex-shrink-0 bg-inherit pt-[60px]">
            {hours.map((hour) => (
              <div key={hour} className="relative" style={{ height: `${String(hourHeight)}px` }}>
                <span className="text-on-surface-variant absolute -top-2 right-2 text-xs">
                  {formatHour(hour)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="flex flex-1">
            {navigation.weekDates.map((weekDate, index) => {
              const key = weekDate.toISOString().split('T')[0] ?? '';
              const dayEntries = entriesByDay.get(key) ?? [];

              return (
                <DayColumn
                  key={key}
                  date={weekDate}
                  entries={dayEntries}
                  startHour={startHour}
                  endHour={endHour}
                  hourHeight={hourHeight}
                  isToday={isSameDay(weekDate, today)}
                  onEntryClick={onEntryClick}
                  onEntryContextMenu={onEntryContextMenu}
                  columnIndex={index}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WeekCalendar;
