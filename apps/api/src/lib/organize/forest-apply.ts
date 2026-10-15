import { task } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { BlueprintError } from '@docket/work/blueprints';
import { NotFoundError } from '../../error';
import { trackedFields, type RecordedChange } from '../../mcp/change-set';
import { appendReservedMilestone } from '../milestone-writes';
import type { TemplateTransaction } from '../templates/persistence';
import { applyPreparedBlueprintCreation } from '../work-template-blueprints/apply';
import { lockBlueprintClosures } from '../work-template-blueprints/resolve';
import { validatePreparedBlueprintForest } from '../work-template-blueprints/forest';
import type { OrdinaryWorkMutation } from '../work-creation/types';
import { validatePlacementForestDependencies, type ForestDependency } from './forest-dependencies';
import { requirePlacementForest } from './forest-state';
import { attachToMilestone } from './place-milestone';
import { linkToInitiative } from './place';
import type {
  AppliedPlacementForest,
  ForestOperation,
  PreparedPlacementForest,
} from './forest-types';

/** Apply a completely preflighted reconciliation forest without settlement, receipt or pooled effects. */
export async function applyPlacementForest(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  dependencies: readonly ForestDependency[] = [],
): Promise<AppliedPlacementForest> {
  requirePlacementForest(tx, forest);
  if (forest.rowCount > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Create at most 500 work rows across the complete forest.',
    );
  validateTreeDependencies(forest);
  await validatePlacementForestDependencies(tx, forest, dependencies);
  await lockBlueprintClosures(
    tx,
    forest.trees.map((tree) => tree.graph),
  );
  const mutations: OrdinaryWorkMutation[] = [];
  for (const operation of forest.operations) {
    if (operation.kind === 'matched') continue;
    mutations.push(await applyInsertion(tx, operation));
  }
  const changes = mutations.flatMap((mutation) => mutation.changes);
  const effects = mutations.flatMap((mutation) => mutation.effects);
  for (const operation of forest.operations) {
    if (operation.kind !== 'matched') continue;
    const attached = await applyMatched(tx, operation);
    changes.push(...attached);
    effects.push(
      ...attached.flatMap((change) =>
        'id' in change
          ? [
              {
                kind: 'refresh-subject' as const,
                dedupeKey: `search:${change.kind}:${change.id}`,
                orgId: forest.caller.orgId,
                subjectKind: change.kind,
                subjectId: change.id,
              },
            ]
          : [],
      ),
    );
  }
  const root = mutations[0]?.root;
  // A fully matched call has no new work but may still create links; its caller owns that receipt.
  return {
    root,
    placed: forest.placed,
    created: mutations.flatMap((mutation) => mutation.created),
    changes,
    effects,
    parentTaskIds: mutations.flatMap((mutation) => mutation.parentTaskIds),
  };
}

function validateTreeDependencies(forest: PreparedPlacementForest): void {
  if (!forest.trees.length) return;
  const first = forest.trees[0];
  if (!first) return;
  validatePreparedBlueprintForest(
    {
      roots: forest.trees.map((tree, index) => ({ key: String(index), command: tree.command })),
      edges: [],
      invocation: first.command.invocation,
    },
    forest.trees,
  );
}
async function applyInsertion(
  tx: TemplateTransaction,
  operation: Exclude<ForestOperation, { kind: 'matched' }>,
): Promise<OrdinaryWorkMutation> {
  if (operation.kind === 'tree') return applyPreparedBlueprintCreation(tx, operation.tree);
  const row = await appendReservedMilestone(tx, operation.row);
  const work = { kind: 'milestone' as const, id: row.id, row };
  return {
    root: work,
    created: [work],
    changes: [
      { kind: 'milestone', id: row.id, op: 'create', after: trackedFields('milestone', row) },
    ],
    parentTaskIds: [],
    effects: [{ kind: 'search', dedupeKey: `search:milestone:${row.id}`, work }],
  };
}
async function applyMatched(
  tx: TemplateTransaction,
  operation: Extract<ForestOperation, { kind: 'matched' }>,
): Promise<RecordedChange[]> {
  const { input, match } = operation;
  if (match.kind === 'project' || match.kind === 'program') {
    const { link } = await linkToInitiative(
      tx,
      match.kind,
      input.orgId,
      input.at.initiativeId,
      match.id,
    );
    return link ? [link] : [];
  }
  if (match.kind !== 'task' || !input.at.milestoneId) return [];
  const [row] = await tx
    .select()
    .from(task)
    .where(and(eq(task.id, match.id), eq(task.organizationId, input.orgId)))
    .for('update')
    .limit(1);
  if (!row) throw new NotFoundError('Task not found');
  const change = await attachToMilestone(tx, row, input.at.milestoneId);
  return change ? [change] : [];
}
