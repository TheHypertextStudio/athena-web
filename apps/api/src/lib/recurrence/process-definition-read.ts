/**
 * `@docket/api` — reading a published process revision back out as its authored shape.
 *
 * @remarks
 * Publishing normalizes a definition into step rows, per-kind specification rows, label joins and
 * dependency edges. This is the inverse: it reassembles those rows into the same document the
 * author submitted, so the editor opens on what was published rather than on a second
 * representation of it.
 *
 * Every step is addressed by its authored key rather than its row id, because keys are what the
 * document refers to and what survive across revisions.
 */
import {
  processDefinition,
  processDependency,
  processMilestoneSpec,
  processProjectLabelSpec,
  processProjectSpec,
  processRevision,
  processStep,
  processTaskLabelSpec,
  processTaskSpec,
  type Database,
} from '@docket/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { ProcessDefinitionDetailOut, type ProcessStepTiming } from '../../contracts/recurrence';
import { ConflictError, NotFoundError } from '../../error';

type StepRow = typeof processStep.$inferSelect;
type StepKeys = ReadonlyMap<string, string>;

/** Convert normalized timing columns back to the public discriminated timing union. */
export function timingFromRow(row: StepRow, keysByStepId: StepKeys): ProcessStepTiming {
  if (row.timingKind === 'on_trigger') return { kind: 'on_trigger' };
  if (row.timingKind === 'relative_to_trigger') {
    return { kind: 'relative_to_trigger', offsetDays: row.offsetDays ?? 0 };
  }
  const stepKey = row.afterStepId ? keysByStepId.get(row.afterStepId) : undefined;
  if (!stepKey) throw new ConflictError('Published process timing is incomplete');
  return { kind: 'after_step_completion', stepKey, offsetDays: row.offsetDays ?? 0 };
}

/** The definition row and the latest revision published against it. */
interface LatestRevision {
  readonly definition: typeof processDefinition.$inferSelect;
  readonly revision: typeof processRevision.$inferSelect;
}

/**
 * Read a live definition and its most recently published revision.
 *
 * @param database - The database handle.
 * @param organizationId - The workspace that owns the definition.
 * @param definitionId - The definition to read.
 * @returns The definition and its latest revision.
 * @throws {NotFoundError} When the definition is archived or belongs to another workspace.
 * @throws {ConflictError} When it has never been published.
 */
async function loadLatestRevision(
  database: Database,
  organizationId: string,
  definitionId: string,
): Promise<LatestRevision> {
  const definitions = await database
    .select()
    .from(processDefinition)
    .where(
      and(
        eq(processDefinition.id, definitionId),
        eq(processDefinition.organizationId, organizationId),
        isNull(processDefinition.archivedAt),
      ),
    )
    .limit(1);
  const definition = definitions[0];
  if (!definition) throw new NotFoundError('Process definition not found');

  const revisions = await database
    .select()
    .from(processRevision)
    .where(
      and(
        eq(processRevision.definitionId, definitionId),
        eq(processRevision.organizationId, organizationId),
      ),
    )
    .orderBy(desc(processRevision.number))
    .limit(1);
  const revision = revisions[0];
  if (!revision) throw new ConflictError('Process definition has no published revision');
  return { definition, revision };
}

/** Every normalized row one published revision is reassembled from. */
interface RevisionRows {
  readonly steps: readonly StepRow[];
  readonly keysByStepId: StepKeys;
  readonly stepsById: ReadonlyMap<string, StepRow>;
  readonly projectSpecs: readonly (typeof processProjectSpec.$inferSelect)[];
  readonly milestoneSpecs: readonly (typeof processMilestoneSpec.$inferSelect)[];
  readonly taskSpecs: readonly (typeof processTaskSpec.$inferSelect)[];
  readonly taskLabelsByStep: ReadonlyMap<string, readonly string[]>;
  readonly projectLabelsByStep: ReadonlyMap<string, readonly string[]>;
  readonly dependencies: readonly (typeof processDependency.$inferSelect)[];
}

/**
 * Read every specification, label join, and dependency edge belonging to one revision.
 *
 * @param database - The database handle.
 * @param revisionId - The revision to read.
 * @returns The rows, indexed by the step they belong to.
 */
