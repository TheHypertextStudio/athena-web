'use client';

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { scheduleWallPositionForInstant } from './scheduling-time-axis';

/** Inputs for a date selection anchored to asynchronously loaded Hub timezone preferences. */
export interface UseScheduleDisplayDateOptions {
  /** Explicit consumer-selected initial date; explicit values are never reconciled. */
  readonly initialDate?: string;
  /** Resolved display timezone for current-day semantics. */
  readonly displayTimezone: string;
  /** Whether the first Hub preference read has settled. */
  readonly preferencesReady: boolean;
  /** Stable ISO instant used to derive current-day semantics without polling. */
  readonly now: string;
}

/** Date selection and current-day metadata returned by {@link useScheduleDisplayDate}. */
export interface ScheduleDisplayDateState {
  readonly date: string;
  readonly today: string;
  readonly isToday: boolean;
  readonly setDate: Dispatch<SetStateAction<string>>;
}

/** Resolve one exact instant's date in the required scheduling timezone. */
function displayDateForInstant(now: string, displayTimezone: string): string {
  const position = scheduleWallPositionForInstant(now, displayTimezone);
  if (!position) throw new RangeError('Invalid scheduling display date input.');
  return position.date;
}

/**
 * Own a navigable date without letting async preferences overwrite user intent.
 *
 * An implicit local date reconciles once when Hub preferences first settle. Explicit initial
 * dates and any date changed through `setDate` remain untouched. `today` and `isToday` always use
 * the latest resolved display timezone.
 */
export function useScheduleDisplayDate({
  initialDate,
  displayTimezone,
  preferencesReady,
  now,
}: UseScheduleDisplayDateOptions): ScheduleDisplayDateState {
  const today = displayDateForInstant(now, displayTimezone);
  const [date, setDateState] = useState(() => initialDate ?? today);
  const explicitInitialDateRef = useRef(initialDate !== undefined);
  const navigatedRef = useRef(false);
  const reconciledRef = useRef(false);

  useEffect(() => {
    if (!preferencesReady || reconciledRef.current) return;
    reconciledRef.current = true;
    if (!explicitInitialDateRef.current && !navigatedRef.current) setDateState(today);
  }, [preferencesReady, today]);

  const setDate = useCallback<Dispatch<SetStateAction<string>>>((nextDate) => {
    navigatedRef.current = true;
    setDateState(nextDate);
  }, []);

  return { date, today, isToday: date === today, setDate };
}
