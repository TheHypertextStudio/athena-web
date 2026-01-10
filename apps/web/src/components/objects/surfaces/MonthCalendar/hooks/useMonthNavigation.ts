import { useCallback, useMemo } from 'react';
import { getMonthBounds, getMonthGridDates } from '@/lib/calendar-utils';

export interface UseMonthNavigationOptions {
  date: Date;
  onDateChange?: (date: Date) => void;
}

export interface UseMonthNavigationReturn {
  /** First day of the month */
  monthStart: Date;
  /** Last day of the month */
  monthEnd: Date;
  /** Array of dates for the month grid (includes padding days from adjacent months) */
  gridDates: Date[];
  /** Navigate to previous month */
  goToPrevMonth: () => void;
  /** Navigate to next month */
  goToNextMonth: () => void;
  /** Navigate to current month */
  goToToday: () => void;
  /** Formatted label for the month (e.g., "January 2024") */
  monthLabel: string;
  /** Whether the current month contains today */
  isCurrentMonth: boolean;
}

export function useMonthNavigation({
  date,
  onDateChange,
}: UseMonthNavigationOptions): UseMonthNavigationReturn {
  const { startDate, endDate } = useMemo(() => getMonthBounds(date), [date]);

  const monthStart = useMemo(() => new Date(startDate), [startDate]);
  const monthEnd = useMemo(() => new Date(endDate), [endDate]);
  const gridDates = useMemo(() => getMonthGridDates(date), [date]);

  const goToPrevMonth = useCallback(() => {
    const newDate = new Date(date);
    newDate.setMonth(newDate.getMonth() - 1);
    onDateChange?.(newDate);
  }, [date, onDateChange]);

  const goToNextMonth = useCallback(() => {
    const newDate = new Date(date);
    newDate.setMonth(newDate.getMonth() + 1);
    onDateChange?.(newDate);
  }, [date, onDateChange]);

  const goToToday = useCallback(() => {
    onDateChange?.(new Date());
  }, [onDateChange]);

  const monthLabel = useMemo(() => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [date]);

  const isCurrentMonth = useMemo(() => {
    const today = new Date();
    return today.getMonth() === date.getMonth() && today.getFullYear() === date.getFullYear();
  }, [date]);

  return {
    monthStart,
    monthEnd,
    gridDates,
    goToPrevMonth,
    goToNextMonth,
    goToToday,
    monthLabel,
    isCurrentMonth,
  };
}
