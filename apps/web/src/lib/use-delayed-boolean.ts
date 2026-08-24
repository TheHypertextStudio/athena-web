'use client';

import { useEffect, useState } from 'react';

/** Delay visual progress so a short reconciliation does not flash a loading state. */
export function useDelayedBoolean(value: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!value) {
      setDelayed(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      setDelayed(true);
    }, delayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [delayMs, value]);

  return delayed;
}
