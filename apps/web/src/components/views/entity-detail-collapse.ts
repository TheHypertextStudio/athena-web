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

/** The scroller ref plus the header ref whose measured height it publishes. */
export interface DetailHeaderCollapse {
  /** Attach to the element that owns detail-page scrolling. */
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  /** Attach to the sticky header, so its height can be published to the scroller. */
  readonly headerRef: RefObject<HTMLElement | null>;
}

/**
 * Connects a detail scroller to the shared paused collapse keyframes without React rerenders, and
 * publishes the sticky header's measured height as `--detail-header-height`.
 *
 * @remarks
 * The header is opaque and pinned, so anything that needs to sit clear of it — scroll padding for
 * anchor jumps, a second sticky such as the document contents rail — needs its height. That height
 * changes as the header collapses, so it is measured rather than assumed, and written straight to
 * the scroller's style alongside the collapse progress: same element, same no-rerender path.
 *
 * @param options - Header geometry selected by the presence of a cover.
 * @returns the scroller and header refs to attach.
 */
export function useDetailHeaderCollapse({ hasCover }: { hasCover: boolean }): DetailHeaderCollapse {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    const header = headerRef.current;
    if (!scroller || !header) return;

    // `border-box` rather than `getBoundingClientRect`: the collapse animates a `scale` transform
    // on the glyph, and a bounding rect reports the transformed box. The occluding surface is the
    // layout box, which is what the header actually reserves at the top of the scrollport.
    const publishHeaderHeight = (height: number): void => {
      scroller.style.setProperty('--detail-header-height', `${height}px`);
    };
    publishHeaderHeight(header.offsetHeight);

    const headerObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entry]) => {
            if (!entry) return;
            const [box] = entry.borderBoxSize;
            publishHeaderHeight(box ? box.blockSize : header.offsetHeight);
          });
    headerObserver?.observe(header);

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
      headerObserver?.disconnect();
      scroller.removeEventListener('scroll', queueProgress);
      reducedMotion.removeEventListener('change', queueProgress);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [hasCover]);

  return { scrollRef, headerRef };
}
