'use client';

import { useDragDropMonitor, useDragOperation, useDroppable } from '@dnd-kit/react';
import { useId, useMemo, useRef, useState } from 'react';

import { CURSOR_DROP_STATE } from '@/lib/actions/cursor';
import type { ObjectRef } from '@/lib/actions/object';
import { useOptionalActionRegistry } from '@/lib/actions/registry-context';

import { isObjectDragData, type ObjectDragData, resolveObjectRelation } from './object-drag-data';
import { useDragController } from './drag-context';

/** Inputs for a position-aware empty calendar lane destination. */
export interface UseSchedulingSlotDropTargetOptions {
  /** Convert a viewport Y coordinate into the lane's snapped minute. */
  readonly startMinutesAt: (clientY: number, bounds: DOMRect) => number;
  /** Describe the exact calendar slot at the snapped minute. */
  readonly targetAt: (startMinutes: number) => ObjectRef | null;
  /** Disable the lane while preserving its geometry. */
  readonly disabled?: boolean | undefined;
}

/** Position-aware empty calendar lane binding. */
export interface SchedulingSlotDropTargetBinding {
  /** Register the full lane as a destination. */
  readonly ref: (element: Element | null) => void;
  /** Cursor treatment for accepted and rejected destinations. */
  readonly className: string;
  /** Current destination state. */
  readonly dropState: 'idle' | 'accept' | 'reject';
  /** Exact snapped minute currently previewed. */
  readonly startMinutes: number | null;
  /** Application-owned pending effect. */
  readonly effectLabel: string | null;
}

/** Read the latest pointer coordinate without coupling callers to Dnd Kit events. */
function clientYFor(event: Event | undefined, fallback: number): number {
  return event && 'clientY' in event && typeof event.clientY === 'number'
    ? event.clientY
    : fallback;
}

/** Register an empty calendar lane as an exact, snapped relation destination. */
export function useSchedulingSlotDropTarget(
  options: UseSchedulingSlotDropTargetOptions,
): SchedulingSlotDropTargetBinding {
  const { startMinutesAt, targetAt, disabled = false } = options;
  const instanceId = useId();
  const dragController = useDragController();
  const nodeRef = useRef<Element | null>(null);
  const [startMinutes, setStartMinutes] = useState<number | null>(null);
  const registry = useOptionalActionRegistry();
  const operation = useDragOperation<ObjectDragData>();
  const source = isObjectDragData(operation.source?.data) ? operation.source.data : null;
  const target = startMinutes === null ? null : targetAt(startMinutes);
  const resolution = source && target ? resolveObjectRelation(source.objects, target) : null;
  const action = resolution?.accepted
    ? registry?.getByRelation(resolution.intent.relationId)
    : null;
  const canDrop = !disabled && action != null;
  const effectLabel =
    target && resolution?.accepted && action ? `Schedule at ${target.title}` : null;
  const droppableId = `docket-calendar-slot:${instanceId}`;
  const droppable = useDroppable({
    id: droppableId,
    type: 'docket-relation-target',
    collisionPriority: canDrop ? 2 : -2,
    disabled,
    data: { kind: 'docket-relation-target', target, effectLabel, canDrop },
  });

  useDragDropMonitor({
    onDragMove: (event) => {
      if (event.operation.target?.id !== droppableId || nodeRef.current === null) return;
      const bounds = nodeRef.current.getBoundingClientRect();
      setStartMinutes(
        startMinutesAt(clientYFor(event.nativeEvent, event.operation.position.current.y), bounds),
      );
    },
    onDragEnd: (event) => {
      if (event.operation.target?.id !== droppableId || registry === null) return;
      const dragData = event.operation.source?.data;
      if (!isObjectDragData(dragData)) return;
      const finalTarget = startMinutes === null ? null : targetAt(startMinutes);
      if (!finalTarget) return;
      const finalResolution = resolveObjectRelation(dragData.objects, finalTarget);
      if (!finalResolution.accepted) return;
      const definition = registry.getByRelation(finalResolution.intent.relationId);
      if (!definition) return;
      void registry
        .invoke(definition.id, () => ({
          objects: dragData.objects,
          target: finalTarget,
          source: 'drag',
          organizationId: finalTarget.organizationId ?? dragData.object.organizationId,
          ...(dragData.sourceSurfaceId === null ? {} : { surfaceId: dragData.sourceSurfaceId }),
          params: { relationId: finalResolution.intent.relationId },
        }))
        .then((result) => {
          dragController.announce(
            result.status === 'ran'
              ? `Completed: Schedule at ${finalTarget.title}`
              : result.status === 'failed'
                ? `Could not schedule at ${finalTarget.title}`
                : (result.detail ?? 'This time cannot receive this item'),
          );
        });
      setStartMinutes(null);
    },
  });

  const isOver = droppable.isDropTarget;
  const dropState = !isOver ? 'idle' : canDrop ? 'accept' : 'reject';
  return useMemo(
    () => ({
      ref: (element: Element | null) => {
        nodeRef.current = element;
        droppable.ref(element);
      },
      className: CURSOR_DROP_STATE,
      dropState,
      startMinutes: isOver ? startMinutes : null,
      effectLabel: isOver
        ? (effectLabel ?? (source ? 'This time cannot receive this item' : null))
        : null,
    }),
    [droppable.ref, dropState, effectLabel, isOver, source, startMinutes],
  );
}
