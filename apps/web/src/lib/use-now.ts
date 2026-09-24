'use client';

/**
 * `lib/use-now` — a live clock hook.
 *
 * @remarks
 * Returns the current time and refreshes it on an interval, so "now"-driven UI (the calendar's now
 * line, a time-aware greeting) stays live instead of freezing at first render. One `setInterval`
 * per consumer, cleaned up on unmount. Client-only.
 *
 * ## The seed is read during render, which the server also does
 *
 * Without `initialNow`, the initial value comes from `new Date()` on both server and browser.
 * Calendar passes the server's exact seed because its visible date heading can differ when the
 * browser uses another timezone or a test controls its clock. The effect catches up to live time
 * as soon as the browser mounts.
 *
 * Other callers that render seconds or raw timestamps should pass a server seed or hold `null`
 * until mounted. `components/athena/voice-phone-numbers.tsx` uses the latter approach when the
 * value gates a `disabled` attribute.
 *
 * Making that the default here means returning `Date | null` and teaching all six call sites what
 * to show before mount, which reaches the Agenda and Calendar scheduling prop contracts. Worth
 * doing deliberately; not worth doing as a side effect of an unrelated change.
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
  /** Server-provided instant that keeps the first browser render equal to SSR. */
  readonly initialNow?: string | undefined;
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
  const { enabled = true, initialNow } = options;
  const [now, setNow] = useState(() => new Date(initialNow ?? Date.now()));
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
