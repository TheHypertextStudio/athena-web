import { taskDependency } from '@docket/db';
import { recordChangeSetInTransaction, type RecordedChange } from '../../mcp/change-set';
import { taskUpdateChange } from '../provenance/task-change-sets';
import { serializableTx } from '../serializable-tx';
import { applySubtaskCompletionPolicyForParents } from '../task-state';
import type { TemplateTransaction } from '../templates/persistence';
import { validateCreationBatch } from './context';
import { deferWorkCreationEffects } from './effects';
import { prepareBlueprintCreation } from '../work-template-blueprints/preflight';
import {
  validatePreparedBlueprintForest,
  type ResolvedForestDependency,
} from '../work-template-blueprints/forest';
import { applyPreparedBlueprintCreation } from '../work-template-blueprints/apply';
import { rememberBlueprintReceipt } from '../work-template-blueprints/receipt';
import { lockBlueprintClosures } from '../work-template-blueprints/resolve';
import { prepareCreationForest, validateExistingCreationDependencies } from './forest-preflight';
import { acceptedForestSelections } from './accepted-forest';
import type {
  OrdinaryWorkCommand,
  OrdinaryWorkMutation,
  WorkCreationBatchCommand,
  WorkCreationBatchResult,
  WorkCreationResult,
} from './types';

export { insertPreparedOrdinaryWork } from './ordinary-insert';
export { prepareOrdinaryWork } from './ordinary-prepare';
export type { WorkCreationCommand, WorkCreationResult, OrdinaryWorkMutation } from './types';

/** Settle complete child sets and write one existing change set inside the caller's transaction. */
export async function completeWorkCreation(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  mutation: OrdinaryWorkMutation,
): Promise<WorkCreationResult> {
  const settled = await settleCreationParents(tx, command.caller.orgId, mutation.parentTaskIds);
  const changes = [...mutation.changes, ...settled.changes];
  const title = mutation.root.kind === 'task' ? mutation.root.row.title : mutation.root.row.name;
  const changeSetId =
    command.caller.actorId === null
      ? null
      : await recordChangeSetInTransaction(tx, {
          orgId: command.caller.orgId,
          actorId: command.caller.actorId,
          origin: command.invocation.origin,
          summary:
            mutation.created.length === 1
              ? `Created "${title}"`
              : `Created ${mutation.created.length} items`,
          changes,
        });
  await rememberBlueprintReceipt(tx, mutation.created, changeSetId);
  return {
    ...mutation,
    changes,
    changeSetId,
    resolvedManifest:
      mutation.root.kind === 'milestone'
        ? []
        : (mutation.root.row.blueprintState?.resolvedManifest ?? []),
    effects: [...mutation.effects, ...settled.effects],
  };
}

/** Shared unrecorded mutation core for an enclosing MCP, plan or occurrence receipt. */
export async function createWorkMutationInTransaction(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
): Promise<OrdinaryWorkMutation> {
  return applyPreparedBlueprintCreation(tx, await prepareBlueprintCreation(tx, command));
}

/** Create one root in an existing transaction; effects remain deferred until its owner commits. */
export async function createWorkInTransaction(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
): Promise<WorkCreationResult> {
  return completeWorkCreation(tx, command, await createWorkMutationInTransaction(tx, command));
}

/** Own one SERIALIZABLE creation transaction and schedule effects only after successful commit. */
export async function createWork(command: OrdinaryWorkCommand): Promise<WorkCreationResult> {
  const result = await serializableTx((tx) => createWorkInTransaction(tx, command));
  deferWorkCreationEffects(result.effects);
  return result;
}

/** Create a trusted forest with one aggregate budget, authorization pass and undo receipt. */
export async function createWorkBatchInTransaction(
  tx: TemplateTransaction,
  command: WorkCreationBatchCommand,
): Promise<WorkCreationBatchResult> {
  validateCreationBatch(command);
  const prepared = await prepareCreationForest(tx, command);
  const edges = validatePreparedBlueprintForest(command, prepared);
  await validateExistingCreationDependencies(tx, prepared, edges);
  await lockBlueprintClosures(
    tx,
    prepared.map((root) => root.graph),
  );
  const mutations: OrdinaryWorkMutation[] = [];
  for (const input of prepared) mutations.push(await applyPreparedBlueprintCreation(tx, input));
  const rootsByKey = new Map(
    command.roots.flatMap((root, index) => {
      const mutation = mutations[index];
      return mutation ? [[root.key, mutation.root] as const] : [];
    }),
  );
  const dependencyChanges = await insertBatchDependencies(
    tx,
    command.roots[0]?.command.caller.orgId ?? '',
    edges,
  );
  const first = mutations[0];
  const firstCommand = command.roots[0]?.command;
  if (!first || !firstCommand) throw new Error('Validated creation forest has no root');
  const aggregate = {
    ...first,
    created: mutations.flatMap((entry) => entry.created),
    changes: [...mutations.flatMap((entry) => entry.changes), ...dependencyChanges],
    effects: mutations.flatMap((entry) => entry.effects),
    parentTaskIds: mutations.flatMap((entry) => entry.parentTaskIds),
  };
  const result = await completeWorkCreation(
    tx,
    { ...firstCommand, invocation: command.invocation },
    aggregate,
  );
  return {
    rootsByKey,
    ...acceptedForestSelections(command, prepared),
    created: result.created,
    changeSetId: result.changeSetId,
    effects: result.effects,
  };
}

async function insertBatchDependencies(
  tx: TemplateTransaction,
  orgId: string,
  edges: readonly ResolvedForestDependency[],
): Promise<RecordedChange[]> {
  if (!edges.length) return [];
  const inserted = await tx
    .insert(taskDependency)
    .values(
      edges.map((edge) => ({
        organizationId: orgId,
        blockingTaskId: edge.blockerId,
        blockedTaskId: edge.blockedId,
      })),
    )
    .onConflictDoNothing()
    .returning({
      blockerId: taskDependency.blockingTaskId,
      blockedId: taskDependency.blockedTaskId,
    });
  return inserted.map((edge) => ({
    kind: 'blocks',
    from: edge.blockerId,
    to: edge.blockedId,
    linked: true,
  }));
}

/** Settle a complete generated/placed child set once, before its enclosing action receipt. */
export async function settleCreationParents(
  tx: TemplateTransaction,
  orgId: string,
  parentTaskIds: readonly (string | null)[],
): Promise<Pick<OrdinaryWorkMutation, 'changes' | 'effects'>> {
  const cascades = await applySubtaskCompletionPolicyForParents(tx, orgId, [...parentTaskIds]);
  return {
    changes: cascades.flatMap((cascade) => {
      const change = taskUpdateChange(cascade);
      return change ? [change] : [];
    }),
    effects: cascades.map((mutation) => ({
      kind: 'task-state',
      dedupeKey: `state:${mutation.after.id}`,
      mutation,
    })),
  };
}
