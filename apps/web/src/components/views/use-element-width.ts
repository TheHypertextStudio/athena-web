'use client';

import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * Track the width of an element, or of its parent.
 *
 * @remarks
 * The width is read before paint so a wide pane never flashes the narrow arrangement; the
 * observer's first report lands a frame later. A zero width from that first read means there is no
 * layout to measure, which is not an answer, so it leaves `initialWidth` in place.
 *
 * @param ref - The element, or the element whose parent is measured.
 * @param enabled - Whether to measure at all.
 * @param target - Which box to measure: the element itself or its parent.
 * @param initialWidth - The width to report until the first measurement.
 * @returns the latest measured width in px.
 */
export function useElementWidth(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  target: 'self' | 'parent' = 'self',
  initialWidth = 0,
): number {
  const [width, setWidth] = useState(initialWidth);

  useLayoutEffect(() => {
    const holder = ref.current;
    const element = target === 'parent' ? holder?.parentElement : holder;
    if (!enabled || !element) return;
    const initial = element.getBoundingClientRect().width;
    if (initial > 0) setWidth(initial);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [enabled, ref, target]);

  return width;
}
