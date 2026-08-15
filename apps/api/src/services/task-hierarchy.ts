/** `@docket/api` — atomic task hierarchy mutations shared by REST write surfaces. */
import { task } from '@docket/db';
import type { TaskReparentBatchOut } from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { CycleError, NotFoundError, ValidationError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import { diffTaskFields, recordTaskChanges, resolveTaskChangeLabels } from '../lib/task-audit';
import { enqueueSearchUpsert } from '../search/write-through';

type TaskRow = typeof task.$inferSelect;
interface RequestedMove {
  readonly taskId: string;
  readonly parentTaskId: string | null;
}
type CommittedMove = RequestedMove & { readonly previousParentTaskId: string | null };

/** Input for {@link reparentTasks}. */
export interface ReparentTasksInput {
  /** Organization that owns every subject and target task. */
  readonly organizationId: string;
  /** Actor responsible for the hierarchy change. */
  readonly actorId: string | null;
  /** Requested task-parent assignments. */
  readonly moves: readonly RequestedMove[];
  /** Whether selected descendants remain attached to selected ancestors. */
  readonly preserveSelectedSubtrees: boolean;
}

/** Whether walking parents from `taskId` reaches another selected task. */
function hasSelectedAncestor(
  taskId: string,
  selectedIds: ReadonlySet<string>,
  parents: ReadonlyMap<string, string | null>,
): boolean {
  const visited = new Set<string>();
  let current = parents.get(taskId) ?? null;
  while (current !== null && !visited.has(current)) {
    if (selectedIds.has(current)) return true;
    visited.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/** Throw when the proposed complete parent map contains a hierarchy cycle. */
function assertAcyclic(parents: ReadonlyMap<string, string | null>): void {
  for (const startId of parents.keys()) {
    const path = new Set<string>();
    let current: string | null = startId;
    while (current !== null) {
      if (path.has(current)) {
        throw new CycleError('Reparenting would create a task hierarchy cycle');
      }
      path.add(current);
      current = parents.get(current) ?? null;
    }
  }
}

/**
 * Validate a proposed hierarchy against active organization tasks and reduce it to committed roots.
 *
 * @param rows - Complete active task set for one organization.
 * @param moves - Requested parent assignments in interaction order.
 * @param preserveSelectedSubtrees - Whether descendants selected with an ancestor stay attached.
 * @returns assignments that should be written, in request order.
 */
export function planTaskReparents(
  rows: readonly Pick<TaskRow, 'id' | 'parentTaskId'>[],
  moves: readonly RequestedMove[],
  preserveSelectedSubtrees: boolean,
): RequestedMove[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const parents = new Map(rows.map((row) => [row.id, row.parentTaskId]));

  for (const [index, move] of moves.entries()) {
    if (!rowsById.has(move.taskId)) throw new NotFoundError('Task not found');
    if (move.parentTaskId !== null && !rowsById.has(move.parentTaskId)) {
      throw new NotFoundError('Task not found');
    }
    if (move.taskId === move.parentTaskId) {
      throw new ValidationError([
        {
          message: 'A task cannot be its own parent',
          path: ['moves', index, 'parentTaskId'],
        },
      ]);
    }
  }

  const selectedIds = new Set(moves.map(({ taskId }) => taskId));
  const roots = preserveSelectedSubtrees
    ? moves.filter(({ taskId }) => !hasSelectedAncestor(taskId, selectedIds, parents))
    : [...moves];
  const proposedParents = new Map(parents);
  for (const move of roots) proposedParents.set(move.taskId, move.parentTaskId);
  assertAcyclic(proposedParents);
  return roots;
}

/**
 * Atomically assign task hierarchy parents and return the exact assignments required for Undo.
 *
 * @remarks
 * Validation and every parent write run in one SERIALIZABLE transaction. The cycle check evaluates
 * the complete proposed graph, so a batch that is cyclic only in combination cannot partially
 * commit. With subtree preservation enabled, selected descendants are deliberately omitted from
 * the write set and remain attached to the nearest selected ancestor.
 *
 * @param input - Organization-scoped assignments and mutation actor.
 * @returns committed hierarchy roots in request order, with their previous parents.
 * @throws {NotFoundError} When any subject or target is not an active task in the organization.
 * @throws {ValidationError} When one task is assigned as its own parent.
 * @throws {CycleError} When the proposed hierarchy would contain a cycle.
 */
export async function reparentTasks(
  input: ReparentTasksInput,
): Promise<z.input<typeof TaskReparentBatchOut>> {
  const committed = await serializableTx(async (tx) => {
    const rows = await tx
      .select()
      .from(task)
      .where(and(eq(task.organizationId, input.organizationId), isNull(task.archivedAt)));
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const roots = planTaskReparents(rows, input.moves, input.preserveSelectedSubtrees);

    const results: { before: TaskRow; after: TaskRow; move: CommittedMove }[] = [];
    for (const move of roots) {
      const before = rowsById.get(move.taskId);
      /* v8 ignore next -- @preserve every root was validated against rowsById above */
      if (!before) throw new NotFoundError('Task not found');
      if (before.parentTaskId === move.parentTaskId) continue;
      const after = (
        await tx
          .update(task)
          .set({ parentTaskId: move.parentTaskId })
          .where(
            and(
              eq(task.id, move.taskId),
              eq(task.organizationId, input.organizationId),
              isNull(task.archivedAt),
            ),
          )
          .returning()
      )[0];
      /* v8 ignore next -- @preserve the active row was read in this transaction */
      if (!after) throw new NotFoundError('Task not found');
      results.push({
        before,
        after,
        move: {
          taskId: move.taskId,
          previousParentTaskId: before.parentTaskId,
          parentTaskId: move.parentTaskId,
        },
      });
    }
    return results;
  });

  for (const { before, after } of committed) {
    await recordTaskChanges({
      organizationId: input.organizationId,
      taskId: after.id,
      title: after.title,
      actorId: input.actorId,
      changes: await resolveTaskChangeLabels(input.organizationId, diffTaskFields(before, after)),
    });
    await enqueueSearchUpsert(input.organizationId, 'task', after.id);
  }

  return { moves: committed.map(({ move }) => move) };
}

/** A single hierarchy assignment adapted to the same atomic service used by batch interactions. */
export async function reparentTask(
  organizationId: string,
  actorId: string | null,
  move: RequestedMove,
): Promise<CommittedMove | null> {
  const result = await reparentTasks({
    organizationId,
    actorId,
    moves: [move],
    preserveSelectedSubtrees: false,
  });
  return result.moves[0] ?? null;
}
