'use client';

/** Shared task-row hierarchy drop behavior and preview treatment. */
import { useMemo } from 'react';

import { useDragState } from '@/components/dnd/drag-context';
import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';
import {
  createTaskHierarchy,
  type TaskHierarchyItem,
} from '@/components/tasks/task-hierarchy-model';
import type { ObjectRef } from '@/lib/actions';

/** Binding a task row merges into its selectable root. */
export interface TaskHierarchyDropBinding {
  readonly rowProps: ReturnType<typeof useRelationDropTarget>['dropProps'];
  readonly className: string;
  readonly status: string | null;
}

/**
 * Make one task row a hierarchy target for the ordered task set currently in flight.
 *
 * @param target - Task represented by this row.
 * @param tasks - Complete visible hierarchy used to exclude descendant targets.
 * @returns DOM handlers, preview classes, and live-region copy.
 */
export function useTaskHierarchyDrop(
  target: ObjectRef & { readonly kind: 'task' },
  tasks: readonly TaskHierarchyItem[],
): TaskHierarchyDropBinding {
  const drag = useDragState();
  const hierarchy = useMemo(() => createTaskHierarchy(tasks), [tasks]);
  const draggedObjects = useMemo(
    () => (drag.objects.length > 0 ? drag.objects : drag.object ? [drag.object] : []),
    [drag.object, drag.objects],
  );
  const draggedTaskIds = useMemo(
    () => draggedObjects.filter((object) => object.kind === 'task').map(({ id }) => id),
    [draggedObjects],
  );
  const validTargets = useMemo(
    () => new Set(hierarchy.validParentCandidates(draggedTaskIds).map(({ id }) => id)),
    [draggedTaskIds, hierarchy],
  );

  const drop = useRelationDropTarget({
    target,
    disabled: draggedTaskIds.length > 0 && !validTargets.has(target.id),
  });

  const count = draggedTaskIds.length || 1;
  return {
    rowProps: drop.dropProps,
    className:
      drop.dropState === 'accept'
        ? 'ring-primary bg-primary/8 relative z-10 ring-2 ring-inset before:bg-primary before:absolute before:top-1/2 before:left-5 before:h-5 before:w-5 before:-translate-y-1/2 before:rounded-bl-xl before:border-b-2 before:border-l-2 before:border-primary'
        : drop.dropState === 'reject'
          ? 'ring-error/60 bg-error/5 ring-1 ring-inset'
          : '',
    status: drop.isOver
      ? drop.canDrop
        ? `Move ${count === 1 ? 'task' : `${count} tasks`} under ${target.title}`
        : `Cannot move ${count === 1 ? 'this task' : 'these tasks'} under ${target.title}`
      : null,
  };
}
