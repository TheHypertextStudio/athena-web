/** Consequences a committed object command hands to the effect queue and the audit log. */
import type { task } from '@docket/db';

import type { ObjectCommandRequest as ObjectCommandRequestValue } from '../../contracts/object-command';
import { deferAfterResponse } from '../after-response';
import { completeIdempotencyInTransaction, type IdempotencyClaim } from '../idempotency';
import type { ObjectCommandEffect } from '../object-command-effects';
import {
  enqueueObjectCommandEffectJob,
  processObjectCommandEffectJobs,
} from '../object-command-effects';
import { diffTaskFields, resolveTaskChangeLabelGroups, writeTaskChangeGroups } from '../task-audit';
import type { CommandEffects, CommandExecution, TaskFieldChange, TxScope } from './types';

type TaskRow = typeof task.$inferSelect;

/** Which objects a command archived, read in the direction the request replays. */
function archivedByObject(
  request: ObjectCommandRequestValue,
  execution: CommandExecution,
): ReadonlyMap<string, boolean> {
  const archivedById = new Map<string, boolean>();
  for (const entry of execution.result.receipt.entries) {
    if (entry.kind !== 'object' || entry.property !== 'archivedAt') continue;
    const target =
      'direction' in request && request.direction === 'undo' ? entry.before : entry.after;
    archivedById.set(entry.objectId, target !== null);
  }
  return archivedById;
}

/** Translate one execution's accumulated effects into queued effect-job entries. */
export function objectCommandEffects(
  request: ObjectCommandRequestValue,
  execution: CommandExecution,
): ObjectCommandEffect[] {
  const { result, effects } = execution;
  const changedIds = new Set(result.receipt.entries.map((entry) => entry.objectId));
  const archivedById = archivedByObject(request, execution);
  return [
    ...effects.taskStateMutations.map((mutation): ObjectCommandEffect => ({
      kind: 'task_state',
      mutation,
    })),
    ...effects.taskFieldChanges.map((change): ObjectCommandEffect => ({
      kind: 'task_fields',
      change,
    })),
    ...effects.projectStatusRows.map((row): ObjectCommandEffect => ({
      kind: 'project_status',
      project: { id: row.id, name: row.name, status: row.status },
    })),
    ...[...changedIds].map((entityId): ObjectCommandEffect => ({
      kind: 'entity_write',
      sourceTable: result.receipt.objectKind,
      entityId,
      operation: archivedById.get(entityId) === true ? 'delete' : 'upsert',
    })),
  ];
}

/** Queue the command's consequences and close its idempotency claim in the same transaction. */
export async function commitExecution(
  scope: TxScope,
  request: ObjectCommandRequestValue,
  execution: CommandExecution,
  idempotencyClaim?: IdempotencyClaim,
): Promise<void> {
  const { database: tx, orgId, actorId } = scope;
  await enqueueObjectCommandEffectJob(tx, {
    version: 1,
    organizationId: orgId,
    actorId,
    commandId: request.commandId,
    occurredAt: new Date().toISOString(),
    effects: objectCommandEffects(request, execution),
  });
  if (idempotencyClaim) {
    await completeIdempotencyInTransaction(tx, idempotencyClaim, {
      organizationId: orgId,
      responseStatus: 200,
      responseBody: execution.result,
    });
  }
}

/** Drain a slice of the effect queue once the response is on the wire. */
export function scheduleCommandEffects(): void {
  deferAfterResponse('object-command-consequences', async () => {
    await processObjectCommandEffectJobs({ limit: 10 });
  });
}

/** Record the field-level audit groups a command produced and keep them for the effect queue. */
export async function recordTaskFieldChanges(
  scope: TxScope,
  effects: CommandEffects,
  changed: readonly { readonly before: TaskRow; readonly after: TaskRow }[],
): Promise<void> {
  const { database: tx, orgId, actorId } = scope;
  const resolvedChanges = await resolveTaskChangeLabelGroups(
    orgId,
    changed.map(({ before, after }) => diffTaskFields(before, after)),
    tx,
  );
  const consequences = changed.map(({ before, after }, index): TaskFieldChange => ({
    organizationId: orgId,
    taskId: after.id,
    title: after.title,
    actorId,
    changes: resolvedChanges[index] ?? [],
    assignmentChanged: before.assigneeId !== after.assigneeId && after.assigneeId !== null,
  }));
  await writeTaskChangeGroups(tx, consequences);
  effects.taskFieldChanges.push(...consequences);
}
