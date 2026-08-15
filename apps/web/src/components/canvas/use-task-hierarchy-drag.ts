'use client';

/** Task-specific hierarchy intent layered over xyflow's generic node-drag lifecycle. */
import { type Node, type OnNodeDrag, type ReactFlowInstance } from '@xyflow/react';
import { useCallback, useRef, useState, type DragEvent as ReactDragEvent } from 'react';

import { useDragState } from '@/components/dnd/drag-context';
import { readObjectSetPayload } from '@/components/dnd/drag-payload';
import { createTaskHierarchy } from '@/components/tasks/task-hierarchy-model';

interface DragResolution {
  readonly subjectIds: readonly string[];
  readonly targetId: string | null;
  readonly invalidTargetId: string | null;
}

function parentOf(node: Node): string | null {
  const parent = node.data['parentTaskId'];
  return typeof parent === 'string' ? parent : null;
}

function titleOf(node: Node | undefined, fallback: string): string {
  const title = node?.data['title'];
  return typeof title === 'string' ? title : fallback;
}

/** Resolve selected roots and the smallest eligible branch under a drag pointer. */
export function resolveHierarchyDrag(
  nodes: readonly Node[],
  selectedIds: readonly string[],
  draggedId: string,
  intersectingIds: readonly string[],
): DragResolution {
  const hierarchy = createTaskHierarchy(
    nodes.map((node) => ({ id: node.id, parentTaskId: parentOf(node) })),
  );
  const effectiveSelection = selectedIds.includes(draggedId) ? selectedIds : [draggedId];
  const knownIds = new Set(nodes.map(({ id }) => id));
  const knownRoots = new Set(
    hierarchy.selectedRoots(effectiveSelection.filter((id) => knownIds.has(id))),
  );
  const subjectIds = effectiveSelection.filter((id) => !knownIds.has(id) || knownRoots.has(id));
  const parentById = new Map(nodes.map((node) => [node.id, parentOf(node)]));
  const valid = new Set(
    hierarchy
      .validParentCandidates(subjectIds.filter((id) => knownIds.has(id)))
      .filter((candidate) => !subjectIds.includes(candidate.id))
      .filter((candidate) => !subjectIds.every((id) => parentById.get(id) === candidate.id))
      .map(({ id }) => id),
  );
  const candidates = intersectingIds
    .filter((id) => nodes.some((node) => node.id === id))
    .sort((a, b) => hierarchy.depthOf(b) - hierarchy.depthOf(a));
  return {
    subjectIds,
    targetId: candidates.find((id) => valid.has(id)) ?? null,
    invalidTargetId: candidates.find((id) => !valid.has(id)) ?? null,
  };
}

function withoutDragData(data: Node['data']): Node['data'] {
  const { hierarchyDragOrigin, hierarchyDropState, hierarchyPreviewCount, ...rest } = data;
  void hierarchyDragOrigin;
  void hierarchyDropState;
  void hierarchyPreviewCount;
  return rest;
}

/** Inputs for {@link useTaskHierarchyDrag}. */
export interface UseTaskHierarchyDragOptions {
  readonly nodes: readonly Node[];
  readonly selectedIds: readonly string[];
  readonly organizationId: string;
  readonly instance: ReactFlowInstance | null;
  readonly onCommit: (subjectIds: readonly string[], parentTaskId: string) => void;
}

