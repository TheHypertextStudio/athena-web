'use client';

/**
 * `components/feedback/region-frame` — the alert frame around a state that replaces a region.
 */
import { cn } from '@docket/ui/lib/utils';
import type { JSX, ReactNode } from 'react';

/** Props for {@link RegionFrame}. */
export interface RegionFrameProps {
  /** The state to centre: an `EmptyState` in its `frame="none"` form. */
  readonly children: ReactNode;
  /** `region` (default) fills a content area; `panel` is a compact block for a rail or a card. */
  readonly size?: 'region' | 'panel' | undefined;
}

/**
 * Centre a critical state in the space its region occupied and announce it to assistive
 * technology.
 *
 * @param props - See {@link RegionFrameProps}.
 */
export function RegionFrame({ children, size = 'region' }: RegionFrameProps): JSX.Element {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-1 items-center justify-center',
        size === 'region' ? 'min-h-64 p-6' : 'min-h-32 p-4',
      )}
    >
      {children}
    </div>
  );
}
