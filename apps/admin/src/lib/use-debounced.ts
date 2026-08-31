'use client';

import { useEffect, useState } from 'react';

/**
 * Track a value, but only report it once it has stopped changing for `delayMs`.
 *
 * @remarks
 * Used for search inputs, so a query key changes once per pause rather than once per keystroke.
 * The input itself stays fully controlled and immediate — only the value that reaches the cache is
 * delayed — so typing never feels laggy.
 *
 * @typeParam T - The debounced value's type.
 * @param value - The immediate value.
 * @param delayMs - How long the value must hold still before it is reported.
 * @returns the settled value.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(handle);
    };
  }, [value, delayMs]);

  return settled;
}
