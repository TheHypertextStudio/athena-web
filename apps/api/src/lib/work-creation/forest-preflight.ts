import { CycleError } from '../../error';
import { closesWorkspaceDependencyCycle } from '../work-dependency-forest';
import { requireWorkAccess } from '../work-template-selection';
import type { ResolvedForestDependency } from '../work-template-blueprints/forest';
import { genId } from '@docket/db';
import type { TemplateTransaction } from '../templates/persistence';
import { resolveRetainedRootPlacement } from '../recurrence/work-template-placement';
import { resolveScheduleRootPlacement } from '../recurrence/schedule-root-placement';
import {
  prepareBlueprintCreation,
  type PreparedBlueprintCreation,
} from '../work-template-blueprints/preflight';
import { retainedRootBinding } from './retained-authority';
import { createOrdinaryPreparationContext } from './ordinary-prospective';
import type {
  OrdinaryWorkCommand,
  ProspectiveWorkReference,
  WorkCreationBatchCommand,
} from './types';
import type { ResolvedWorkInsert } from './writers';
import { compileScheduleTiming } from '../recurrence/schedule-timing';
import { planScheduleBlueprint } from '../recurrence/schedule-compiler';
import { preparedBlueprintRoot } from '../work-template-blueprints/root';

function rootVisibility(command: OrdinaryWorkCommand): 'public' | 'private' {
  return command.invocation.placement?.visibility ?? 'public';
}

function rootReference(command: OrdinaryWorkCommand, id: string): ProspectiveWorkReference {
  const base = { id, orgId: command.caller.orgId };
  const visibility = rootVisibility(command);
  switch (command.kind) {
    case 'initiative':
      return { ...base, kind: 'initiative' };
    case 'program':
      return { ...base, kind: 'program', visibility: command.body.visibility ?? visibility };
    case 'project':
      return { ...base, kind: 'project', visibility, programId: command.body.programId ?? null };
    case 'task':
      return {
        ...base,
        kind: 'task',
        visibility,
        projectId: command.body.projectId ?? null,
        programId: command.invocation.placement?.programId ?? null,
        parentTaskId: command.body.parentTaskId ?? null,
      };
  }
}

function withPlacement(
  command: OrdinaryWorkCommand,
  placement: Awaited<ReturnType<typeof resolveRetainedRootPlacement>>,
): OrdinaryWorkCommand {
  if (command.kind === 'task') return { ...command, body: { ...command.body, ...placement } };
  return command;
}

