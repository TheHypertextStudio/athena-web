import type { JSX } from 'react';

import { SchedulingGripIcon } from './scheduling-item-icons';
import type { SchedulingAllDayGestureController } from './use-scheduling-all-day-gesture';

/** Render the keyboard, pointer, and touch move control for a true all-day start segment. */
export function SchedulingAllDayMoveControl({
  itemTitle,
  gesture,
}: {
  readonly itemTitle: string;
  readonly gesture: SchedulingAllDayGestureController;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`Move ${itemTitle}`}
      className="focus-visible:ring-ring absolute top-1/2 right-0.5 z-30 size-5 -translate-y-1/2 cursor-grab touch-none rounded text-(--schedule-item-foreground) opacity-0 transition-opacity outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-inset active:cursor-grabbing motion-reduce:transition-none [@media(pointer:coarse)]:size-10"
      onPointerDown={gesture.onMovePointerDown}
      onKeyDown={gesture.onMoveKeyDown}
    >
      <SchedulingGripIcon />
    </button>
  );
}

/** Render one horizontal true-edge resize target for an all-day range. */
export function SchedulingAllDayResizeControl({
  itemTitle,
  edge,
  gesture,
}: {
  readonly itemTitle: string;
  readonly edge: 'start' | 'end';
  readonly gesture: SchedulingAllDayGestureController;
}): JSX.Element {
  const start = edge === 'start';
  return (
    <button
      type="button"
      aria-label={`Resize ${itemTitle} from ${edge}`}
      className={`focus-visible:ring-ring absolute inset-y-0 z-30 w-3 cursor-ew-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset [@media(pointer:coarse)]:w-10 ${start ? 'left-0 rounded-l' : 'right-0 rounded-r'}`}
      data-schedule-all-day-resize={edge}
      onPointerDown={start ? gesture.onStartResizePointerDown : gesture.onEndResizePointerDown}
      onKeyDown={start ? gesture.onStartResizeKeyDown : gesture.onEndResizeKeyDown}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-(--schedule-item-foreground) opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none ${start ? 'left-0.5' : 'right-0.5'}`}
      />
    </button>
  );
}
