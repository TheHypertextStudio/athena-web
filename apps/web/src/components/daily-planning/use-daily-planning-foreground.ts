'use client';

import { useEffect, useState } from 'react';

/** Observe foreground state and recheck saved planning state on return. */
export function useDailyPlanningForeground(recheck: () => Promise<void>): {
  readonly now: number;
  readonly active: boolean;
} {
  const [clock, setClock] = useState({ now: Date.now(), active: false });
  useEffect(() => {
    let current = true;
    let generation = 0;
    let wasActive = document.visibilityState === 'visible' && document.hasFocus();
    let allowed = wasActive;
    setClock({ now: Date.now(), active: wasActive });
    const observe = (): void => {
      const foreground = document.visibilityState === 'visible' && document.hasFocus();
      if (!foreground) {
        wasActive = false;
        allowed = false;
        generation += 1;
        setClock({ now: Date.now(), active: false });
        return;
      }
      if (wasActive) {
        setClock({ now: Date.now(), active: allowed });
        return;
      }
      wasActive = true;
      allowed = false;
      const request = ++generation;
      void recheck()
        .finally(() => {
          if (!current || request !== generation) return;
          allowed = true;
          setClock({ now: Date.now(), active: true });
        })
        .catch(() => undefined);
    };
    document.addEventListener('visibilitychange', observe);
    document.addEventListener('focusin', observe);
    window.addEventListener('focus', observe);
    window.addEventListener('blur', observe);
    window.addEventListener('storage', observe);
    const timer = window.setInterval(observe, 1000);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', observe);
      document.removeEventListener('focusin', observe);
      window.removeEventListener('focus', observe);
      window.removeEventListener('blur', observe);
      window.removeEventListener('storage', observe);
    };
  }, [recheck]);
  return clock;
}
