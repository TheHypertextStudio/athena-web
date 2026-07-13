type HorizontalViewport = Pick<HTMLElement, 'clientWidth' | 'scrollLeft' | 'scrollWidth'>;

interface HorizontalViewportSnapshot {
  readonly clientWidth: number;
  readonly scrollLeft: number;
  readonly scrollWidth: number;
}

type HorizontalBoundaryDirection = 'previous' | 'next';

const BOUNDARY_TOLERANCE = 2;

function snapshotViewport(viewport: HorizontalViewport): HorizontalViewportSnapshot {
  return {
    clientWidth: viewport.clientWidth,
    scrollLeft: viewport.scrollLeft,
    scrollWidth: viewport.scrollWidth,
  };
}

/** Distinguish deliberate horizontal edge arrivals from vertical scrolling and layout changes. */
export class SchedulingHorizontalBoundary {
  private snapshot: HorizontalViewportSnapshot | undefined;
  private lockedDirection: HorizontalBoundaryDirection | null = null;

  /** Accept the viewport's current geometry without interpreting it as user navigation. */
  synchronize(viewport: HorizontalViewport): void {
    this.snapshot = snapshotViewport(viewport);
    this.lockedDirection = null;
  }

  /** Return a newly reached boundary only when horizontal geometry stayed stable. */
  observe(viewport: HorizontalViewport): HorizontalBoundaryDirection | null {
    const current = snapshotViewport(viewport);
    const previous = this.snapshot;
    this.snapshot = current;
    if (previous === undefined) {
      this.lockedDirection = null;
      return null;
    }
    const dimensionsChanged =
      previous.clientWidth !== current.clientWidth || previous.scrollWidth !== current.scrollWidth;
    if (dimensionsChanged || current.scrollWidth <= current.clientWidth) {
      this.lockedDirection = null;
      return null;
    }
    if (previous.scrollLeft === current.scrollLeft) return null;

    const direction =
      current.scrollLeft <= BOUNDARY_TOLERANCE
        ? 'previous'
        : current.scrollLeft + current.clientWidth >= current.scrollWidth - BOUNDARY_TOLERANCE
          ? 'next'
          : null;
    if (direction === null) {
      this.lockedDirection = null;
      return null;
    }
    if (this.lockedDirection === direction) return null;
    this.lockedDirection = direction;
    return direction;
  }
}
