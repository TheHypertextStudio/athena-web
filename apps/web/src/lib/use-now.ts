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
 * The initial value comes from `useState(() => new Date())`, so a component prerendered by the
 * `(app)` server layout bakes the *server's* clock into its markup and the browser then hydrates
 * with its own. Every current caller survives that because each formats the value at a coarser
 * grain than the gap between the two reads — minutes on a now-line, whole seconds on an elapsed
 * readout — so both sides usually render the same characters.
 *
 * That is a property of the callers, not a guarantee of this hook. Anything rendering seconds, a
 * countdown that crosses a boundary, or a raw timestamp can mismatch on hydration. A caller that
 * needs the guarantee should hold `null` until mounted and seed inside an effect — as
 * `components/athena/voice-phone-numbers.tsx` does, where the value gates a `disabled` attribute
 * and a wrong first render is a control the person cannot press.
 *
 * Making that the default here means returning `Date | null` and teaching all six call sites what
 * to show before mount, which reaches the `WorkLocationStrip` and calendar scheduling prop
 * contracts. Worth doing deliberately; not worth doing as a side effect of an unrelated change.
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