async function loadRevisionRows(database: Database, revisionId: string): Promise<RevisionRows> {
  const steps = await database
    .select()
    .from(processStep)
    .where(eq(processStep.revisionId, revisionId))
    .orderBy(processStep.sort, processStep.createdAt);
  const stepIds = steps.map((step) => step.id);
  const [projectSpecs, milestoneSpecs, taskSpecs, taskLabels, projectLabels, dependencies] =
    stepIds.length === 0
      ? ([[], [], [], [], [], []] as const)
      : await Promise.all([
          database
            .select()
            .from(processProjectSpec)
            .where(inArray(processProjectSpec.stepId, stepIds)),
          database
            .select()
            .from(processMilestoneSpec)
            .where(inArray(processMilestoneSpec.stepId, stepIds)),
          database.select().from(processTaskSpec).where(inArray(processTaskSpec.stepId, stepIds)),
          database
            .select()
            .from(processTaskLabelSpec)
            .where(inArray(processTaskLabelSpec.taskStepId, stepIds)),
          database
            .select()
            .from(processProjectLabelSpec)
            .where(inArray(processProjectLabelSpec.projectStepId, stepIds)),
          database
            .select()
            .from(processDependency)
            .where(eq(processDependency.revisionId, revisionId)),
        ]);

  return {
    steps,
    keysByStepId: new Map(steps.map((step) => [step.id, step.key])),
    stepsById: new Map(steps.map((step) => [step.id, step])),
    projectSpecs,
    milestoneSpecs,
    taskSpecs,
    taskLabelsByStep: groupLabels(taskLabels, (row) => row.taskStepId),
    projectLabelsByStep: groupLabels(projectLabels, (row) => row.projectStepId),
    dependencies,
  };
}

/** Collect label joins into one list per step. */
function groupLabels<TRow extends { labelId: string }>(
  rows: readonly TRow[],
  stepIdOf: (row: TRow) => string,
): ReadonlyMap<string, readonly string[]> {
  const byStep = new Map<string, string[]>();
  for (const row of rows) {
    const current = byStep.get(stepIdOf(row)) ?? [];
    current.push(row.labelId);
    byStep.set(stepIdOf(row), current);
  }
  return byStep;
}

/**
 * Carry a column into the document only when it holds a value.
 *
 * @remarks
 * A published specification stores every optional field as a nullable column, and the authored
 * document omits the ones that were never set. Spreading this keeps that distinction without a
 * conditional per field.
 *
 * @param key - The document field name.
 * @param value - The stored column value.
 * @returns The one-field object to spread, or an empty one.
 */
