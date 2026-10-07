'use client';

/** A selected task row accepts another selected task as a reorder gesture. */
import { useDragDropMonitor, useDroppable } from '@dnd-kit/react';
import { useId, useRef, useState } from 'react';

import { isObjectDragData } from '@/components/dnd/object-drag-data';
import { useCollisionDetectorWithPriority } from '@/components/dnd/source-aware-collision-detector';

/** Bind a work row to the shared drag transport while leaving agenda drops intact. */
export function useWorkRowDropTarget(options: {
  readonly taskId: string;
  readonly title: string;
  readonly onReorder: (taskId: string, targetId: string, placement: 'before' | 'after') => void;
}): {
  readonly ref: (element: Element | null) => void;
  readonly isOver: boolean;
  readonly placement: 'before' | 'after';
} {
  const id = `daily-plan-row:${useId()}`;
  const nodeRef = useRef<Element | null>(null);
  const [placement, setPlacement] = useState<'before' | 'after'>('before');
  const accepts = (data: unknown): boolean =>
    isObjectDragData(data) &&
    data.object.kind === 'task' &&
    data.object.id !== options.taskId &&
    data.sourceSurfaceId === 'daily-planning' &&
    data.actionScope === 'all';
  const collisionDetector = useCollisionDetectorWithPriority((input) =>
    accepts(input.dragOperation.source?.data) ? 4 : -2,
  );
  const droppable = useDroppable({
    id,
    type: 'daily-plan-row',
    collisionDetector,
    data: { effectLabel: `Reorder near ${options.title}` },
  });
  useDragDropMonitor({
    onDragMove: (event) => {
      if (event.operation.target?.id !== id || nodeRef.current === null) return;
      const bounds = nodeRef.current.getBoundingClientRect();
      const native = event.nativeEvent;
      const y =
        native && 'clientY' in native && typeof native.clientY === 'number'
          ? native.clientY
          : event.operation.position.current.y;
      setPlacement(y < bounds.top + bounds.height / 2 ? 'before' : 'after');
    },
    onDragEnd: (event) => {
      if (event.operation.target?.id !== id || nodeRef.current === null) return;
      const source = event.operation.source?.data;
      if (!accepts(source) || !isObjectDragData(source)) return;
      const bounds = nodeRef.current.getBoundingClientRect();
      const native = event.nativeEvent;
      const y =
        native && 'clientY' in native && typeof native.clientY === 'number'
          ? native.clientY
          : event.operation.position.current.y;
      options.onReorder(
        source.object.id,
        options.taskId,
        y < bounds.top + bounds.height / 2 ? 'before' : 'after',
      );
    },
  });
  return {
    ref: (element) => {
      nodeRef.current = element;
      droppable.ref(element);
    },
    isOver: droppable.isDropTarget,
    placement,
  };
}
