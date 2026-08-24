'use client';

/** Focus and keyboard boundary shared by Project and Task graph selection surfaces. */
import type { DragEventHandler, JSX, ReactNode } from 'react';

import { useSelection, useSelectionContainerRef } from '@/components/selection';

import { useCanvasCommandContext } from './canvas-command-context';

/** Props for {@link CanvasSelectionFrame}. */
export interface CanvasSelectionFrameProps {
  /** Accessible graph label. */
  readonly label: string;
  /** Optional hierarchy drag handlers used by the Task graph. */
  readonly onDragOver?: DragEventHandler<HTMLDivElement> | undefined;
  readonly onDragLeave?: DragEventHandler<HTMLDivElement> | undefined;
  readonly onDrop?: DragEventHandler<HTMLDivElement> | undefined;
  /** Canvas content. */
  readonly children: ReactNode;
}

/** Bind shared selection and recoverable-delete keys without stealing focus from nested controls. */
export default function CanvasSelectionFrame({
  label,
  onDragOver,
  onDragLeave,
  onDrop,
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
      tabIndex={0}
      onKeyDown={(event) => {
        containerProps.onKeyDown(event);
        if (!event.defaultPrevented) commands?.onCanvasKeyDown(event);
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="size-full focus:outline-none"
    >
      {children}
    </div>
  );
}
