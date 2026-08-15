'use client';

/**
 * `components/dnd/use-draggable` — make any object pickable up.
 *
 * @remarks
 * The whole of "this row can be dragged" from a surface's point of view: one hook, one spread. It
 * writes the object payload, records the gesture in {@link ./drag-context}, and applies the cursor
 * contract so the pointer says `grab` at rest and `grabbing` through the gesture without the
 * caller thinking about it.
 *
 * It deliberately does *not* emit the `data-object-*` attributes. Those come from
 * `objectTargetProps`, are needed whether or not a thing is draggable (the right-click menu wants
 * them on a detail-page header too), and belong to the object descriptor rather than to drag.
 */
import { useCallback, useMemo } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';

import { CURSOR_DRAGGABLE } from '@/lib/actions/cursor';
import { describeObject, type ObjectRef } from '@/lib/actions/object';

import { useDragController } from './drag-context';
import { writeObjectPayload, writeObjectSetPayload } from './drag-payload';

/** Options for {@link useDraggable}. */
export interface UseDraggableOptions {
  /**
   * The object this element represents, or `null` when there is nothing to drag yet.
   *
   * @remarks
   * Nullable so a row can call the hook unconditionally while its data loads, rather than
   * branching around a hook call.
   */
  readonly object: ObjectRef | null;
  /**
   * Suppress dragging for this instance.
   *
   * @remarks
   * For rows the viewer genuinely may not move — a cross-workspace reference, a read-only
   * projection. A suppressed row keeps normal text-selection behavior instead of pretending.
   */
  readonly disabled?: boolean | undefined;
  /** The selection surface this row belongs to, recorded on the drag for targets that care. */
  readonly surfaceId?: string | undefined;
  /** Ordered selection to carry when this object is one of the selected rows. */
  readonly objects?: readonly ObjectRef[] | undefined;
  /** Run as the gesture starts, after the payload is written (e.g. to dim the row). */
  readonly onDragStart?: (() => void) | undefined;
  /** Run once the gesture ends, dropped or cancelled. */
  readonly onDragEnd?: (() => void) | undefined;
}

/** The props {@link useDraggable} contributes to an element. */
export interface DraggableBinding {
  /** Whether the element is draggable at all. */
  readonly draggable: boolean;
  /** Cursor + selection-suppression classes; merge with the element's own via `cn`. */
  readonly className: string;
  /** Writes the payload and opens the gesture. */
  readonly onDragStart: (event: ReactDragEvent) => void;
  /** Closes the gesture. */
  readonly onDragEnd: (event: ReactDragEvent) => void;
}

/**
 * Bind an element as a draggable object.
 *
 * @param options - The object and its drag policy.
 * @returns Props to spread onto the element that represents the object.
 *
 * @example
 * ```tsx
 * const drag = useDraggable({ object: task, surfaceId });
 * return (
 *   <div
 *     {...objectTargetProps(task)}
 *     {...drag}
 *     className={cn('flex h-10 items-center px-3', drag.className)}
 *   >
 *     <a href={`/tasks/${task.id}`} className={CURSOR_CLICKABLE}>{task.title}</a>
 *   </div>
 * );
 * ```
 *
 * @see {@link ../../lib/actions/cursor} for why the row reports `grab` while its title link
 * reports `pointer`.
 */
export function useDraggable(options: UseDraggableOptions): DraggableBinding {
  const { object, objects, disabled = false, surfaceId, onDragStart, onDragEnd } = options;
  const controller = useDragController();

  const canDrag = object !== null && !disabled && describeObject(object.kind).draggable;

  const handleDragStart = useCallback(
    (event: ReactDragEvent) => {
      if (object === null || !canDrag) return;
      if (objects && objects.length > 0) writeObjectSetPayload(event.dataTransfer, objects, object);
      else writeObjectPayload(event.dataTransfer, object);
      controller.begin(object, surfaceId ?? null, objects);
      onDragStart?.();
    },
    [object, objects, canDrag, controller, surfaceId, onDragStart],
  );

  const handleDragEnd = useCallback(() => {
    controller.end();
    onDragEnd?.();
  }, [controller, onDragEnd]);

  return useMemo<DraggableBinding>(
    () => ({
      draggable: canDrag,
      className: canDrag ? CURSOR_DRAGGABLE : '',
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
    }),
    [canDrag, handleDragStart, handleDragEnd],
  );
}
