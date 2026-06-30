'use client';

/**
 * `stream` — a tiny IntersectionObserver hook for infinite scroll.
 *
 * @remarks
 * Attach the returned ref to a sentinel element at the end of the feed; when it scrolls into
 * view and `enabled` is true, `onReach` fires (the page hook's `fetchNextPage`). Disconnects on
 * unmount or when disabled, so an exhausted/loading list never keeps observing.
 */
import { useEffect, useRef } from 'react';

/**
 * @param onReach - Called when the sentinel becomes visible.
 * @param enabled - Whether to observe (e.g. `hasNextPage && !isFetchingNextPage`).
 * @returns a ref to attach to the sentinel element.
 */
export function useInfiniteScrollSentinel(
  onReach: () => void,
  enabled: boolean,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onReach();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [onReach, enabled]);
  return ref;
}
