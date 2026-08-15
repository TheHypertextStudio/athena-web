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

/** How a caller narrows when the clock should actually be running. */
export interface UseNowOptions {
  /**
   * Whether the clock should advance. Defaults to true.
   *
   * @remarks
   * While false the last value is held, so what is on screen stays put instead of jumping.
   */
  readonly enabled?: boolean;
}

/**
 * The current time, refreshed every `intervalMs` (default 30s).
 *
 * @param intervalMs - How often to re-read the clock. Smaller = smoother movement, more renders.
 * @param options - See {@link UseNowOptions}.
 * @returns a `Date` that advances on the interval while enabled.
 *
 * @example
 * ```ts
 * const now = useNow(1_000, { enabled: running }).getTime();
 * ```
 */
export function useNow(intervalMs = 30_000, options: UseNowOptions = {}): Date {
  const { enabled = true } = options;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return undefined;
    // Catch up before ticking. A gated clock holds its last value while off, so resuming without
    // this would serve a reading up to `intervalMs` old — half a minute stale on the 30s default,
    // which is long enough for a deadline readout to be wrong at the moment it comes back.
    setNow(new Date());
    const id = setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs, enabled]);
  return now;
}
