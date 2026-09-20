'use client';

/** Focus and keyboard boundary shared by Project and Task graph selection surfaces. */
import type { JSX, ReactNode } from 'react';

import { useSelection, useSelectionContainerRef } from '@/components/selection';

import { useCanvasCommandContext } from './canvas-command-context';

/** Props for {@link CanvasSelectionFrame}. */
export interface CanvasSelectionFrameProps {
  /** Accessible graph label. */
  readonly label: string;
  /** Canvas content. */
  readonly children: ReactNode;
}

/** Bind shared selection and recoverable-delete keys without stealing focus from nested controls. */
export default function CanvasSelectionFrame({
  label,
  children,
}: CanvasSelectionFrameProps): JSX.Element {
  const { containerProps } = useSelection();
  const containerRef = useSelectionContainerRef();
  const commands = useCanvasCommandContext();
  return (
    <div
      {...containerProps}
      ref={containerRef}
      role="tree"
      aria-label={label}
      data-canvas-selection-frame=""
      tabIndex={0}
      onKeyDown={(event) => {
        containerProps.onKeyDown(event);
        if (!event.defaultPrevented) commands?.onCanvasKeyDown(event);
      }}
      className="focus-visible:ring-primary size-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset [@media(pointer:coarse)]:[&_a[href]]:min-h-10 [@media(pointer:coarse)]:[&_a[href]]:min-w-10 [@media(pointer:coarse)]:[&_button]:min-h-10 [@media(pointer:coarse)]:[&_button]:min-w-10"
    >
      {children}
    </div>
  );
}
