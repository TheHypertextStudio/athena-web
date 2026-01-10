'use client';

import { useRef, useCallback, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { getYFromTime } from '@/lib/calendar-utils';
import { useCalendarTimezoneOptional } from '@/contexts/TimezoneContext';
import type { DayColumnProps, CalendarEntry } from './types';

export function DayColumn({
  date,
  entries,
  startHour,
  endHour,
  hourHeight,
  isToday,
  onEntryClick,
  onEntryContextMenu,
  columnIndex,
}: DayColumnProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const { formatTime } = useCalendarTimezoneOptional();

  const gridHeight = (endHour - startHour) * hourHeight;

  const handleEntryClick = useCallback(
    (entry: CalendarEntry, e: MouseEvent) => {
      e.stopPropagation();
      onEntryClick?.(entry, e);
    },
    [onEntryClick],
  );

  const handleEntryContextMenu = useCallback(
    (entry: CalendarEntry, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onEntryContextMenu?.(entry, e);
    },
    [onEntryContextMenu],
  );

  // Format day header
  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNumber = date.getDate();

  return (
    <div
      className={cn(
        'border-outline-variant/30 relative flex flex-1 flex-col border-r last:border-r-0',
        isToday && 'bg-primary/5',
      )}
      data-column-index={columnIndex}
    >
      {/* Day header */}
      <div className="border-outline-variant/30 sticky top-0 z-10 border-b bg-inherit px-1 py-2 text-center">
        <div className="text-on-surface-variant text-xs">{dayName}</div>
        <div
          className={cn(
            'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium',
            isToday ? 'bg-primary text-on-primary' : 'text-on-surface',
          )}
        >
          {dayNumber}
        </div>
      </div>

      {/* Time grid */}
      <div
        ref={columnRef}
        className="relative flex-1"
        style={{ minHeight: `${String(gridHeight)}px` }}
      >
        {/* Hour grid lines (faint) */}
        {Array.from({ length: endHour - startHour }, (_, i) => (
          <div
            key={i}
            className="border-outline-variant/20 absolute right-0 left-0 border-t"
            style={{ top: `${String(i * hourHeight)}px` }}
          />
        ))}

        {/* Entries */}
        {entries.map((entry) => {
          const top = getYFromTime(entry.startTime, startHour, hourHeight);
          const bottom = getYFromTime(entry.endTime, startHour, hourHeight);
          const height = Math.max(bottom - top, 20);

          const isTimeBlock = entry.type === 'time-block';

          return (
            <div
              key={entry.id}
              className={cn(
                'absolute right-0.5 left-0.5 cursor-pointer overflow-hidden rounded px-1 py-0.5',
                isTimeBlock ? 'bg-surface-container-highest' : 'bg-surface-container-high',
              )}
              style={{
                top: `${String(top)}px`,
                height: `${String(height)}px`,
              }}
              onClick={(e) => {
                handleEntryClick(entry, e);
              }}
              onContextMenu={(e) => {
                handleEntryContextMenu(entry, e);
              }}
              data-entry
            >
              <p className="text-on-surface truncate text-xs font-medium">{entry.title}</p>
              {height > 30 && (
                <p className="text-on-surface-variant truncate text-[10px]">
                  {formatTime(entry.startTime)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
