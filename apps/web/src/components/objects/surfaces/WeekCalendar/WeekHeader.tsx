'use client';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ViewDayOutlinedIcon from '@mui/icons-material/ViewDayOutlined';
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import { cn } from '@/lib/utils';
import { TimezoneSelector } from '@/components/calendar/TimezoneSelector';
import type { WeekHeaderProps } from './types';

export function WeekHeader({
  navigation,
  zoom,
  viewMode,
  onViewModeChange,
  isScrolled,
}: WeekHeaderProps) {
  return (
    <div
      className={cn(
        'duration-medium1 ease-standard flex items-center justify-between px-4 py-3 transition-[shadow,background-color]',
        isScrolled && 'bg-surface-container-high shadow-md',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={navigation.goToPrevWeek}
          className="hover:bg-surface-container-high cursor-pointer rounded-md p-1.5 transition-colors"
          aria-label="Previous week"
        >
          <ChevronLeftIcon sx={{ fontSize: 20 }} className="text-on-surface-variant" />
        </button>
        <button onClick={navigation.goToToday} className="min-w-[180px] cursor-pointer text-center">
          <span
            className={cn(
              'text-lg font-semibold',
              navigation.isCurrentWeek ? 'text-on-surface' : 'text-on-surface-variant',
            )}
          >
            {navigation.weekLabel}
          </span>
        </button>
        <button
          onClick={navigation.goToNextWeek}
          className="hover:bg-surface-container-high cursor-pointer rounded-md p-1.5 transition-colors"
          aria-label="Next week"
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

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={zoom.zoomOut}
            disabled={!zoom.canZoomOut}
            className="hover:bg-surface-container-high cursor-pointer rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Zoom out"
          >
            <ZoomOutIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
          </button>
          <span className="text-on-surface-variant w-10 text-center text-xs tabular-nums">
            {zoom.zoom}x
          </span>
          <button
            onClick={zoom.zoomIn}
            disabled={!zoom.canZoomIn}
            className="hover:bg-surface-container-high cursor-pointer rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Zoom in"
          >
            <ZoomInIcon sx={{ fontSize: 16 }} className="text-on-surface-variant" />
          </button>
        </div>
      </div>
    </div>
  );
}
