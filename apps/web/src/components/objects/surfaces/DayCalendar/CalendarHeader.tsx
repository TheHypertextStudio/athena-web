'use client';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ViewDayOutlinedIcon from '@mui/icons-material/ViewDayOutlined';
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import { cn } from '@/lib/utils';
import type { CalendarViewMode } from './types';
import type { UseCalendarNavigationReturn } from './hooks/useCalendarNavigation';
import { TimezoneSelector } from '@/components/calendar/TimezoneSelector';

export interface CalendarHeaderProps {
  isScrolled: boolean;
  navigation: UseCalendarNavigationReturn;
  zoom: {
    zoom: number;
    zoomIn: () => void;
    zoomOut: () => void;
    canZoomIn: boolean;
    canZoomOut: boolean;
  };
  viewMode: CalendarViewMode;
  onViewModeChange?: (mode: CalendarViewMode) => void;
}

export function CalendarHeader({
  isScrolled,
  navigation,
  zoom,
  viewMode,
  onViewModeChange,
}: CalendarHeaderProps) {
  return (
    <div
      className={cn(
        'duration-medium1 ease-standard flex justify-center px-3 py-2 transition-[shadow,background-color]',
        isScrolled && 'bg-surface-container-high shadow-md',
      )}
    >
      {/* Inner wrapper with max-width prevents layout shift during width animation */}
      <div className="flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
        {/* Navigation controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={navigation.goToPrevDay}
            className="hover:bg-surface-container-high cursor-pointer rounded-md p-1 transition-colors"
            aria-label="Previous day"
          >
            <ChevronLeftIcon sx={{ fontSize: 18 }} className="text-on-surface-variant" />
          </button>
          <button
            onClick={navigation.goToToday}
            className="min-w-[80px] cursor-pointer text-center"
          >
            <span
              className={cn(
                'text-base font-semibold',
                navigation.isToday ? 'text-on-surface' : 'text-on-surface-variant',
              )}
            >
              {navigation.dayLabel}
            </span>
            <span className="text-on-surface-variant block text-xs">{navigation.daySecondary}</span>
          </button>
          <button
            onClick={navigation.goToNextDay}
            className="hover:bg-surface-container-high cursor-pointer rounded-md p-1 transition-colors"
            aria-label="Next day"
          >
            <ChevronRightIcon sx={{ fontSize: 18 }} className="text-on-surface-variant" />
          </button>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-2">
          {/* Timezone selector */}
          <TimezoneSelector />

          {/* View toggle */}
          <div className="bg-surface-container-high flex items-center rounded-lg p-0.5">
            <button
              onClick={() => onViewModeChange?.('day')}
              className={cn(
                'cursor-pointer rounded-md p-1 transition-colors',
                viewMode === 'day'
                  ? 'bg-surface-container-highest text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
              aria-label="Day view"
            >
              <ViewDayOutlinedIcon sx={{ fontSize: 18 }} />
            </button>
            <button
              onClick={() => onViewModeChange?.('week')}
              className={cn(
                'cursor-pointer rounded-md p-1 transition-colors',
                viewMode === 'week'
                  ? 'bg-surface-container-highest text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
              aria-label="Week view"
            >
              <ViewWeekOutlinedIcon sx={{ fontSize: 18 }} />
            </button>
            <button
              onClick={() => onViewModeChange?.('month')}
              className={cn(
                'cursor-pointer rounded-md p-1 transition-colors',
                viewMode === 'month'
                  ? 'bg-surface-container-highest text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
              aria-label="Month view"
            >
              <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={zoom.zoomOut}
              disabled={!zoom.canZoomOut}
              className="hover:bg-surface-container-high cursor-pointer rounded-md p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Zoom out"
            >
              <ZoomOutIcon sx={{ fontSize: 14 }} className="text-on-surface-variant" />
            </button>
            <span className="text-on-surface-variant w-8 text-center text-xs tabular-nums">
              {zoom.zoom}x
            </span>
            <button
              onClick={zoom.zoomIn}
              disabled={!zoom.canZoomIn}
              className="hover:bg-surface-container-high cursor-pointer rounded-md p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Zoom in"
            >
              <ZoomInIcon sx={{ fontSize: 14 }} className="text-on-surface-variant" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
