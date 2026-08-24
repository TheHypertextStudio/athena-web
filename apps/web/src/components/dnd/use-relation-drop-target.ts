'use client';

import {
  type RelationId,
  type RelationIntent,
  type RelationRejectionReason,
  type RelationResolution,
} from '@docket/work/relation-contract';
import { useDragDropMonitor, useDragOperation, useDroppable } from '@dnd-kit/react';
import { useId, useMemo } from 'react';

import { CURSOR_DROP_STATE } from '@/lib/actions/cursor';
import type { ObjectRef } from '@/lib/actions/object';
import { useOptionalActionRegistry } from '@/lib/actions/registry-context';
import type { ActionInvocationResult } from '@/lib/actions/types';

import { isObjectDragData, type ObjectDragData, resolveObjectRelation } from './object-drag-data';
import { useDragController } from './drag-context';

/** Shared visual state for a canonical destination. */
export type DropState = 'idle' | 'accept' | 'reject';

/** Result from a surface that owns persistence for the resolved drop. */
export type RelationDropExecutionResult = 'applied' | 'unchanged' | 'failed';

/** Execute a resolved drop through the surface's own command boundary. */
export type RelationDropExecutor = (intent: RelationIntent) => Promise<RelationDropExecutionResult>;

/** Options for one object relationship destination. */
export interface UseRelationDropTargetOptions {
  /** Object that will receive the resolved relationship. */
  readonly target: ObjectRef;
  /** Turn the destination off while retaining its layout. */
  readonly disabled?: boolean | undefined;
  /** Observe the registered action result for application-owned feedback. */
  readonly onResult?: ((result: ActionInvocationResult) => void) | undefined;
  /** Prefer a surface-owned command path over the global registered action. */
  readonly execute?: RelationDropExecutor | undefined;
  /** Collision tier for nested destinations. Object rows outrank groups, which outrank roots. */
  readonly priority?: 'object' | 'group' | 'root' | undefined;
}

const ACCEPTED_COLLISION_PRIORITY = { object: 4, group: 2, root: 0 } as const;
const REJECTED_COLLISION_PRIORITY = { object: -1, group: -2, root: -3 } as const;

/** Props supplied to the destination element. */
export interface RelationDropTargetProps {
  /** Register the element with the shared drag manager. */
  readonly ref: (element: Element | null) => void;
  /** Stable state hook for the destination treatment. */
  readonly 'data-drop-state': DropState;
  /** Shared rejecting-cursor selector. */
  readonly className: string;
}

/** Live relationship state returned to a destination renderer. */
export interface RelationDropTargetBinding {
  /** Props to compose onto the full destination surface. */
  readonly dropProps: RelationDropTargetProps;
  /** Whether this destination owns the current collision. */
  readonly isOver: boolean;
  /** Whether the current source resolves to a registered action here. */
  readonly canDrop: boolean;
  /** Combined destination state. */
  readonly dropState: DropState;
  /** Application-owned preview or rejection sentence. */
  readonly effectLabel: string | null;
  /** Resolved domain relation, when accepted. */
  readonly relationId: RelationId | null;
}

/** Resolve one source payload against a destination object. */
function resolutionFor(data: unknown, target: ObjectRef): RelationResolution | null {
  if (!isObjectDragData(data)) return null;
  return resolveObjectRelation(data.objects, target);
}

/** Human-readable effect copy owned by the application instead of the transport. */
function acceptedLabel(relationId: RelationId, target: ObjectRef): string {
  switch (relationId) {
    case 'task.parent':
      return `Make a subtask of ${target.title}`;
    case 'task.cycle':
      return `Commit to ${target.title}`;
    case 'initiative.root':
      return 'Move to top level';
    case 'task.assignee':
      return `Assign to ${target.title}`;
    case 'task.label':
    case 'project.label':
    case 'program.label':
    case 'initiative.label':
      return `Add ${target.title}`;
    case 'project.blocks':
      return `Block ${target.title}`;
    case 'task.calendar-item':
    case 'project.initiative':
    case 'program.initiative':
    case 'calendar-item.related':
      return `Link to ${target.title}`;
    default:
      return `Move to ${target.title}`;
  }
}

