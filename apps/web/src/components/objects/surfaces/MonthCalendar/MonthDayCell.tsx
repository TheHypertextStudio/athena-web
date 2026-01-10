'use client';

import { cn } from '@/lib/utils';
import type { MonthDayCellProps, CalendarEntry } from './types';

const MAX_VISIBLE_ENTRIES = 3;

export function MonthDayCell({
  date,
  entries,
  isCurrentMonth,
  isToday,
  isSelected,
  onDayClick,
  onEntryClick,
}: MonthDayCellProps) {
  const dayNumber = date.getDate();
  const visibleEntries = entries.slice(0, MAX_VISIBLE_ENTRIES);
  const hiddenCount = entries.length - MAX_VISIBLE_ENTRIES;

  const handleDayClick = () => {
    onDayClick?.(date);
  };

  const handleEntryClick = (entry: CalendarEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    onEntryClick?.(entry, e);
  };

  return (
    <div
      className={cn(
        'border-outline-variant/30 min-h-[100px] cursor-pointer border-r border-b p-1 transition-colors',
        'hover:bg-surface-container-high',
        !isCurrentMonth && 'bg-surface-container-low/50',
        isSelected && 'bg-primary/10',
      )}
      onClick={handleDayClick}
    >
      {/* Day number */}
      <div className="mb-1 flex justify-end">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-sm',
            isToday && 'bg-primary text-on-primary font-medium',
            !isToday && isCurrentMonth && 'text-on-surface',
            !isToday && !isCurrentMonth && 'text-on-surface-variant/50',
          )}
        >
          {dayNumber}
        </span>
      </div>

      {/* Entry indicators */}
      <div className="space-y-0.5">
        {visibleEntries.map((entry) => (
          <button
            key={entry.id}
            className={cn(
              'w-full truncate rounded px-1 py-0.5 text-left text-xs',
              entry.type === 'time-block'
                ? 'bg-surface-container-highest text-on-surface'
                : 'bg-primary/20 text-primary',
            )}
            onClick={(e) => {
              handleEntryClick(entry, e);
            }}
          >
            {entry.title}
          </button>
        ))}
        {hiddenCount > 0 && (
          <div className="text-on-surface-variant px-1 text-xs">+{hiddenCount} more</div>
        )}
      </div>
    </div>
  );
}
