import {
  processInstanceProject,
  processInstanceMilestone,
  processInstanceTask,
  processOccurrence,
  registerRetainedDateOwnership,
  type BlueprintOccurrenceRoot,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import {
  authorizeRetainedOccurrence,
  type RetainedOccurrenceRequest,
  type AuthorizedRetainedOccurrence,
} from '../work-creation/retained-authority';
import { createWorkBatchInTransaction } from '../work-creation/service';
import type { WorkCreationBatchResult } from '../work-creation/types';
import type { DeferredWorkEffect } from '../work-creation/types';
import type { InsertedWork } from '../work-creation/writers';
import { loadRetainedBlueprintRoot } from '../work-template-blueprints/retained';
import { retainedBlueprintSources } from '../work-template-blueprints/retained-paths';
import { retainedOccurrenceCommand } from './work-template-command';
import type { MaterializedOccurrence, MaterializedStepDelta } from './materialize';
/** Existing recurrence result plus one shared creation action's deferred effects. */
export interface TemplateOccurrenceMaterialization {
  readonly result: MaterializedOccurrence;
  readonly delta: MaterializedStepDelta;
  readonly effects: readonly DeferredWorkEffect[];
}
async function insertMapping(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  sourceStepId: string,
  work: Pick<InsertedWork, 'kind' | 'id'>,
): Promise<void> {
  const base = {
    organizationId: facts.organizationId,
    instanceId: facts.instanceId,
    stepId: sourceStepId,
    createdBy: facts.caller.actorId,
  };
  switch (work.kind) {
    case 'project':
      await tx
        .insert(processInstanceProject)
        .values({ ...base, projectId: work.id })
        .onConflictDoNothing();
      return;
    case 'milestone':
      await tx
        .insert(processInstanceMilestone)
        .values({ ...base, milestoneId: work.id })
        .onConflictDoNothing();
      return;
    case 'task':
      await tx
        .insert(processInstanceTask)
        .values({ ...base, taskId: work.id })
        .onConflictDoNothing();
      return;
    default:
      throw new ConflictError('Retained work kind changed');
  }
}
function identityMaps(facts: AuthorizedRetainedOccurrence) {
  const projects: Record<string, string> = {};
  const milestones: Record<string, string> = {};
  const tasks: Record<string, string> = {};
  for (const row of facts.mappedWork.values())
    ({ project: projects, milestone: milestones, task: tasks })[row.kind][row.sourceKey] = row.id;
  return { projectIdsByKey: projects, milestoneIdsByKey: milestones, taskIdsByKey: tasks };
}
async function projectMissingMappings(
  tx: TemplateTransaction,
  request: RetainedOccurrenceRequest,
  facts: AuthorizedRetainedOccurrence,
): Promise<AuthorizedRetainedOccurrence> {
  const sources = await retainedBlueprintSources(tx, facts.authority);
  for (const root of facts.manifest.roots) {
    const existing = await loadRetainedBlueprintRoot(tx, {
      authority: facts.authority,
      rootKey: root.key,
    });
    for (const source of sources.filter((source) => source.rootKey === root.key)) {
      if (facts.mappedWork.has(source.sourceStepId)) continue;
      const entry = existing.existingByPath.get(JSON.stringify(source.path));
      if (
        !entry ||
        (source.blueprintStepId && source.blueprintStepId !== entry.work.row.blueprintStepId)
      )
        throw new ConflictError('Generated source mapping is missing');
      await insertMapping(tx, facts, source.sourceStepId, entry.work);
    }
  }
  return authorizeRetainedOccurrence(tx, request);
}
async function registerTiming(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  newIds: ReadonlySet<string>,
): Promise<void> {
  const sources = await retainedBlueprintSources(tx, facts.authority);
  for (const root of facts.manifest.roots) {
    const actual = await loadRetainedBlueprintRoot(tx, {
      authority: facts.authority,
      rootKey: root.key,
    });
    for (const source of sources.filter((source) => source.rootKey === root.key)) {
      const mapped = facts.mappedWork.get(source.sourceStepId);
      const entry = actual.existingByPath.get(JSON.stringify(source.path));
      if (!mapped || !entry) throw new ConflictError('Generated timing mapping is missing');
      await registerRetainedDateOwnership(tx, {
        organizationId: facts.organizationId,
        occurrenceId: facts.occurrenceId,
        invocationId: facts.invocationId,
        sourceStepId: source.sourceStepId,
        workKind: mapped.kind,
        workId: mapped.id,
        dates: entry.snapshot.dates,
        ...(newIds.has(mapped.id)
          ? {}
          : { manualFields: new Set(['startDate', 'dueDate', 'targetDate'] as const) }),
      });
    }
  }
}
async function replayApplied(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
): Promise<TemplateOccurrenceMaterialization> {
  for (const root of facts.manifest.roots)
    await loadRetainedBlueprintRoot(tx, { authority: facts.authority, rootKey: root.key });
  return {
    result: {
      occurrenceId: facts.occurrenceId,
      instanceId: facts.instanceId,
      ...identityMaps(facts),
    },
    delta: { createdProjectIdsByKey: {}, createdMilestoneIdsByKey: {}, createdTaskIdsByKey: {} },
    effects: [],
  };
}
/** Freeze exact globally locked closures privately before any retained snapshot consumes them. */
async function rememberAcceptedRootClosures(
  tx: TemplateTransaction,
  facts: AuthorizedRetainedOccurrence,
  created: WorkCreationBatchResult,
): Promise<void> {
  const refs: BlueprintOccurrenceRoot[] = facts.manifest.roots.map((root) => {
    const work = created.rootsByKey.get(root.key);
    const resolvedManifest = created.resolvedManifestsByKey.get(root.key);
    const selectedRows = created.selectedWorkByKey.get(root.key);
    if (!work || !resolvedManifest || !selectedRows)
      throw new ConflictError('Accepted root closure is missing');
    const selectedWork = selectedRows.map((row) => {
      if (row.kind === 'initiative') throw new ConflictError('Invalid retained root kind');
      return { ...row, kind: row.kind };
    });
    const previous = facts.rootRefs.find((ref) => ref.key === root.sourceKey && ref.id === work.id);
    return {
      key: root.sourceKey,
      kind: root.kind,
      id: work.id,
      resolvedManifest: previous?.resolvedManifest ?? resolvedManifest,
      selectedWork: previous?.selectedWork ?? selectedWork,
    };
  });
  await tx
    .update(processOccurrence)
    .set({
      blueprintInvocationId: facts.invocationId,
      blueprintRootRefs: refs,
    })
    .where(
      and(
        eq(processOccurrence.id, facts.occurrenceId),
        eq(processOccurrence.organizationId, facts.organizationId),
      ),
    );
}

/** Materialize missing work through shared canonical creation, retaining original occurrence IDs and legacy projections. */
export async function materializeTemplateOccurrence(
  tx: TemplateTransaction,
  request: RetainedOccurrenceRequest,
): Promise<TemplateOccurrenceMaterialization> {
  const before = await authorizeRetainedOccurrence(tx, request);
  if (before.appliedAt) return replayApplied(tx, before);
  const command = await retainedOccurrenceCommand(tx, before.authority);
  const created = await createWorkBatchInTransaction(tx, command);
  for (const root of before.manifest.roots) {
    const work = created.rootsByKey.get(root.key);
    if (!work) throw new ConflictError('Generated root mapping is missing');
    if (!before.mappedWork.has(root.sourceStepId))
      await insertMapping(tx, before, root.sourceStepId, work);
  }
  await rememberAcceptedRootClosures(tx, before, created);
  const rootsBound = await authorizeRetainedOccurrence(tx, request);
  const after = await projectMissingMappings(tx, request, rootsBound);
  await tx
    .update(processOccurrence)
    .set({ blueprintInvocationId: after.invocationId, blueprintRootRefs: [...after.rootRefs] })
    .where(
      and(
        eq(processOccurrence.id, request.occurrenceId),
        eq(processOccurrence.organizationId, request.organizationId),
      ),
    );
  const all = identityMaps(after);
  const newIds = new Set(created.created.map((work) => work.id));
  await registerTiming(tx, after, newIds);
  await tx
    .update(processOccurrence)
    .set({ blueprintAppliedAt: new Date() })
    .where(
      and(
        eq(processOccurrence.id, request.occurrenceId),
        eq(processOccurrence.organizationId, request.organizationId),
      ),
    );
  const onlyNew = (values: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(values).filter(([, id]) => newIds.has(id)));
  return {
    result: { occurrenceId: request.occurrenceId, instanceId: request.instanceId, ...all },
    delta: {
      createdProjectIdsByKey: onlyNew(all.projectIdsByKey),
      createdMilestoneIdsByKey: onlyNew(all.milestoneIdsByKey),
      createdTaskIdsByKey: onlyNew(all.taskIdsByKey),
    },
    effects: created.effects,
  };
}
