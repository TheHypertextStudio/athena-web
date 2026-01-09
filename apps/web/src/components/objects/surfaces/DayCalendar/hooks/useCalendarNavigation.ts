'use client';

import { useCallback, useMemo } from 'react';
import { formatDayLabel, isToday as checkIsToday, getTodayDate } from '@/lib/calendar-utils';

export interface UseCalendarNavigationOptions {
  date: Date;
  onDateChange?: (date: Date) => void;
}

export interface UseCalendarNavigationReturn {
  goToPrevDay: () => void;
  goToNextDay: () => void;
  goToToday: () => void;
  dayLabel: string;
  daySecondary: string;
  isToday: boolean;
}

/**
 * Encapsulates date navigation and day label formatting.
 */
export function useCalendarNavigation({
  date,
  onDateChange,
}: UseCalendarNavigationOptions): UseCalendarNavigationReturn {
  const goToPrevDay = useCallback(() => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() - 1);
    onDateChange?.(newDate);
  }, [date, onDateChange]);

  const goToNextDay = useCallback(() => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + 1);
    onDateChange?.(newDate);
  }, [date, onDateChange]);

  const goToToday = useCallback(() => {
    onDateChange?.(getTodayDate());
  }, [onDateChange]);

  const { primary: dayLabel, secondary: daySecondary } = useMemo(
    () => formatDayLabel(date),
    [date],
  );

  const isToday = useMemo(() => checkIsToday(date), [date]);

  return {
    goToPrevDay,
    goToNextDay,
    goToToday,
    dayLabel,
    daySecondary,
    isToday,
  };
}
