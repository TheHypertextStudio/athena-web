/** Applying a forward object command in one serializable transaction. */
import type { Capability } from '@docket/authz';
import { project, task } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';

import type {
  ObjectCommandIn,
  ObjectCommandReceipt,
  ObjectCommandResult,
} from '../../contracts/object-command';
import { NotFoundError } from '../../error';
import { objectCommandChangeSetId, recordChangeSetInTx } from '../../mcp/change-set';
import { assertSharedWorkWritable } from '../../product-capability';
import type { IdempotencyClaim } from '../idempotency';
import { serializableTx } from '../serializable-tx';
import { assertResourceCapabilities } from './capabilities';
import { commitExecution } from './effects';
import { applyAssociationOperation } from './forward-associations';
import { applyDependencyOperation } from './forward-dependencies';
import { applyPropertyOperation, isPropertyOperation } from './forward-properties';
import { assertReceiptFitsReplayEnvelope } from './receipt-validator';
import { validateReferences } from './references';
import {
  createCommandEffects,
  type CommandExecution,
  type ForwardContext,
  type Tx,
  type TxScope,
} from './types';

type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;

/**
 * The capability a command demands of every object it touches. Handing work to someone else needs
 * `assign`, and moving a Project to or from the trash needs `manage`.
 */
function requiredCapability(command: ObjectCommandIn): Capability {
  if (command.objectKind === 'task') {
    if (command.operation.type !== 'replace_property') return 'contribute';
    return command.operation.property === 'assigneeId' ? 'assign' : 'contribute';
  }
  if (command.operation.type === 'replace_property') {
    return command.operation.property === 'leadId' ? 'assign' : 'contribute';
  }
  if (command.operation.type === 'trash' || command.operation.type === 'restore') return 'manage';
  return 'contribute';
}

/** Lock the selected rows for the life of the transaction. */
async function loadLockedRows(
  tx: Tx,
  orgId: string,
  command: ObjectCommandIn,
): Promise<readonly (TaskRow | ProjectRow)[]> {
  return command.objectKind === 'task'
    ? tx
        .select()
        .from(task)
        .where(and(eq(task.organizationId, orgId), inArray(task.id, command.objectIds)))
        .for('update')
    : tx
        .select()
        .from(project)
        .where(and(eq(project.organizationId, orgId), inArray(project.id, command.objectIds)))
        .for('update');
}

/** A missing object and a trashed one both read as not found, except to a restore. */
function assertSelectionVisible(
  command: ObjectCommandIn,
  rows: readonly (TaskRow | ProjectRow)[],
): void {
  const name = command.objectKind === 'task' ? 'Task' : 'Project';
  if (rows.length !== command.objectIds.length) throw new NotFoundError(`${name} not found`);
  if (command.operation.type !== 'restore' && rows.some((row) => row.archivedAt !== null)) {
    throw new NotFoundError(`${name} not found`);
  }
}

async function applyOperation(
  context: ForwardContext,
  rows: readonly (TaskRow | ProjectRow)[],
): Promise<void> {
  const operation = context.command.operation;
  if (isPropertyOperation(operation)) {
    await applyPropertyOperation(context, rows);
    return;
  }
  if (operation.type === 'add_association' || operation.type === 'remove_association') {
    await applyAssociationOperation(context, rows);
    return;
  }
  await applyDependencyOperation(context);
}

/** Seal the receipt, record the change set, and queue what the commit owes downstream. */
async function finishForward(
  context: ForwardContext,
  idempotencyClaim?: IdempotencyClaim,
): Promise<CommandExecution> {
  const { scope, command, entries, audit, effects } = context;
  const { database: tx, orgId, actorId } = scope;
  const receipt: ObjectCommandReceipt = {
    commandId: command.commandId,
    objectKind: command.objectKind,
    action: command.operation.type,
    entries,
  };
  assertReceiptFitsReplayEnvelope(receipt);
  await recordChangeSetInTx(tx, {
    id: objectCommandChangeSetId(orgId, actorId, command.commandId),
    orgId,
    actorId,
    origin: { tool: 'canvas', client: 'web', sessionId: command.commandId },
    summary: command.operation.type.replaceAll('_', ' '),
    changes: audit,
    recordEmpty: true,
  });
  const result: z.input<typeof ObjectCommandResult> = {
    appliedIds: command.objectIds,
    conflictingIds: [],
    deniedIds: [],
    receipt,
  };
  const execution = { effects, result };
  await commitExecution(scope, command, execution, idempotencyClaim);
  return execution;
}

/** Apply one forward object command, locking its selection for the whole transaction. */
export async function executeForward(
  orgId: string,
  actorId: string,
  command: ObjectCommandIn,
  idempotencyClaim?: IdempotencyClaim,
): Promise<CommandExecution> {
  return serializableTx(async (tx: Tx): Promise<CommandExecution> => {
    const scope: TxScope = { database: tx, orgId, actorId };
    const rows = await loadLockedRows(tx, orgId, command);
    assertSelectionVisible(command, rows);
    await assertResourceCapabilities(
      scope,
      command.objectKind,
      rows.map((row) => row.id),
      requiredCapability(command),
    );
    await validateReferences(scope, command, rows);
    await assertSharedWorkWritable(orgId, undefined, tx);
    const context: ForwardContext = {
      scope,
      command,
      entries: [],
      audit: [],
      effects: createCommandEffects(),
    };
    await applyOperation(context, rows);
    return finishForward(context, idempotencyClaim);
  });
}
