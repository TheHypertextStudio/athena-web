import { BlueprintError } from '@docket/work/blueprints';
import type { ResolvedWorkInsert } from '../work-creation/writers';
import type { ProspectiveWorkReference } from '../work-creation/types';
import type { TemplateTransaction } from '../templates/persistence';
import type { PreparedBlueprintCreation } from '../work-template-blueprints/preflight';
import type { ForestMatch, PreparedPlacementForest } from './forest-types';
import { forestMatchKey, normalizedForestName } from './forest-matching';

/** Publish every authorized allocated descendant to the same reconciliation registry as manual roots. */
export async function registerPreparedTree(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  tree: PreparedBlueprintCreation,
): Promise<void> {
  for (const entry of tree.entries) {
    if (entry.kind === 'existing')
      throw new BlueprintError(
        'blueprint_invalid',
        'Retained work requires its authorized occurrence adapter.',
      );
    const insert = entry.kind === 'ordinary' ? entry.prepared.insert : entry.insert;
    await registerForestInsert(tx, forest, insert);
    if (entry.kind === 'ordinary') {
      for (const row of entry.prepared.milestoneRows ?? [])
        await registerForestInsert(tx, forest, { kind: 'milestone', values: row });
    }
  }
}

/** Register one prepared physical insert without inventing a persisted work row. */
export async function registerForestInsert(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  insert: ResolvedWorkInsert,
): Promise<ForestMatch> {
  const id = insert.values.id;
  if (!id)
    throw new BlueprintError(
      'blueprint_invalid',
      'A planned insertion requires its allocated identity.',
    );
  const reference = prospectiveInsert(insert, id);
  const title = insert.kind === 'task' ? insert.values.title : insert.values.name;
  const placement = insertPlacement(insert);
  const match: ForestMatch = {
    id,
    kind: insert.kind,
    title,
    placement,
    visibility: 'visibility' in reference ? reference.visibility : 'public',
    existing: false,
  };
  forest.prospective.set(id, reference);
  const normalized = await normalizedForestName(tx, forest, title);
  const key = forestMatchKey(insert.kind, normalized, placement);
  // The first new row of a name owns reconciliation, just as a live LIMIT1 match does.
  if (!forest.matches.has(key)) forest.matches.set(key, match);
  rememberCheckpointSort(forest, insert);
  return match;
}

function insertPlacement(insert: ResolvedWorkInsert) {
  return {
    projectId: 'projectId' in insert.values ? (insert.values.projectId ?? null) : null,
    programId: 'programId' in insert.values ? (insert.values.programId ?? null) : null,
    parentTaskId: 'parentTaskId' in insert.values ? (insert.values.parentTaskId ?? null) : null,
    milestoneId: 'milestoneId' in insert.values ? (insert.values.milestoneId ?? null) : null,
    initiativeId: null,
  };
}
function rememberCheckpointSort(forest: PreparedPlacementForest, insert: ResolvedWorkInsert): void {
  if (insert.kind === 'milestone') {
    const previous = forest.checkpointSorts.get(insert.values.projectId) ?? -1;
    forest.checkpointSorts.set(
      insert.values.projectId,
      Math.max(previous, insert.values.sort ?? 0),
    );
  }
}
function insertVisibility(insert: ResolvedWorkInsert): 'public' | 'private' {
  return 'visibility' in insert.values ? (insert.values.visibility ?? 'public') : 'public';
}

/** Convert only checked prepared values into minimal prospective hierarchy facts. */
export function prospectiveInsert(
  insert: ResolvedWorkInsert,
  id: string,
): ProspectiveWorkReference {
  const base = { id, orgId: insert.values.organizationId };
  const visibility = insertVisibility(insert);
  switch (insert.kind) {
    case 'initiative':
      return { ...base, kind: 'initiative' };
    case 'program':
      return { ...base, kind: 'program', visibility };
    case 'project':
      return {
        ...base,
        kind: 'project',
        visibility,
        programId: insert.values.programId ?? null,
      };
    case 'task':
      return {
        ...base,
        kind: 'task',
        visibility,
        projectId: insert.values.projectId ?? null,
        programId: insert.values.programId ?? null,
        parentTaskId: insert.values.parentTaskId ?? null,
      };
    case 'milestone':
      return { ...base, kind: 'milestone', projectId: insert.values.projectId };
  }
}
