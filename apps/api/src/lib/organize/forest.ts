import { genId, milestone, project } from '@docket/db';
import { and, eq, max } from 'drizzle-orm';
import { BlueprintError } from '@docket/work/blueprints';
import { MilestoneCreate } from '@docket/work/milestone-contract';
import { NotFoundError } from '../../error';
import { commandForPlacedWork } from '../work-creation/ordinary-adapters';
import { createOrdinaryPreparationContext } from '../work-creation/ordinary-prospective';
import type { OrdinaryWorkCommand, ProspectiveWorkReference } from '../work-creation/types';
import { prepareBlueprintCreation } from '../work-template-blueprints/preflight';
import type { TemplateTransaction } from '../templates/persistence';
import { prepareMilestoneRows } from '../milestone-writes';
import { entityHref } from '../../mcp/entity-href';
import type { PlaceInput, Placed } from './place';
import type { ForestMatch, PreparedPlacementForest } from './forest-types';
import {
  authorizeForestMatch,
  forestMatchKey,
  normalizedForestName,
  readExistingForestMatch,
} from './forest-matching';
import { authorizeMatchedAttachments } from './forest-attachments';
import { registerForestInsert, registerPreparedTree } from './forest-registry';
export { applyPlacementForest } from './forest-apply';
export { createPlacementForest } from './forest-state';
import { requirePlacementForest } from './forest-state';
export type { AppliedPlacementForest, PreparedPlacementForest } from './forest-types';

/** Match or fully prepare one item without a physical insertion, link, attachment or receipt. */
export async function prepareForestItem(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  input: PlaceInput,
): Promise<Placed> {
  requirePlacementForest(tx, forest);
  if (input.orgId !== forest.caller.orgId || input.actorId !== forest.caller.actorId)
    throw new NotFoundError('Workspace not found');
  const normalized = await normalizedForestName(tx, forest, input.item.title);
  const key = forestMatchKey(input.item.kind, normalized, input.at);
  const matched = forest.matches.get(key) ?? (await readExistingForestMatch(tx, input));
  let placed: Placed;
  if (matched) {
    await authorizeForestMatch(tx, forest, input, matched);
    await authorizeMatchedAttachments(tx, forest, input, matched);
    forest.operations.push({ kind: 'matched', input, match: matched });
    placed = placementIdentity(input, matched, false);
  } else if (input.item.kind === 'milestone') {
    placed = await prepareCheckpoint(tx, forest, input);
  } else {
    placed = await prepareTree(tx, forest, input);
  }
  forest.placed.push(placed);
  forest.byRef.set(input.item.ref, placed);
  return placed;
}

async function prepareTree(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  input: PlaceInput,
): Promise<Placed> {
  const resolved = await commandForPlacedWork(tx, input);
  const command = {
    ...resolved,
    invocation: { ...resolved.invocation, prospectiveWorkId: genId() },
  };
  const own = prospectiveRoot(command, input);
  const context = await createOrdinaryPreparationContext(
    tx,
    command,
    [...forest.prospective.values(), own],
    'public',
  );
  const tree = await prepareBlueprintCreation(tx, command, context, { deferTemplateLocks: true });
  forest.rowCount += tree.rowCount;
  requireForestBudget(forest);
  forest.trees.push(tree);
  forest.operations.push({ kind: 'tree', input, tree });
  await registerPreparedTree(tx, forest, tree);
  const root = tree.entries[0];
  if (root?.kind !== 'ordinary') throw new Error('Prepared ordinary forest root missing');
  const values = root.prepared.insert.values;
  const match: ForestMatch = {
    id: root.allocated.id,
    kind: command.kind,
    title: input.item.title,
    placement: input.at,
    existing: false,
    visibility: 'visibility' in values ? (values.visibility ?? 'public') : 'public',
  };
  return {
    ...placementIdentity(input, match, true),
    description: values.description ?? null,
    workTypeId: tree.graph.root.workTypeId,
    workTypeVersionId: tree.graph.root.versionId,
    ...(input.templateId ? { templateId: input.templateId } : {}),
  };
}

function prospectiveRoot(
  command: OrdinaryWorkCommand,
  input: PlaceInput,
): ProspectiveWorkReference {
  const id = command.invocation.prospectiveWorkId;
  if (!id) throw new Error('Forest root identity missing');
  const base = { id, orgId: input.orgId };
  const visibility = input.item.visibility ?? 'public';
  switch (command.kind) {
    case 'initiative':
      return { ...base, kind: 'initiative' };
    case 'program':
      return { ...base, kind: 'program', visibility };
    case 'project':
      return { ...base, kind: 'project', visibility, programId: input.at.programId };
    case 'task':
      return {
        ...base,
        kind: 'task',
        visibility,
        projectId: input.at.projectId,
        programId: input.at.programId,
        parentTaskId: input.at.parentTaskId,
      };
  }
}

async function prepareCheckpoint(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  input: PlaceInput,
): Promise<Placed> {
  const projectId = input.at.projectId;
  if (!projectId)
    throw new BlueprintError('blueprint_invalid', 'A checkpoint requires its selected Project.');
  await authorizeCheckpointProject(tx, forest, input, projectId);
  const [existing] = await tx
    .select({ highest: max(milestone.sort) })
    .from(milestone)
    .where(and(eq(milestone.organizationId, input.orgId), eq(milestone.projectId, projectId)));
  const sort = Math.max(existing?.highest ?? -1, forest.checkpointSorts.get(projectId) ?? -1) + 1;
  const fields = MilestoneCreate.parse({
    name: input.item.title,
    description: input.item.description,
    targetDate: input.item.targetDate,
  });
  const [row] = prepareMilestoneRows(
    { orgId: input.orgId, projectId, actorId: input.actorId },
    [fields],
    sort,
  );
  if (!row) throw new Error('Prepared checkpoint missing');
  forest.rowCount++;
  requireForestBudget(forest);
  forest.operations.push({ kind: 'checkpoint', input, row });
  const match = await registerForestInsert(tx, forest, { kind: 'milestone', values: row });
  return placementIdentity(input, match, true);
}
async function authorizeCheckpointProject(
  tx: TemplateTransaction,
  forest: PreparedPlacementForest,
  input: PlaceInput,
  projectId: string,
): Promise<void> {
  if (forest.prospective.get(projectId)?.kind === 'project') return;
  const [row] = await tx
    .select({ id: project.id, name: project.name, visibility: project.visibility })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, input.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError('Project not found');
  await authorizeForestMatch(
    tx,
    forest,
    input,
    {
      id: row.id,
      kind: 'project',
      title: row.name,
      visibility: row.visibility,
      existing: true,
      placement: input.at,
    },
    'contribute',
  );
}
function requireForestBudget(forest: PreparedPlacementForest): void {
  if (forest.rowCount > 500)
    throw new BlueprintError(
      'blueprint_limit',
      'Create at most 500 work rows across the complete forest.',
    );
}
function placementIdentity(input: PlaceInput, match: ForestMatch, created: boolean): Placed {
  const projectId = match.placement.projectId;
  const href =
    match.kind === 'milestone'
      ? entityHref(input.orgId, 'project', projectId ?? '')
      : entityHref(input.orgId, match.kind, match.id);
  return {
    ref: input.item.ref,
    kind: match.kind,
    id: match.id,
    title: input.item.title,
    parent: input.item.parent,
    href,
    created,
    ...(projectId ? { projectId } : {}),
  };
}
