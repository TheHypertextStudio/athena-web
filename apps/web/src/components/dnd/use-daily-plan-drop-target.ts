'use client';

import { useDragDropMonitor, useDroppable } from '@dnd-kit/react';
import { useId, useRef } from 'react';

import { isObjectDragData } from './object-drag-data';
import { useCollisionDetectorWithPriority } from './source-aware-collision-detector';

/** One day-planning agenda that accepts selected task rows at a snapped time. */
export interface DailyPlanDropTargetOptions {
  readonly startMinutesAt: (clientY: number, bounds: DOMRect) => number;
  readonly onDropTask: (taskId: string, minute: number) => void;
}

/** Bind the agenda to the shared object-drag transport. */
export function useDailyPlanDropTarget(options: DailyPlanDropTargetOptions): {
  readonly ref: (element: Element | null) => void;
  readonly isOver: boolean;
} {
  const id = `daily-plan-agenda:${useId()}`;
  const nodeRef = useRef<Element | null>(null);
  const acceptsSource = (data: unknown): boolean =>
    isObjectDragData(data) &&
    data.object.kind === 'task' &&
    data.sourceSurfaceId === 'daily-planning' &&
    data.actionScope === 'all';
  const collisionDetector = useCollisionDetectorWithPriority((input) => {
    if (!acceptsSource(input.dragOperation.source?.data) || nodeRef.current === null) return -2;
    return 3;
  });
  const droppable = useDroppable({
    id,
    type: 'daily-plan-agenda',
    collisionDetector,
    data: { effectLabel: 'Place task on agenda' },
  });

  useDragDropMonitor({
    onDragEnd: (event) => {
      if (event.operation.target?.id !== id || nodeRef.current === null) return;
      const data = event.operation.source?.data;
      if (!isObjectDragData(data) || !acceptsSource(data)) return;
      const native = event.nativeEvent;
      const clientY =
        native && 'clientY' in native && typeof native.clientY === 'number'
          ? native.clientY
          : event.operation.position.current.y;
      const minute = options.startMinutesAt(clientY, nodeRef.current.getBoundingClientRect());
      options.onDropTask(data.object.id, minute);
    },
  });

  return {
    ref: (element) => {
      nodeRef.current = element;
      droppable.ref(element);
    },
    isOver: droppable.isDropTarget,
  };
}
