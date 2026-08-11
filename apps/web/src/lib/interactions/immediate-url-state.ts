'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** The local URL choice and setter returned by {@link useImmediateUrlState}. */
export type ImmediateUrlState<T> = readonly [T, (next: T) => void];

interface PendingUrlState<T> {
  readonly value: T;
}

/**
 * Keep the newest local URL-backed choice visible until the matching canonical query state arrives.
 *
 * @remarks
 * Next's router can defer a search-param navigation long enough for a control to appear unchanged.
 * This hook overlays the latest local choice instead. A canonical value only clears that overlay
 * when it matches, so an older route commit cannot replace a newer choice made in the same surface.
 *
 * @typeParam T - The URL-backed value to overlay.
 * @param canonical - The value parsed from the committed URL.
 * @param equals - Compares a parsed canonical value with a local choice.
 * @returns The immediately visible value and a setter for the next local choice.
 */
export function useImmediateUrlState<T>(
  canonical: T,
  equals: (left: T, right: T) => boolean = Object.is,
): ImmediateUrlState<T> {
  const [pending, setPending] = useState<PendingUrlState<T> | null>(null);
  const pendingRef = useRef<PendingUrlState<T> | null>(null);

  useEffect(() => {
    const current = pendingRef.current;
    if (current !== null && equals(canonical, current.value)) {
      pendingRef.current = null;
      setPending(null);
    }
  }, [canonical, equals]);

  const setImmediate = useCallback((next: T): void => {
    const nextPending = { value: next };
    pendingRef.current = nextPending;
    setPending(nextPending);
  }, []);

  return [pending === null ? canonical : pending.value, setImmediate];
}
