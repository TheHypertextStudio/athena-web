/** Undoing or redoing a recorded object command, object by object, in one transaction. */
import { project, task } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import type {
  ObjectCommandReceipt,
  ObjectCommandRelationReceiptEntry,
  ObjectCommandRequest as ObjectCommandRequestValue,
  ObjectCommandResult,
} from '../../contracts/object-command';
import { assertSharedWorkWritable } from '../../product-capability';
import type { IdempotencyClaim } from '../idempotency';
import { serializableTx } from '../serializable-tx';
import { closeCompletingUserTaskTimersBatch } from '../task-state';
import { assertReceiptMatchesDurableChange } from './durable-change';
import { commitExecution, recordTaskFieldChanges } from './effects';
import { updateReplayObjects, type ObjectPatch } from './object-writes';
import { ownedValidation, validateReplayReceipt } from './receipt-validator';
import { replayCapabilityByTarget, replayRequirements } from './replay-access';
import { preflightReplay } from './replay-preflight';
import { applyReplayRelationEntries, loadReplayRelationFacts } from './replay-relations';
import {
  createCommandEffects,
  type CommandEffects,
  type CommandEntry,
  type CommandExecution,
  type Tx,
  type TxScope,
} from './types';

type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type ObjectRow = Record<string, unknown>;
type ReplayRequest = Extract<ObjectCommandRequestValue, { direction: string }>;

/** One update that reached the database, paired with the locked row it replaced. */
interface AppliedUpdate {
  readonly id: string;
  readonly before: ObjectRow;
  readonly after: TaskRow | ProjectRow;
}

function groupEntriesByObject(receipt: ObjectCommandReceipt): ReadonlyMap<string, CommandEntry[]> {
  const entriesByObject = new Map<string, CommandEntry[]>();
  for (const entry of receipt.entries) {
    entriesByObject.set(entry.objectId, [...(entriesByObject.get(entry.objectId) ?? []), entry]);
  }
  return entriesByObject;
}

/** Every object the receipt names, including the blocked end of a dependency edge. */
function receiptObjectIds(receipt: ObjectCommandReceipt): readonly string[] {
  const ids = new Set(receipt.entries.map((entry) => entry.objectId));
  for (const entry of receipt.entries) {
    if (entry.kind === 'relation' && entry.relation === 'dependency') ids.add(entry.relatedId);
  }
  return [...ids];
}

async function lockReceiptObjects(
  tx: Tx,
  orgId: string,
  receipt: ObjectCommandReceipt,
): Promise<ReadonlyMap<string, ObjectRow>> {
  const table = receipt.objectKind === 'task' ? task : project;
  const rows = await tx
    .select()
    .from(table)
    .where(and(eq(table.organizationId, orgId), inArray(table.id, receiptObjectIds(receipt))))
    .for('update');
  return new Map(rows.map((row) => [row.id, row as ObjectRow]));
}

/** The columns one group of entries writes, read in the direction being replayed. */
function replayPatch(
  entries: readonly CommandEntry[],
  direction: 'undo' | 'redo',
  invalidMessage: string,
): Record<string, unknown> {
  return Object.fromEntries(
    entries.map((entry) => {
      if (entry.kind !== 'object') throw ownedValidation(invalidMessage);
      return [entry.property, direction === 'undo' ? entry.before : entry.after];
    }),
  );
}

function tupleProperties(objectKind: 'task' | 'project'): ReadonlySet<string> {
  return objectKind === 'task'
    ? new Set(['state', 'statusId', 'completedAt', 'canceledAt'])
    : new Set(['status', 'statusId']);
}