/** Stable application-owned copy for local relation rejections. */
function rejectedLabel(reason: RelationRejectionReason): string {
  switch (reason) {
    case 'cross_organization':
      return 'This item belongs to another workspace';
    case 'self_relation':
      return 'An item cannot be related to itself';
    case 'incompatible_parent':
      return 'This destination belongs to a different parent';
    case 'hierarchy_cycle':
      return 'This move would create a hierarchy cycle';
    case 'archived_target':
      return 'Archived items cannot receive this relationship';
    case 'permission_denied':
      return 'You do not have permission to change this relationship';
    case 'empty_subjects':
    case 'mixed_subject_kinds':
    case 'unsupported_pair':
      return 'This relationship is not available';
  }
}

/**
 * Register one object as a relationship destination.
 *
 * @param options - Destination object and availability.
 * @returns DOM binding and resolved preview state.
 */
export function useRelationDropTarget(
  options: UseRelationDropTargetOptions,
): RelationDropTargetBinding {
  const { target, disabled = false, onResult, execute, priority = 'object' } = options;
  const instanceId = useId();
  const dragController = useDragController();
  const registry = useOptionalActionRegistry();
  const operation = useDragOperation<ObjectDragData>();
  const resolution = resolutionFor(operation.source?.data, target);
  const relationId = resolution?.accepted === true ? resolution.intent.relationId : null;
  const action = relationId === null ? undefined : registry?.getByRelation(relationId);
  const hasExecutor = execute !== undefined || action !== undefined;
  const canDrop = !disabled && hasExecutor;
  const previewLabel =
    resolution?.accepted === true && hasExecutor
      ? acceptedLabel(resolution.intent.relationId, target)
      : null;
  const droppableId = `docket-relation-target:${target.kind}:${target.id}:${instanceId}`;
  const droppable = useDroppable({
    id: droppableId,
    type: 'docket-relation-target',
    collisionPriority: canDrop
      ? ACCEPTED_COLLISION_PRIORITY[priority]
      : REJECTED_COLLISION_PRIORITY[priority],
    data: {
      kind: 'docket-relation-target',
      target,
      effectLabel: previewLabel,
      canDrop,
    },
    disabled,
  });
  const isOver = droppable.isDropTarget;
  const dropState: DropState = !isOver ? 'idle' : canDrop ? 'accept' : 'reject';
  const effectLabel =
    !isOver || resolution === null
      ? null
      : resolution.accepted
        ? !hasExecutor
          ? 'This relationship is not available'
          : previewLabel
        : rejectedLabel(resolution.reason);

  useDragDropMonitor({
    onDragEnd: (event) => {
      if (event.operation.target?.id !== droppableId || disabled) return;
      const dropped = resolutionFor(event.operation.source?.data, target);
      if (dropped?.accepted !== true) return;
      const source = event.operation.source?.data;
      if (!isObjectDragData(source)) return;
      const resultLabel = acceptedLabel(dropped.intent.relationId, target);
      if (execute !== undefined) {
        void execute(dropped.intent)
          .then((result) => {
            dragController.announce(
              result === 'failed'
                ? `Could not complete: ${resultLabel}`
                : result === 'unchanged'
                  ? `No change needed: ${resultLabel}`
                  : `Completed: ${resultLabel}`,
            );
          })
          .catch(() => {
            dragController.announce(`Could not complete: ${resultLabel}`);
          });
        return;
      }
      if (registry === null) return;
      const definition = registry.getByRelation(dropped.intent.relationId);
      if (definition === undefined) return;
      void registry
        .invoke(definition.id, () => ({
          objects: source.objects,
          target,
          source: 'drag',
          organizationId: target.organizationId ?? source.object.organizationId,
          ...(source.sourceSurfaceId === null ? {} : { surfaceId: source.sourceSurfaceId }),
          params: { relationId: dropped.intent.relationId },
        }))
        .then((result) => {
          onResult?.(result);
          dragController.announce(
            result.status === 'ran'
              ? `Completed: ${resultLabel}`
              : result.status === 'failed'
                ? `Could not complete: ${resultLabel}`
                : (result.detail ?? 'This relationship is not available'),
          );
        });
    },
  });

  return useMemo(
    () => ({
      dropProps: {
        ref: droppable.ref,
        'data-drop-state': dropState,
        className: CURSOR_DROP_STATE,
      },
      isOver,
      canDrop,
      dropState,
      effectLabel,
      relationId,
    }),
    [droppable.ref, dropState, isOver, canDrop, effectLabel, relationId],
  );
}
