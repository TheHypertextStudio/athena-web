'use client';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ViewDayOutlinedIcon from '@mui/icons-material/ViewDayOutlined';
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import { cn } from '@/lib/utils';
import { TimezoneSelector } from '@/components/calendar/TimezoneSelector';
import type { MonthHeaderProps } from './types';

export function MonthHeader({ navigation, viewMode, onViewModeChange }: MonthHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          onClick={navigation.goToPrevMonth}
          className="hover:bg-surface-container-high cursor-pointer rounded-md p-1.5 transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeftIcon sx={{ fontSize: 20 }} className="text-on-surface-variant" />
        </button>
        <button onClick={navigation.goToToday} className="min-w-[160px] cursor-pointer text-center">
          <span
            className={cn(
              'text-lg font-semibold',
              navigation.isCurrentMonth ? 'text-on-surface' : 'text-on-surface-variant',
            )}
          >
            {navigation.monthLabel}
          </span>
        </button>
        <button
          onClick={navigation.goToNextMonth}
          className="hover:bg-surface-container-high cursor-pointer rounded-md p-1.5 transition-colors"
          aria-label="Next month"
        >
          <ChevronRightIcon sx={{ fontSize: 20 }} className="text-on-surface-variant" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        {/* Timezone selector */}
        <TimezoneSelector />

        {/* View toggle */}
        <div className="bg-surface-container-high flex items-center rounded-lg p-1">
          <button
            onClick={() => onViewModeChange?.('day')}
            className={cn(
              'cursor-pointer rounded-md p-1.5 transition-colors',
              viewMode === 'day'
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
            aria-label="Day view"
          >
            <ViewDayOutlinedIcon sx={{ fontSize: 20 }} />
          </button>
          <button
            onClick={() => onViewModeChange?.('week')}
            className={cn(
              'cursor-pointer rounded-md p-1.5 transition-colors',
              viewMode === 'week'
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
            aria-label="Week view"
          >
            <ViewWeekOutlinedIcon sx={{ fontSize: 20 }} />
          </button>
          <button
            onClick={() => onViewModeChange?.('month')}
            className={cn(
              'cursor-pointer rounded-md p-1.5 transition-colors',
              viewMode === 'month'
                ? 'bg-surface-container-highest text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
            aria-label="Month view"
          >
            <CalendarMonthOutlinedIcon sx={{ fontSize: 20 }} />
          </button>
        </div>
      </div>
    </div>
  );
}
