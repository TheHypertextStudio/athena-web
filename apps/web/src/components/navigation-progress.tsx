'use client';

/**
 * The only sign that a navigation is under way.
 *
 * @remarks
 * Opening a document is a round trip to the server for the route's payload, and until it returns
 * the previous screen stays exactly as it was — same content, same scroll, same everything. From
 * the reader's side a click that will resolve in half a second and a click that did not register
 * look identical, which is why the app felt unresponsive even where it was not slow. The usual
 * result is a second click on the same row.
 *
 * This is the acknowledgement. It reads the requested destination from the shared navigation
 * seam, which publishes intent the moment a link or an imperative caller asks for it rather than
 * when the route commits.
 *
 * Two deliberate restraints. It waits before appearing, so a navigation that resolves quickly —
 * most of them, especially with a warm cache — produces no flash of chrome at all; a progress bar
 * that blinks on every click is noise, not feedback. And it is `aria-hidden`: assistive tech
 * announces the destination when the new route lands, so a live region here would only talk over
 * that.
 */
import { cn } from '@docket/ui/lib/utils';
import { type JSX, useEffect, useRef, useState } from 'react';

import { useOptionalResponsiveRouter } from '@/lib/interactions/navigation';

/**
 * How long a navigation must stay pending before the bar appears.
 *
 * @remarks
 * Below this, showing and hiding chrome costs more attention than the wait it describes.
 */
const APPEAR_AFTER_MS = 150;

/**
 * The indeterminate sweep, shared with {@link file://../components/service-worker-provider.tsx
 * UpdateCard}'s in-flight states so the two bars can't drift apart independently.
 */
export const NAVIGATION_PROGRESS_SWEEP_CLASSNAME =
  'w-1/3 animate-[navigation-progress_1s_ease-in-out_infinite]';

/**
 * A slim progress bar shown while a navigation is in flight.
 *
 * @returns The bar, or nothing when no navigation is pending.
 */
export function NavigationProgress(): JSX.Element | null {
  const router = useOptionalResponsiveRouter();
  const pending = router?.requestedHref ?? null;
  const [visible, setVisible] = useState(false);
  // Whether a navigation is outstanding at all, rather than which one. Clicking a second row
  // supersedes the first request, changing `requestedHref` — and keying the countdown on the href
  // restarted it every time, so a run of quick clicks could keep the bar hidden through a wait of
  // any length. The waiting never stopped, so neither should the timer.
  const waiting = pending !== null;
  const startedWaitingAt = useRef<number | null>(null);

  useEffect(() => {
    if (!waiting) {
      startedWaitingAt.current = null;
      setVisible(false);
      return;
    }
    // `performance.now()` rather than `Date.now()`: a monotonic clock cannot be dragged backwards
    // by a system time change mid-navigation.
    const startedAt = startedWaitingAt.current ?? performance.now();
    startedWaitingAt.current = startedAt;
    const elapsed = performance.now() - startedAt;
    if (elapsed >= APPEAR_AFTER_MS) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => {
      setVisible(true);
    }, APPEAR_AFTER_MS - elapsed);
    return () => {
      clearTimeout(timer);
    };
  }, [waiting, pending]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      data-navigation-progress=""
      className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      {/*
       * Indeterminate on purpose: the route payload reports no progress, so a bar that filled to
       * a percentage would be inventing one. The global reduced-motion rule freezes the sweep,
       * which still leaves a visible mark that something is happening.
       */}
      <div className={cn('bg-primary h-full', NAVIGATION_PROGRESS_SWEEP_CLASSNAME)} />
    </div>
  );
}
