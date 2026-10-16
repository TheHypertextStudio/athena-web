'use client';

import { useLayoutEffect, type RefObject } from 'react';

function revealActiveDestination(region: HTMLDivElement): void {
  const active = region.querySelector<HTMLElement>('[aria-current="page"]');
  if (!active || region.clientHeight === 0) return;
  const top = region.getBoundingClientRect().top + region.clientTop;
  const bottom = top + region.clientHeight;
  const bounds = active.getBoundingClientRect();
  if (bounds.top < top) region.scrollTop += bounds.top - top;
  else if (bounds.bottom > bottom) region.scrollTop += bounds.bottom - bottom;
}

/**
 * Reveals the active destination only when navigation or available sidebar space changes.
 * The sidebar owns this scroll adjustment; user scrolling and page position remain independent.
 */
export function useSidebarActiveVisibility(
  regionRef: RefObject<HTMLDivElement | null>,
  activeKey: string,
): void {
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    revealActiveDestination(region);
    if (typeof ResizeObserver === 'undefined') return;
    let height = region.clientHeight;
    let width = region.clientWidth;
    const observer = new ResizeObserver(() => {
      if (height === region.clientHeight && width === region.clientWidth) return;
      height = region.clientHeight;
      width = region.clientWidth;
      revealActiveDestination(region);
    });
    observer.observe(region);
    return () => {
      observer.disconnect();
    };
  }, [activeKey, regionRef]);
}
