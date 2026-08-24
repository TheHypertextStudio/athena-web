'use client';

import { cn } from '@docket/ui/lib/utils';
import type { HTMLAttributes, JSX, ReactNode } from 'react';

import { useSchedulingSlotDropTarget } from '@/components/dnd/use-scheduling-slot-drop-target';
import type { ObjectRef } from '@/lib/actions/object';

/** Props for one position-aware empty calendar lane destination. */
export interface SchedulingRelationSlotLaneProps extends HTMLAttributes<HTMLDivElement> {
  /** Convert one viewport coordinate into a snapped minute. */
  readonly startMinutesAt: (clientY: number, bounds: DOMRect) => number;
  /** Build the exact relation target at one snapped minute. */
  readonly targetAt: (startMinutes: number) => ObjectRef | null;
  /** Convert a snapped minute into the lane-local preview offset. */
  readonly previewTop: (startMinutes: number) => number;
  /** Height of the exact scheduling preview. */
  readonly previewHeight: number;
  /** Disable relation targeting while keeping the lane interactive for scheduling gestures. */
  readonly disabled?: boolean | undefined;
  /** Existing lane content. */
  readonly children: ReactNode;
}

/** Render a calendar lane that previews and executes a canonical relation action. */
export function SchedulingRelationSlotLane({
  startMinutesAt,
  targetAt,
  previewTop,
  previewHeight,
  disabled,
  className,
  children,
  ...props
}: SchedulingRelationSlotLaneProps): JSX.Element {
  const drop = useSchedulingSlotDropTarget({ startMinutesAt, targetAt, disabled });
  return (
    <div
      {...props}
      ref={drop.ref}
      className={cn(className, drop.className)}
      data-drop-state={drop.dropState}
    >
      {children}
      {drop.startMinutes !== null ? (
        <div
          className={cn(
            'text-label-small pointer-events-none absolute inset-x-1 z-[65] rounded-md border-2 px-2 py-1',
            drop.dropState === 'accept'
              ? 'border-primary bg-primary-container text-on-primary-container'
              : 'border-error bg-error-container text-on-error-container',
          )}
          data-schedule-slot-preview={drop.startMinutes}
          style={{ top: previewTop(drop.startMinutes), height: previewHeight }}
        >
          {drop.effectLabel}
        </div>
      ) : null}
    </div>
  );
}
