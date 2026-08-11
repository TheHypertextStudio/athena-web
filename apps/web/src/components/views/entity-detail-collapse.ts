import { useEffect, useRef, type RefObject } from 'react';

const COVERED_COLLAPSE_RANGE_REM = 6;
const COVERLESS_COLLAPSE_RANGE_REM = 4;

/**
 * Converts the detail scroller's absolute offset into a stable collapse fraction.
 *
 * @remarks
 * Native CSS scroll timelines derive their percentage from total scroll range. That range changes
 * when the animated header rows change height, creating a layout feedback loop. This calculation
 * instead uses the intended pixel distance directly, so header layout cannot move its endpoint.
 * Reduced motion keeps the same two states and removes their interpolation.
 *
 * @param scrollTop - Current block-axis offset of the detail scroller in pixels.
 * @param rangePixels - Distance over which the header should collapse.
 * @param reducedMotion - Whether the person requested reduced motion.
 * @returns a finite progress value between zero and one.
 */
export function resolveDetailCollapseProgress(
  scrollTop: number,
  rangePixels: number,
  reducedMotion: boolean,
): number {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(rangePixels) || rangePixels <= 0) return 0;
  if (reducedMotion) return scrollTop > 0 ? 1 : 0;
  return Math.min(Math.max(scrollTop / rangePixels, 0), 1);
}

/**
 * Connects a detail scroller to the shared paused collapse keyframes without React rerenders.
 *
 * @param options - Header geometry selected by the presence of a cover.
 * @returns the ref to attach to the element that owns detail-page scrolling.
 */
export function useDetailHeaderCollapse({
  hasCover,
}: {
  hasCover: boolean;
}): RefObject<HTMLDivElement | null> {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rootFontSize = Number.parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    const rangePixels =
      rootFontSize * (hasCover ? COVERED_COLLAPSE_RANGE_REM : COVERLESS_COLLAPSE_RANGE_REM);
    let frame: number | null = null;

    const applyProgress = (): void => {
      frame = null;
      const progress = resolveDetailCollapseProgress(
        scroller.scrollTop,
        rangePixels,
        reducedMotion.matches,
      );
      scroller.style.setProperty('--detail-collapse-progress', String(progress));
      scroller.style.setProperty('--detail-collapse-delay', `${-progress}s`);
    };

    const queueProgress = (): void => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(applyProgress);
    };

    applyProgress();
    scroller.addEventListener('scroll', queueProgress, { passive: true });
    reducedMotion.addEventListener('change', queueProgress);

    return () => {
      scroller.removeEventListener('scroll', queueProgress);
      reducedMotion.removeEventListener('change', queueProgress);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [hasCover]);

  return scrollRef;
}
