'use client';

/**
 * `lib/use-now` — a live clock hook.
 *
 * @remarks
 * Returns the current time and refreshes it on an interval, so "now"-driven UI (the calendar's now
 * line, a time-aware greeting) stays live instead of freezing at first render. One `setInterval`
 * per consumer, cleaned up on unmount. Client-only.
 */
import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs` (default 30s).
 *
 * @param intervalMs - How often to re-read the clock. Smaller = smoother movement, more renders.
 * @returns a `Date` that advances on the interval.
 */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