/** A status tuple moves as one write, so it is planned and applied ahead of the plain columns. */
function collectTupleUpdates(
  receipt: ObjectCommandReceipt,
  direction: 'undo' | 'redo',
  entriesByObject: ReadonlyMap<string, CommandEntry[]>,
  skip: (objectId: string) => boolean,
): { readonly updates: ObjectPatch[]; readonly tupleEntries: ReadonlySet<CommandEntry> } {
  const properties = tupleProperties(receipt.objectKind);
  const tupleEntries = new Set<CommandEntry>();
  const updates: ObjectPatch[] = [];
  for (const [objectId, entries] of entriesByObject) {
    if (skip(objectId)) continue;
    const tuple = entries.filter(
      (entry) => entry.kind === 'object' && properties.has(entry.property),
    );
    if (tuple.length === 0) continue;
    updates.push({ id: objectId, patch: replayPatch(tuple, direction, 'Invalid status tuple') });
    for (const entry of tuple) tupleEntries.add(entry);
  }
  return { updates, tupleEntries };
}

function collectObjectUpdates(
  direction: 'undo' | 'redo',
  entriesByObject: ReadonlyMap<string, CommandEntry[]>,
  tupleEntries: ReadonlySet<CommandEntry>,
  skip: (objectId: string) => boolean,
): ObjectPatch[] {
  const updates: ObjectPatch[] = [];
  for (const [objectId, entries] of entriesByObject) {
    if (skip(objectId)) continue;
    const plain = entries.filter((entry) => entry.kind === 'object' && !tupleEntries.has(entry));
    if (plain.length === 0) continue;
    updates.push({
      id: objectId,
      patch: replayPatch(plain, direction, 'Invalid object receipt entry'),
    });
  }
  return updates;
}

/** Write one batch of patches; an object whose row no longer answers lost a race. */
async function runReplayUpdates(
  scope: TxScope,
  objectKind: 'task' | 'project',
  updates: readonly ObjectPatch[],
  lockedById: ReadonlyMap<string, ObjectRow>,
  conflicting: Set<string>,
): Promise<AppliedUpdate[]> {
  const rows = await updateReplayObjects(scope.database, scope.orgId, objectKind, updates);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const applied: AppliedUpdate[] = [];
  for (const update of updates) {
    const after = rowsById.get(update.id);
    const before = lockedById.get(update.id);
    if (!after || !before) {
      conflicting.add(update.id);
      continue;
    }
    applied.push({ id: update.id, before, after });
  }
  return applied;
}

/** Everything the write phase needs once the preflight has marked the objects it cannot touch. */
interface ReplayWritePhase {
  readonly scope: TxScope;
  readonly request: ReplayRequest;
  readonly entriesByObject: ReadonlyMap<string, CommandEntry[]>;
  readonly lockedById: ReadonlyMap<string, ObjectRow>;
  readonly conflicting: Set<string>;
  readonly denied: Set<string>;
}

function skipped(phase: ReplayWritePhase): (objectId: string) => boolean {
  return (objectId) => phase.conflicting.has(objectId) || phase.denied.has(objectId);
}

/** Move the status tuples, then close the timers the newly completed Tasks were running. */
async function applyTupleUpdates(
  phase: ReplayWritePhase,
  effects: CommandEffects,
  tupleEntries: ReadonlySet<CommandEntry>,
  updates: readonly ObjectPatch[],
): Promise<CommandEntry[]> {
  const { scope, request, entriesByObject, lockedById, conflicting } = phase;
  const objectKind = request.receipt.objectKind;
  const successful: CommandEntry[] = [];
  for (const applied of await runReplayUpdates(
    scope,
    objectKind,
    updates,
    lockedById,
    conflicting,
  )) {
    if (objectKind === 'task') {
      effects.taskStateMutations.push({
        before: applied.before as TaskRow,
        after: applied.after as TaskRow,
      });
    } else {
      effects.projectStatusRows.push(applied.after as ProjectRow);
    }
    successful.push(
      ...(entriesByObject.get(applied.id) ?? []).filter((entry) => tupleEntries.has(entry)),
    );
  }
  effects.timerStops.push(
    ...(await closeCompletingUserTaskTimersBatch(
      scope.database,
      scope.actorId,
      effects.taskStateMutations,
    )),
  );
  return successful;
}