function present<TKey extends string, TValue>(
  key: TKey,
  value: TValue | null,
): Record<TKey, TValue> | Record<string, never> {
  return value === null ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

/** Reassemble the revision's project step, when it published one. */
function projectOut(rows: RevisionRows) {
  const spec = rows.projectSpecs[0];
  const step = spec ? rows.stepsById.get(spec.stepId) : undefined;
  if (!spec || !step) return undefined;
  return {
    key: step.key,
    name: spec.name,
    ...present('summary', spec.summary),
    ...present('description', spec.description),
    ...present('leadId', spec.leadId),
    ...present('teamId', spec.teamId),
    ...present('programId', spec.programId),
    status: spec.status,
    ...present('health', spec.health),
    ...present('startOffsetDays', spec.startOffsetDays),
    ...present('targetOffsetDays', spec.targetOffsetDays),
    labelIds: rows.projectLabelsByStep.get(spec.stepId) ?? [],
    timing: timingFromRow(step, rows.keysByStepId),
  };
}

/** Reassemble the revision's milestone steps. */
function milestonesOut(rows: RevisionRows) {
  return rows.milestoneSpecs.map((spec) => {
    const step = rows.stepsById.get(spec.stepId);
    const projectKey = rows.keysByStepId.get(spec.projectStepId);
    if (!step || !projectKey) {
      throw new ConflictError('Published milestone specification is incomplete');
    }
    return {
      key: step.key,
      projectKey,
      name: spec.name,
      ...(spec.description === null ? {} : { description: spec.description }),
      sort: step.sort,
      ...(spec.targetOffsetDays === null ? {} : { targetOffsetDays: spec.targetOffsetDays }),
      timing: timingFromRow(step, rows.keysByStepId),
    };
  });
}

/**
 * The container references one task step declares, each as a fixed id or a generated step key.
 *
 * @param spec - The task specification row.
 * @param keysByStepId - The authored key of every step in this revision.
 * @returns The reference fields to spread into the task document.
 */
function taskReferencesOut(spec: typeof processTaskSpec.$inferSelect, keysByStepId: StepKeys) {
  return {
    ...(spec.projectId === null ? {} : { projectId: spec.projectId }),
    ...(spec.projectStepId === null ? {} : { projectKey: keysByStepId.get(spec.projectStepId) }),
    ...(spec.milestoneId === null ? {} : { milestoneId: spec.milestoneId }),
    ...(spec.milestoneStepId === null
      ? {}
      : { milestoneKey: keysByStepId.get(spec.milestoneStepId) }),
    ...(spec.cycleId === null ? {} : { cycleId: spec.cycleId }),
    ...(spec.parentTaskId === null ? {} : { parentTaskId: spec.parentTaskId }),
    ...(spec.parentTaskStepId === null
      ? {}
      : { parentTaskKey: keysByStepId.get(spec.parentTaskStepId) }),
  };
}

/** Reassemble the revision's task steps. */
function tasksOut(rows: RevisionRows) {
  return rows.taskSpecs.map((spec) => {
    const step = rows.stepsById.get(spec.stepId);
    if (!step) throw new ConflictError('Published task specification is incomplete');
    return {
      key: step.key,
      title: spec.title,
      ...(spec.description === null ? {} : { description: spec.description }),
      teamId: spec.teamId,
      ...(spec.state === null ? {} : { state: spec.state }),
      priority: spec.priority,
      ...(spec.assigneeId === null ? {} : { assigneeId: spec.assigneeId }),
      ...taskReferencesOut(spec, rows.keysByStepId),
      ...(spec.estimate === null ? {} : { estimate: spec.estimate }),
      ...(spec.estimateMinutes === null ? {} : { estimateMinutes: spec.estimateMinutes }),
      ...(spec.startOffsetDays === null ? {} : { startOffsetDays: spec.startOffsetDays }),
      ...(spec.dueOffsetDays === null ? {} : { dueOffsetDays: spec.dueOffsetDays }),
      labelIds: rows.taskLabelsByStep.get(spec.stepId) ?? [],
      timing: timingFromRow(step, rows.keysByStepId),
    };
  });
}

/** Reassemble the revision's dependency edges, addressed by authored key. */
function dependenciesOut(rows: RevisionRows) {
  return rows.dependencies.map((edge) => {
    const blockingStepKey = rows.keysByStepId.get(edge.blockingStepId);
    const blockedStepKey = rows.keysByStepId.get(edge.blockedStepId);
    if (!blockingStepKey || !blockedStepKey) {
      throw new ConflictError('Published process dependency is incomplete');
    }
    return { blockingStepKey, blockedStepKey };
  });
}

/** Load one org-scoped process and reconstruct its latest immutable revision. */
export async function loadProcessDefinitionDetail(
  database: Database,
  organizationId: string,
  definitionId: string,
): Promise<z.input<typeof ProcessDefinitionDetailOut>> {
  const { definition, revision } = await loadLatestRevision(database, organizationId, definitionId);
  const rows = await loadRevisionRows(database, revision.id);
  const project = projectOut(rows);

  return ProcessDefinitionDetailOut.parse({
    id: definition.id,
    organizationId: definition.organizationId,
    name: definition.name,
    description: definition.description,
    status: definition.status,
    latestRevisionNumber: revision.number,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
    revision: {
      id: revision.id,
      definitionId: definition.id,
      number: revision.number,
      creationMode: revision.creationMode,
      ...(project === undefined ? {} : { project }),
      milestones: milestonesOut(rows),
      tasks: tasksOut(rows),
      dependencies: dependenciesOut(rows),
      publishedAt: revision.publishedAt?.toISOString() ?? null,
      createdAt: revision.createdAt.toISOString(),
    },
  });
}
