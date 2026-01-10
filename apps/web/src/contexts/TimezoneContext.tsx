'use client';

/**
 * Calendar-level timezone context.
 *
 * Provides a way to override the global timezone for calendar views,
 * allowing users to view events in a different timezone without changing
 * their global preference.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { useTimezone } from '@/hooks/use-timezone';
import { formatTimeInTimezone, parseTimeInTimezone, getTimezoneInfo } from '@/lib/timezone-utils';

/**
 * Calendar timezone context value.
 */
export interface CalendarTimezoneContextValue {
  /** The effective timezone for the calendar (override or global) */
  timezone: string;
  /** The global user timezone from settings */
  globalTimezone: string;
  /** Whether a calendar-specific override is active */
  isOverride: boolean;
  /** Set a calendar-specific timezone override */
  setOverride: (timezone: string | null) => void;
  /** Clear the override and use global timezone */
  clearOverride: () => void;
  /** Format a time in the calendar timezone */
  formatTime: (date: Date) => string;
  /** Parse a time string in the calendar timezone */
  parseTime: (timeStr: string, baseDate: Date) => Date;
  /** Get timezone display info (offset, current time) */
  getInfo: (referenceDate?: Date) => { offset: string; time: string; offsetMinutes: number };
  /** Whether the timezone data is loading */
  isLoading: boolean;
}

const CalendarTimezoneContext = createContext<CalendarTimezoneContextValue | null>(null);

/**
 * Provider for calendar timezone context.
 */
export function CalendarTimezoneProvider({ children }: { children: ReactNode }) {
  const { timezone: globalTimezone, isLoading } = useTimezone();
  const [override, setOverrideState] = useState<string | null>(null);

  const value = useMemo((): CalendarTimezoneContextValue => {
    const effectiveTimezone = override ?? globalTimezone;

    return {
      timezone: effectiveTimezone,
      globalTimezone,
      isOverride: override !== null,
      setOverride: setOverrideState,
      clearOverride: () => {
        setOverrideState(null);
      },
      formatTime: (date: Date) => formatTimeInTimezone(date, effectiveTimezone),
      parseTime: (timeStr: string, baseDate: Date) =>
        parseTimeInTimezone(timeStr, baseDate, effectiveTimezone),
      getInfo: (referenceDate?: Date) => getTimezoneInfo(effectiveTimezone, referenceDate),
      isLoading,
    };
  }, [globalTimezone, override, isLoading]);

  return (
    <CalendarTimezoneContext.Provider value={value}>{children}</CalendarTimezoneContext.Provider>
  );
}

/**
 * Hook to access the calendar timezone context.
 *
 * @throws Error if used outside CalendarTimezoneProvider
 */
export function useCalendarTimezone(): CalendarTimezoneContextValue {
  const context = useContext(CalendarTimezoneContext);
  if (!context) {
    throw new Error('useCalendarTimezone must be used within CalendarTimezoneProvider');
  }
  return context;
}

/**
 * Hook to access calendar timezone with fallback to global timezone.
 *
 * Safe to use outside of CalendarTimezoneProvider - falls back to useTimezone.
 */
export function useCalendarTimezoneOptional(): {
  timezone: string;
  formatTime: (date: Date) => string;
  parseTime: (timeStr: string, baseDate: Date) => Date;
  isLoading: boolean;
} {
  const context = useContext(CalendarTimezoneContext);
  const globalTimezone = useTimezone();

  if (context) {
    return {
      timezone: context.timezone,
      formatTime: context.formatTime,
      parseTime: context.parseTime,
      isLoading: context.isLoading,
    };
  }

  return {
    timezone: globalTimezone.timezone,
    formatTime: (date: Date) => formatTimeInTimezone(date, globalTimezone.timezone),
    parseTime: (timeStr: string, baseDate: Date) =>
      parseTimeInTimezone(timeStr, baseDate, globalTimezone.timezone),
    isLoading: globalTimezone.isLoading,
  };
}
