'use client';

import { useState, useCallback, useEffect } from 'react';
import type { CalendarViewMode } from '@/components/objects/surfaces/DayCalendar/types';

const STORAGE_KEY = 'athena-calendar-view-mode';
const DEFAULT_VIEW_MODE: CalendarViewMode = 'day';

/**
 * Hook to manage calendar view mode state with localStorage persistence.
 *
 * @returns View mode state and setter
 *
 * @example
 * ```tsx
 * const { viewMode, setViewMode } = useCalendarViewMode();
 * ```
 */
export function useCalendarViewMode() {
  const [viewMode, setViewModeState] = useState<CalendarViewMode>(DEFAULT_VIEW_MODE);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && isValidViewMode(stored)) {
        setViewModeState(stored);
      }
    } catch {
      // localStorage not available, use default
    }
    setIsInitialized(true);
  }, []);

  // Save to localStorage when view mode changes
  const setViewMode = useCallback((mode: CalendarViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage not available
    }
  }, []);

  return {
    viewMode,
    setViewMode,
    isInitialized,
  };
}

function isValidViewMode(value: string): value is CalendarViewMode {
  return value === 'day' || value === 'week' || value === 'month';
}
