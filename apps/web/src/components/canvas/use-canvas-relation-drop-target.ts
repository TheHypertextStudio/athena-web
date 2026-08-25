'use client';

/** Keep same-kind canvas relation drops inside the canvas receipt history. */
import { type ObjectCommandIn, ProjectId, TaskId } from '@docket/types';
import type { RelationIntent } from '@docket/work/relation-contract';
import { useCallback } from 'react';

import {
  type RelationDropExecutionResult,
  type RelationDropTargetBinding,
  useRelationDropTarget,
} from '@/components/dnd/use-relation-drop-target';
import type { ObjectRef } from '@/lib/actions';

import { useCanvasCommandContext } from './canvas-command-context';
import { canvasCommandId } from './use-canvas-command-history';

/** One resolved relation command and the history label shown by Undo and Redo. */
export interface CanvasRelationCommand {
  /** Atomic object command sent to the canvas command endpoint. */
  readonly command: ObjectCommandIn;
  /** User-facing action name stored beside the receipt. */
  readonly label: string;
}

/**
 * Convert a relation accepted by a canvas node into its receipt-backed object command.
 *
 * @param intent - Pure relation intent resolved from the dragged source and node destination.
 * @param commandId - Idempotency key allocated for this gesture.
 * @returns The owned canvas command, or `null` when another application surface owns the relation.
 */
export function canvasRelationCommand(
  intent: RelationIntent,
  commandId: string,
): CanvasRelationCommand | null {
  if (
    intent.relationId === 'task.parent' &&
    intent.target.kind === 'task' &&
    intent.subjects.length > 0 &&
    intent.subjects.every(({ kind }) => kind === 'task')
  ) {
    const taskIds = intent.subjects.map(({ id }) => TaskId.parse(id));
    return {
      command: {
        commandId,
        objectKind: 'task',
        objectIds: taskIds,
        operation: { type: 'change_parent', parentId: TaskId.parse(intent.target.id) },
      },
      label:
        intent.subjects.length === 1
          ? 'Move Task branch'
          : `Move ${String(intent.subjects.length)} Task branches`,
    };
  }
  const [blocking] = intent.subjects;
  if (
    intent.relationId === 'project.blocks' &&
    blocking?.kind === 'project' &&
    intent.subjects.length === 1 &&
    intent.target.kind === 'project'
  ) {
    const blockingId = ProjectId.parse(blocking.id);
    const blockedId = ProjectId.parse(intent.target.id);
    return {
      command: {
        commandId,
        objectKind: 'project',
        objectIds: [blockingId, blockedId],
        operation: {
          type: 'add_dependency',
          blockingId,
          blockedId,
        },
      },
      label: 'Add dependency',
    };
  }
  return null;
}

/**
 * Bind a canvas node as a destination whose mutation stays in the route-scoped command history.
 *
 * @param target - Project or Task node that receives the resolved relation.
 * @returns Shared Dnd Kit destination state and canvas-owned execution.
 */
export function useCanvasRelationDropTarget(target: ObjectRef): RelationDropTargetBinding {
  const commands = useCanvasCommandContext();
  const canEdit = commands?.canEdit ?? false;
  const executeCommand = commands?.execute;
  const selectedObjects = commands?.selectedObjects ?? [];
  const execute = useCallback(
    async (intent: RelationIntent): Promise<RelationDropExecutionResult> => {
      if (!canEdit || executeCommand === undefined) return 'failed';
      const resolved = canvasRelationCommand(intent, canvasCommandId());
      if (resolved === null) return 'failed';
      const subjectName =
        selectedObjects.find(({ id }) => id === intent.subjects[0]?.id)?.title ??
        (intent.subjects[0]?.kind === 'project' ? 'Project' : 'Task');
      const result = await executeCommand(resolved.command, {
        historyLabel: resolved.label,
        title: intent.relationId === 'project.blocks' ? 'Dependency added' : 'Task moved',
        detail:
          intent.relationId === 'project.blocks'
            ? `${target.title} depends on ${subjectName}`
            : intent.subjects.length === 1
              ? `${subjectName} is now under ${target.title}`
              : `${String(intent.subjects.length)} tasks are now under ${target.title}`,
        unchangedTitle:
          intent.relationId === 'project.blocks' ? 'Dependency unchanged' : 'Task already there',
        unchangedDetail:
          intent.relationId === 'project.blocks'
            ? `${target.title} already depends on ${subjectName}`
            : intent.subjects.length === 1
              ? `${subjectName} is already under ${target.title}`
              : `${String(intent.subjects.length)} tasks are already under ${target.title}`,
      });
      if (result === null) return 'failed';
      return result.receipt.entries.length === 0 ? 'unchanged' : 'applied';
    },
    [canEdit, executeCommand, selectedObjects, target.title],
  );
  return useRelationDropTarget({ target, disabled: !canEdit, execute });
}