/** Move the remaining columns, collecting the Task rows whose field changes need an audit group. */
async function applyPlainUpdates(
  phase: ReplayWritePhase,
  tupleEntries: ReadonlySet<CommandEntry>,
  changedTasks: { before: TaskRow; after: TaskRow }[],
): Promise<CommandEntry[]> {
  const { scope, request, entriesByObject, lockedById, conflicting } = phase;
  const objectKind = request.receipt.objectKind;
  const updates = collectObjectUpdates(
    request.direction,
    entriesByObject,
    tupleEntries,
    skipped(phase),
  );
  const successful: CommandEntry[] = [];
  for (const applied of await runReplayUpdates(
    scope,
    objectKind,
    updates,
    lockedById,
    conflicting,
  )) {
    if (objectKind === 'task') {
      changedTasks.push({ before: applied.before as TaskRow, after: applied.after as TaskRow });
    }
    successful.push(
      ...(entriesByObject.get(applied.id) ?? []).filter(
        (entry) => entry.kind === 'object' && !tupleEntries.has(entry),
      ),
    );
  }
  return successful;
}

async function applyReplayWrites(phase: ReplayWritePhase): Promise<CommandExecution> {
  const { scope, request, conflicting, denied } = phase;
  const { receipt, direction } = request;
  const effects = createCommandEffects();
  const changedTasks: { before: TaskRow; after: TaskRow }[] = [];
  const tuples = collectTupleUpdates(receipt, direction, phase.entriesByObject, skipped(phase));
  const successful = await applyTupleUpdates(phase, effects, tuples.tupleEntries, tuples.updates);
  successful.push(...(await applyPlainUpdates(phase, tuples.tupleEntries, changedTasks)));
  successful.push(
    ...(await applyReplayRelationEntries(
      scope,
      receipt.objectKind,
      direction,
      receipt.entries.filter(
        (entry): entry is ObjectCommandRelationReceiptEntry =>
          entry.kind === 'relation' && !skipped(phase)(entry.objectId),
      ),
      conflicting,
    )),
  );
  await recordTaskFieldChanges(scope, effects, [...effects.taskStateMutations, ...changedTasks]);
  const result: z.input<typeof ObjectCommandResult> = {
    appliedIds: [...new Set(successful.map((entry) => entry.objectId))],
    conflictingIds: [...conflicting],
    deniedIds: [...denied],
    receipt: { ...receipt, entries: successful },
  };
  return { effects, result };
}

/** Undo or redo one recorded command, skipping the objects a collaborator has since moved. */
export async function executeReplay(
  orgId: string,
  actorId: string,
  request: ReplayRequest,
  idempotencyClaim?: IdempotencyClaim,
): Promise<CommandExecution> {
  const { receipt, direction } = request;
  validateReplayReceipt(receipt);
  const requiredByTarget = replayRequirements(receipt, direction);
  return serializableTx(async (tx: Tx): Promise<CommandExecution> => {
    const scope: TxScope = { database: tx, orgId, actorId };
    await assertReceiptMatchesDurableChange(scope, receipt);
    const entriesByObject = groupEntriesByObject(receipt);
    const lockedById = await lockReceiptObjects(tx, orgId, receipt);
    const capabilityByTarget = await replayCapabilityByTarget(scope, requiredByTarget);
    if ([...capabilityByTarget.values()].some((decision) => decision.allow)) {
      await assertSharedWorkWritable(orgId, undefined, tx);
    }
    const relationFacts = await loadReplayRelationFacts(
      tx,
      orgId,
      receipt.objectKind,
      receipt.entries.filter(
        (entry): entry is ObjectCommandRelationReceiptEntry => entry.kind === 'relation',
      ),
    );
    const conflicting = new Set<string>();
    const denied = new Set<string>();
    await preflightReplay(
      {
        scope,
        receipt,
        direction,
        lockedById,
        capabilityByTarget,
        relationFacts,
        conflicting,
        denied,
      },
      entriesByObject,
    );
    const execution = await applyReplayWrites({
      scope,
      request,
      entriesByObject,
      lockedById,
      conflicting,
      denied,
    });
    await commitExecution(scope, request, execution, idempotencyClaim);
    return execution;
  });
}
