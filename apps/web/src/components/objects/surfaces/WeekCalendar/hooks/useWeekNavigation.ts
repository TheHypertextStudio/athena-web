import { useCallback, useMemo } from 'react';
import { getWeekBounds, getWeekDates } from '@/lib/calendar-utils';

export interface UseWeekNavigationOptions {
  date: Date;
  onDateChange?: (date: Date) => void;
}

export interface UseWeekNavigationReturn {
  /** Start date of the current week (Sunday) */
  weekStart: Date;
  /** End date of the current week (Saturday) */
  weekEnd: Date;
  /** Array of 7 dates for the week */
  weekDates: Date[];
  /** Navigate to previous week */
  goToPrevWeek: () => void;
  /** Navigate to next week */
  goToNextWeek: () => void;
  /** Navigate to current week */
  goToToday: () => void;
  /** Formatted label for the week (e.g., "Jan 5 - 11, 2024") */
  weekLabel: string;
  /** Whether the current week contains today */
  isCurrentWeek: boolean;
}

export function useWeekNavigation({
  date,
  onDateChange,
}: UseWeekNavigationOptions): UseWeekNavigationReturn {
  const { startDate, endDate } = useMemo(() => getWeekBounds(date), [date]);

  const weekStart = useMemo(() => new Date(startDate), [startDate]);
  const weekEnd = useMemo(() => new Date(endDate), [endDate]);
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const goToPrevWeek = useCallback(() => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() - 7);
    onDateChange?.(newDate);
  }, [date, onDateChange]);

  const goToNextWeek = useCallback(() => {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + 7);
    onDateChange?.(newDate);
  }, [date, onDateChange]);

  const goToToday = useCallback(() => {
    onDateChange?.(new Date());
  }, [onDateChange]);

  const weekLabel = useMemo(() => {
    const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
    const startDay = weekStart.getDate();
    const endDay = weekEnd.getDate();
    const year = weekEnd.getFullYear();

    if (startMonth === endMonth) {
      return `${startMonth} ${String(startDay)} - ${String(endDay)}, ${String(year)}`;
    }
    return `${startMonth} ${String(startDay)} - ${endMonth} ${String(endDay)}, ${String(year)}`;
  }, [weekStart, weekEnd]);

  const isCurrentWeek = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today >= weekStart && today <= weekEnd;
  }, [weekStart, weekEnd]);

  return {
    weekStart,
    weekEnd,
    weekDates,
    goToPrevWeek,
    goToNextWeek,
    goToToday,
    weekLabel,
    isCurrentWeek,
  };
}
