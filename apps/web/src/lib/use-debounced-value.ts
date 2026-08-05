'use client';

import { useEffect, useState } from 'react';

/**
 * Hold a value still for a moment before letting it through.
 *
 * @remarks
 * Extracted from the command palette, which had this inlined. The pattern matters more than the
 * helper: debouncing the *term* rather than the request means the settled value goes into the
 * query key, and TanStack Query then handles deduplication, cancellation, and race-safety for
 * free. Debouncing the fetch instead leaves every one of those to be re-solved by hand.
 *
 * @param value - The value that changes on every keystroke.
 * @param delayMs - How long it must hold still.
 * @returns The settled value.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}