/** Minimal prospective placement projected from a fully authorized insert, without fabricating a stored row. */
export function prospectiveCreationInsert(
  insert: ResolvedWorkInsert,
  id: string,
): ProspectiveWorkReference {
  const base = { id, orgId: insert.values.organizationId };
  const visibility =
    'visibility' in insert.values ? (insert.values.visibility ?? 'public') : 'public';
  switch (insert.kind) {
    case 'initiative':
      return { ...base, kind: 'initiative' };
    case 'program':
      return { ...base, kind: 'program', visibility };
    case 'project':
      return { ...base, kind: 'project', visibility, programId: insert.values.programId ?? null };
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

function rememberPreparedReferences(
  prepared: PreparedBlueprintCreation,
  references: Map<string, ProspectiveWorkReference>,
): void {
  for (const entry of prepared.entries) {
    if (entry.kind === 'existing') continue;
    const insert = entry.kind === 'ordinary' ? entry.prepared.insert : entry.insert;
    references.set(entry.allocated.id, prospectiveCreationInsert(insert, entry.allocated.id));
    if (entry.kind !== 'ordinary') continue;
    for (const row of entry.prepared.milestoneRows ?? []) {
      if (!row.id) continue;
      references.set(row.id, prospectiveCreationInsert({ kind: 'milestone', values: row }, row.id));
    }
  }
}

/** Preflight parent-ordered forest roots against only earlier authorized prospective work. */
export async function prepareCreationForest(
  tx: TemplateTransaction,
  input: WorkCreationBatchCommand,
): Promise<PreparedBlueprintCreation[]> {
  const prepared = await prepareUntimedForest(tx, input);
  if (!input.scheduleTiming?.length && !input.scheduleFieldTiming) return prepared;
  const timed = compileScheduleTiming(
    input,
    prepared.map((plan) => ({
      tree: plan.tree,
      workingWeekdays: plan.context.workingWeekdays,
      replan: (command) => {
        const root = plan.entries[0];
        if (root?.kind !== 'ordinary')
          throw new CycleError('Private timing requires a new canonical root.');
        return planScheduleBlueprint(command, {
          graph: plan.graph,
          root: preparedBlueprintRoot(root.prepared),
          context: plan.context,
          choices: command.blueprint?.optionalChoices ?? [],
        }).tree;
      },
    })),
  );
  return prepareUntimedForest(tx, timed);
}
async function prepareUntimedForest(
  tx: TemplateTransaction,
  input: WorkCreationBatchCommand,
): Promise<PreparedBlueprintCreation[]> {
  const plans = new Map<string, PreparedBlueprintCreation>();
  const references = new Map<string, ProspectiveWorkReference>();
  for (const root of input.roots) {
    let command = withPlacement(root.command, {
      ...(await resolveRetainedRootPlacement(tx, root.command, plans)),
      ...resolveScheduleRootPlacement(tx, root.command, plans),
    });
    const retained = retainedRootBinding(tx, command);
    const mapped = retained?.occurrence.mappedWork.get(retained.root.sourceStepId);
    if (!mapped) {
      const id = command.invocation.prospectiveWorkId ?? genId();
      command = { ...command, invocation: { ...command.invocation, prospectiveWorkId: id } };
      references.set(id, rootReference(command, id));
    }
    const context = await createOrdinaryPreparationContext(
      tx,
      command,
      [...references.values()],
      'public',
    );
    const plan = await prepareBlueprintCreation(tx, command, context, { deferTemplateLocks: true });
    plans.set(root.key, plan);
    rememberPreparedReferences(plan, references);
  }
  return [...plans.values()];
}

function allocatedTaskId(
  plan: Awaited<ReturnType<typeof prepareBlueprintCreation>>,
  path: readonly string[],
): string {
  const entry = plan.entries.find(
    (entry) => JSON.stringify(entry.allocated.node.path) === JSON.stringify(path),
  );
  if (!entry) throw new Error('Validated dependency is missing its allocated Task');
  return entry.allocated.id;
}

/** Recheck adopted endpoints and combine new edges with the live dependency graph before inserts. */
export async function validateExistingCreationDependencies(
  tx: TemplateTransaction,
  prepared: readonly PreparedBlueprintCreation[],
  edges: readonly ResolvedForestDependency[],
): Promise<void> {
  if (!prepared.some((plan) => plan.entries.some((entry) => entry.kind === 'existing'))) return;
  const first = prepared[0];
  if (!first) return;
  const allEdges = [
    ...edges,
    ...prepared.flatMap((plan) =>
      plan.tree.dependencies.map((edge) => ({
        blockerId: allocatedTaskId(plan, edge.blockerPath),
        blockedId: allocatedTaskId(plan, edge.blockedPath),
      })),
    ),
  ];
  await authorizeExistingEndpoints(tx, prepared, allEdges);
  if (
    allEdges.length &&
    (await closesWorkspaceDependencyCycle(
      tx,
      first.command.caller.orgId,
      'task',
      allEdges.map((edge) => ({ from: edge.blockerId, to: edge.blockedId })),
    ))
  )
    throw new CycleError();
}

async function authorizeExistingEndpoints(
  tx: TemplateTransaction,
  prepared: readonly PreparedBlueprintCreation[],
  edges: readonly ResolvedForestDependency[],
): Promise<void> {
  const endpoints = new Set(edges.flatMap((edge) => [edge.blockerId, edge.blockedId]));
  const checked = new Set<string>();
  for (const plan of prepared) {
    if (!plan.command.caller.actorId) continue;
    for (const entry of plan.entries) {
      if (entry.kind !== 'existing' || !endpoints.has(entry.work.id) || checked.has(entry.work.id))
        continue;
      await requireWorkAccess(tx, plan.command.caller, 'task', entry.work.id);
      checked.add(entry.work.id);
    }
  }
}