/** xyflow drag handlers plus live-region feedback for direct hierarchy moves. */
export function useTaskHierarchyDrag({
  nodes,
  selectedIds,
  organizationId,
  instance,
  onCommit,
}: UseTaskHierarchyDragOptions): {
  readonly onNodeDragStart: OnNodeDrag;
  readonly onNodeDrag: OnNodeDrag;
  readonly onNodeDragStop: OnNodeDrag;
  readonly onNativeDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  readonly onNativeDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  readonly onNativeDrop: (event: ReactDragEvent<HTMLElement>) => void;
  readonly status: string | null;
} {
  const nativeDrag = useDragState();
  const resolution = useRef<DragResolution | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const decorate = useCallback(
    (next: DragResolution | null) => {
      if (!instance) return;
      instance.setNodes((current) =>
        current.map((node) => ({
          ...node,
          data: {
            ...withoutDragData(node.data),
            ...(next?.subjectIds.includes(node.id) ? { hierarchyDragOrigin: true } : {}),
            ...(node.id === next?.targetId
              ? { hierarchyDropState: 'accept', hierarchyPreviewCount: next.subjectIds.length }
              : node.id === next?.invalidTargetId
                ? { hierarchyDropState: 'reject' }
                : {}),
          },
        })),
      );
    },
    [instance],
  );

  const onNodeDragStart = useCallback<OnNodeDrag>(
    (_event, node) => {
      const next = resolveHierarchyDrag(nodes, selectedIds, node.id, []);
      resolution.current = next;
      decorate(next);
      setStatus(
        next.subjectIds.length === 1
          ? 'Moving task. Drop it on another task to make it a subtask.'
          : `Moving ${next.subjectIds.length} task branches. Drop them on another task to make subtasks.`,
      );
    },
    [nodes, selectedIds, decorate],
  );

  const onNodeDrag = useCallback<OnNodeDrag>(
    (event, node) => {
      if (!instance) return;
      const contact = 'touches' in event ? event.touches[0] : event;
      if (!contact) return;
      const point = instance.screenToFlowPosition({ x: contact.clientX, y: contact.clientY });
      const intersections = instance
        .getIntersectingNodes({ x: point.x, y: point.y, width: 1, height: 1 }, true)
        .filter(({ id, type }) => id !== node.id && (type === 'task' || type === 'taskBranch'))
        .map(({ id }) => id);
      const next = resolveHierarchyDrag(nodes, selectedIds, node.id, intersections);
      resolution.current = next;
      decorate(next);
      const count = next.subjectIds.length;
      const target = nodes.find(({ id }) => id === (next.targetId ?? next.invalidTargetId));
      setStatus(
        next.targetId !== null
          ? `Move ${count === 1 ? 'task' : `${count} task branches`} under ${titleOf(target, 'task')}`
          : next.invalidTargetId !== null
            ? `Cannot move ${count === 1 ? 'this task' : 'these task branches'} under ${titleOf(target, 'that task')}`
            : 'Drop on another task to make a subtask.',
      );
    },
    [instance, nodes, selectedIds, decorate],
  );

  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, _node) => {
      const committed = resolution.current;
      resolution.current = null;
      if (instance) {
        const laidOut = new Map(nodes.map((node) => [node.id, node]));
        instance.setNodes((current) =>
          current.map((node) => {
            const base = laidOut.get(node.id);
            return base
              ? {
                  ...node,
                  position: base.position,
                  parentId: base.parentId,
                  data: withoutDragData(node.data),
                }
              : node;
          }),
        );
      }
      setStatus(null);
      if (committed?.targetId) onCommit(committed.subjectIds, committed.targetId);
    },
    [instance, nodes, onCommit],
  );

  const nativeTargetId = useCallback((target: EventTarget | null): string | null => {
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>('[data-object-kind="task"][data-object-id]');
    return element?.dataset['objectId'] ?? null;
  }, []);

  const onNativeDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const targetId = nativeTargetId(event.target);
      const subjectIds = nativeDrag.objects
        .filter(
          ({ kind, organizationId: objectOrgId }) =>
            kind === 'task' && objectOrgId === organizationId,
        )
        .map(({ id }) => id);
      if (!targetId || subjectIds.length === 0) return;
      const next = resolveHierarchyDrag(nodes, subjectIds, subjectIds[0] ?? '', [targetId]);
      resolution.current = next;
      decorate(next);
      if (next.targetId === null) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const target = nodes.find(({ id }) => id === next.targetId);
      setStatus(
        `Move ${next.subjectIds.length === 1 ? 'task' : `${next.subjectIds.length} task branches`} under ${titleOf(target, 'task')}`,
      );
    },
    [nativeTargetId, nativeDrag.objects, organizationId, nodes, decorate],
  );

  const onNativeDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (
        event.relatedTarget instanceof Element &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      resolution.current = null;
      decorate(null);
      setStatus(null);
    },
    [decorate],
  );

  const onNativeDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const targetId = nativeTargetId(event.target);
      const objects = readObjectSetPayload(event.dataTransfer);
      const subjectIds = objects
        .filter(
          ({ kind, organizationId: objectOrgId }) =>
            kind === 'task' && objectOrgId === organizationId,
        )
        .map(({ id }) => id);
      const next =
        targetId && subjectIds[0]
          ? resolveHierarchyDrag(nodes, subjectIds, subjectIds[0], [targetId])
          : null;
      resolution.current = null;
      decorate(null);
      setStatus(null);
      if (!next?.targetId) return;
      event.preventDefault();
      onCommit(next.subjectIds, next.targetId);
    },
    [nativeTargetId, organizationId, nodes, decorate, onCommit],
  );

  return {
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    onNativeDragOver,
    onNativeDragLeave,
    onNativeDrop,
    status,
  };
}
