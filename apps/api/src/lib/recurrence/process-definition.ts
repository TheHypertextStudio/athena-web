/**
 * `@docket/api` — validated, normalized authoring of immutable process revisions.
 *
 * @remarks
 * A process definition is the named lifecycle container; every executable graph is an immutable
 * published revision. Materialized instances retain their revision id, so publishing a future
 * revision cannot rewrite work that already exists.
 */
import {
  genId,
  processDefinition,
  processDependency,
  processMilestoneSpec,
  processProjectLabelSpec,
  processProjectSpec,
  processRevision,
  processStep,
  processTaskLabelSpec,
  processTaskSpec,
  recurrenceSeries,
  type Database,
} from '@docket/db';
import {
  ProcessDefinitionCreate,
  ProcessDefinitionSummaryOut,
  ProcessDefinitionUpdate,
  type ProcessDefinitionCreate as ProcessDefinitionCreateValue,
  type ProcessDefinitionDetailOut,
  type ProcessDefinitionFromProjectCreate,
  type ProcessStepTiming,
} from '../../contracts/recurrence';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../error';

import {
  validateProcessDefinitionGraph,
  validateReferenceOwnership,
} from './process-definition-validate';

import { loadProcessDefinitionDetail } from './process-definition-read';

export { createProcessDefinitionFromProject } from './process-from-project';

export { validateProcessDefinitionGraph } from './process-definition-validate';
export { loadProcessDefinitionDetail } from './process-definition-read';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Command for creating and immediately publishing a reusable process. */
export interface CreatePublishedProcessDefinitionCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the definition and normalized rows. */
  readonly actorId?: string | undefined;
  /** Fully validated graph and reusable work specifications. */
  readonly definition: ProcessDefinitionCreateValue;
}

/** Command for appending a new immutable revision to an existing process. */
export interface AppendPublishedProcessRevisionCommand {
  /** Owning Docket workspace. */
  readonly organizationId: string;
  /** Actor credited with the new revision. */
  readonly actorId?: string | undefined;
  /** Existing definition receiving the revision. */
  readonly definitionId: string;
  /** Replacement graph used only by future instances. */
  readonly revision: ProcessDefinitionCreateValue;
}

/** Identities returned after one process revision is published. */
export interface PublishedProcessRevision {
  /** Stable definition identity. */
  readonly definitionId: string;
  /** Immutable revision identity. */
  readonly revisionId: string;
  /** Monotonic revision number within the definition. */
  readonly revisionNumber: number;
  /** Stable authored keys mapped to their normalized row ids. */
  readonly stepIdsByKey: Readonly<Record<string, string>>;
}

/** Command for turning one ordinary project into a reusable process snapshot. */
export interface CreateProcessDefinitionFromProjectCommand {
  readonly organizationId: string;
  readonly actorId?: string | undefined;
  readonly input: ProcessDefinitionFromProjectCreate;
  readonly now?: Date | undefined;
}

/** Map a timing union onto normalized process-step columns. */
function timingColumns(
  timing: ProcessStepTiming,
  stepIds: ReadonlyMap<string, string>,
): {
  readonly timingKind: 'on_trigger' | 'relative_to_trigger' | 'after_step_completion';
  readonly offsetDays?: number | undefined;
  readonly afterStepId?: string | undefined;
} {
  if (timing.kind === 'on_trigger') return { timingKind: 'on_trigger' };
  if (timing.kind === 'relative_to_trigger') {
    return { timingKind: 'relative_to_trigger', offsetDays: timing.offsetDays };
  }
  const afterStepId = stepIds.get(timing.stepKey);
  if (!afterStepId) throw new ConflictError('Completion timing references an unknown step');
  return {
    timingKind: 'after_step_completion',
    offsetDays: timing.offsetDays,
    afterStepId,
  };
}

/** Read a preallocated step id or fail before producing a partial normalized revision. */
function requireStepId(stepIds: ReadonlyMap<string, string>, key: string): string {
  const id = stepIds.get(key);
  if (!id) throw new ConflictError(`Process step ${key} was not allocated`);
  return id;
}

/**
 * Write the revision's project specification and its label joins.
 *
 * @param tx - The open transaction.
 * @param organizationId - The workspace publishing the revision.
 * @param definition - The definition being published.
 * @param stepIds - The row id allocated for each authored step key.
 */
async function persistProjectSpec(
  tx: Transaction,
  organizationId: string,
  definition: ProcessDefinitionCreateValue,
  stepIds: ReadonlyMap<string, string>,
): Promise<void> {
  const projectSpec = definition.project;
  if (!projectSpec) return;
  const stepId = requireStepId(stepIds, projectSpec.key);
  await tx.insert(processProjectSpec).values({
    stepId,
    organizationId,
    name: projectSpec.name,
    summary: projectSpec.summary,
    description: projectSpec.description,
    leadId: projectSpec.leadId,
    teamId: projectSpec.teamId,
    programId: projectSpec.programId,
    status: projectSpec.status,
    health: projectSpec.health,
    startOffsetDays: projectSpec.startOffsetDays,
    targetOffsetDays: projectSpec.targetOffsetDays,
  });
  if (projectSpec.labelIds.length === 0) return;
  await tx
    .insert(processProjectLabelSpec)
    .values(
      projectSpec.labelIds.map((labelId) => ({ projectStepId: stepId, labelId, organizationId })),
    );
}

/**
 * Write the revision's milestone specifications.
 *
 * @param tx - The open transaction.
 * @param organizationId - The workspace publishing the revision.
 * @param definition - The definition being published.
 * @param stepIds - The row id allocated for each authored step key.
 */
async function persistMilestoneSpecs(
  tx: Transaction,
  organizationId: string,
  definition: ProcessDefinitionCreateValue,
  stepIds: ReadonlyMap<string, string>,
): Promise<void> {
  if (definition.milestones.length === 0) return;
  await tx.insert(processMilestoneSpec).values(
    definition.milestones.map((step) => ({
      stepId: requireStepId(stepIds, step.key),
      organizationId,
      projectStepId: requireStepId(stepIds, step.projectKey),
      name: step.name,
      description: step.description,
      targetOffsetDays: step.targetOffsetDays,
    })),
  );
}

/**
 * Write the revision's task specifications and their label joins.
 *
 * @param tx - The open transaction.
 * @param organizationId - The workspace publishing the revision.
 * @param definition - The definition being published.
 * @param stepIds - The row id allocated for each authored step key.
 */
async function persistTaskSpecs(
  tx: Transaction,
  organizationId: string,
  definition: ProcessDefinitionCreateValue,
  stepIds: ReadonlyMap<string, string>,
): Promise<void> {
  await tx.insert(processTaskSpec).values(
    definition.tasks.map((step) => ({
      stepId: requireStepId(stepIds, step.key),
      organizationId,
      title: step.title,
      description: step.description,
      teamId: step.teamId,
      state: step.state,
      priority: step.priority,
      assigneeId: step.assigneeId,
      projectId: step.projectId,
      projectStepId: step.projectKey ? stepIds.get(step.projectKey) : undefined,
      milestoneId: step.milestoneId,
      milestoneStepId: step.milestoneKey ? stepIds.get(step.milestoneKey) : undefined,
      cycleId: step.cycleId,
      parentTaskId: step.parentTaskId,
      parentTaskStepId: step.parentTaskKey ? stepIds.get(step.parentTaskKey) : undefined,
      estimate: step.estimate,
      estimateMinutes: step.estimateMinutes,
      startOffsetDays: step.startOffsetDays,
      dueOffsetDays: step.dueOffsetDays,
    })),
  );
  const taskLabels = definition.tasks.flatMap((step) =>
    step.labelIds.map((labelId) => ({
      taskStepId: requireStepId(stepIds, step.key),
      labelId,
      organizationId,
    })),
  );
  if (taskLabels.length > 0) await tx.insert(processTaskLabelSpec).values(taskLabels);
}

/** Persist one immutable revision and all normalized specification rows. */
async function persistRevision(
  tx: Transaction,
  input: {
    readonly organizationId: string;
    readonly actorId?: string | undefined;
    readonly definitionId: string;
    readonly revisionNumber: number;
    readonly definition: ProcessDefinitionCreateValue;
  },
): Promise<PublishedProcessRevision> {
  const { organizationId, actorId, definitionId, revisionNumber, definition } = input;
  const revisionId = genId();
  const allSteps = [
    ...(definition.project
      ? [{ kind: 'project' as const, sort: 0, value: definition.project }]
      : []),
    ...definition.milestones.map((value) => ({
      kind: 'milestone' as const,
      sort: value.sort,
      value,
    })),
    ...definition.tasks.map((value, sort) => ({ kind: 'task' as const, sort, value })),
  ];
  const stepIds = new Map(allSteps.map((step) => [step.value.key, genId()]));

  await tx.insert(processRevision).values({
    id: revisionId,
    organizationId,
    definitionId,
    number: revisionNumber,
    creationMode: definition.creationMode,
    publishedAt: new Date(),
    createdBy: actorId,
  });
  await tx.insert(processStep).values(
    allSteps.map((step) => ({
      id: requireStepId(stepIds, step.value.key),
      organizationId,
      revisionId,
      key: step.value.key,
      kind: step.kind,
      sort: step.sort,
      ...timingColumns(step.value.timing, stepIds),
      createdBy: actorId,
    })),
  );

  await persistProjectSpec(tx, organizationId, definition, stepIds);
  await persistMilestoneSpecs(tx, organizationId, definition, stepIds);
  await persistTaskSpecs(tx, organizationId, definition, stepIds);
  if (definition.dependencies.length > 0) {
    await tx.insert(processDependency).values(
      definition.dependencies.map((edge) => ({
        revisionId,
        blockingStepId: requireStepId(stepIds, edge.blockingStepKey),
        blockedStepId: requireStepId(stepIds, edge.blockedStepKey),
        organizationId,
      })),
    );
  }

  return {
    definitionId,
    revisionId,
    revisionNumber,
    stepIdsByKey: Object.fromEntries(stepIds),
  };
}

/** Create a named process and atomically publish its first immutable revision. */
export async function createPublishedProcessDefinition(
  database: Database,
  command: CreatePublishedProcessDefinitionCommand,
): Promise<PublishedProcessRevision> {
  const definition = ProcessDefinitionCreate.parse(command.definition);
  validateProcessDefinitionGraph(definition);
  return database.transaction(async (tx) => {
    await validateReferenceOwnership(tx, command.organizationId, definition);
    const definitionId = genId();
    await tx.insert(processDefinition).values({
      id: definitionId,
      organizationId: command.organizationId,
      name: definition.name,
      description: definition.description,
      status: 'published',
      createdBy: command.actorId,
    });
    return persistRevision(tx, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      definitionId,
      revisionNumber: 1,
      definition,
    });
  });
}

/** Snapshot one ordinary project's hierarchy, dates, labels, and dependencies as a process. */
/** Append and publish a new revision without mutating any prior revision or instance. */
export async function appendPublishedProcessRevision(
  database: Database,
  command: AppendPublishedProcessRevisionCommand,
): Promise<PublishedProcessRevision> {
  const definition = ProcessDefinitionCreate.parse(command.revision);
  validateProcessDefinitionGraph(definition);
  return database.transaction(async (tx) => {
    const existing = await tx
      .select({ id: processDefinition.id, status: processDefinition.status })
      .from(processDefinition)
      .where(
        and(
          eq(processDefinition.id, command.definitionId),
          eq(processDefinition.organizationId, command.organizationId),
        ),
      )
      .for('update')
      .limit(1);
    if (!existing[0]) throw new NotFoundError('Process definition not found');
    if (existing[0].status === 'archived')
      throw new ConflictError('Archived process cannot change');
    await validateReferenceOwnership(tx, command.organizationId, definition);
    const latest = await tx
      .select({ number: processRevision.number })
      .from(processRevision)
      .where(eq(processRevision.definitionId, command.definitionId))
      .orderBy(desc(processRevision.number))
      .limit(1);
    const revisionNumber = (latest[0]?.number ?? 0) + 1;
    await tx
      .update(processDefinition)
      .set({ name: definition.name, description: definition.description, status: 'published' })
      .where(eq(processDefinition.id, command.definitionId));
    return persistRevision(tx, {
      organizationId: command.organizationId,
      actorId: command.actorId,
      definitionId: command.definitionId,
      revisionNumber,
      definition,
    });
  });
}

/** List active org-scoped process definitions as compact latest-revision summaries. */
export async function listProcessDefinitions(
  database: Database,
  organizationId: string,
): Promise<z.input<typeof ProcessDefinitionSummaryOut>[]> {
  const definitions = await database
    .select()
    .from(processDefinition)
    .where(
      and(
        eq(processDefinition.organizationId, organizationId),
        isNull(processDefinition.archivedAt),
        ne(processDefinition.status, 'archived'),
      ),
    )
    .orderBy(desc(processDefinition.updatedAt));
  return Promise.all(
    definitions.map(async (definition) => {
      const latest = await database
        .select({ number: processRevision.number })
        .from(processRevision)
        .where(eq(processRevision.definitionId, definition.id))
        .orderBy(desc(processRevision.number))
        .limit(1);
      const number = latest[0]?.number;
      if (!number) throw new ConflictError('Process definition has no published revision');
      return ProcessDefinitionSummaryOut.parse({
        id: definition.id,
        organizationId: definition.organizationId,
        name: definition.name,
        description: definition.description,
        status: definition.status,
        latestRevisionNumber: number,
        createdAt: definition.createdAt.toISOString(),
        updatedAt: definition.updatedAt.toISOString(),
      });
    }),
  );
}

/** Update mutable definition metadata without rewriting executable revision history. */
export async function updateProcessDefinitionMetadata(
  database: Database,
  command: {
    readonly organizationId: string;
    readonly definitionId: string;
    readonly patch: z.input<typeof ProcessDefinitionUpdate>;
  },
): Promise<z.input<typeof ProcessDefinitionDetailOut>> {
  const patch = ProcessDefinitionUpdate.parse(command.patch);
  const updated = await database
    .update(processDefinition)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
    })
    .where(
      and(
        eq(processDefinition.id, command.definitionId),
        eq(processDefinition.organizationId, command.organizationId),
        isNull(processDefinition.archivedAt),
      ),
    )
    .returning({ id: processDefinition.id });
  if (!updated[0]) throw new NotFoundError('Process definition not found');
  return loadProcessDefinitionDetail(database, command.organizationId, command.definitionId);
}

/** Archive a process definition and end active series without deleting historical work. */
export async function archiveProcessDefinition(
  database: Database,
  organizationId: string,
  definitionId: string,
): Promise<z.input<typeof ProcessDefinitionSummaryOut>> {
  const before = await loadProcessDefinitionDetail(database, organizationId, definitionId);
  const now = new Date();
  await database
    .update(processDefinition)
    .set({ status: 'archived', archivedAt: now })
    .where(
      and(
        eq(processDefinition.id, definitionId),
        eq(processDefinition.organizationId, organizationId),
      ),
    );
  await database
    .update(recurrenceSeries)
    .set({ status: 'ended', endedAt: now })
    .where(
      and(
        eq(recurrenceSeries.definitionId, definitionId),
        eq(recurrenceSeries.organizationId, organizationId),
        ne(recurrenceSeries.status, 'ended'),
      ),
    );
  return ProcessDefinitionSummaryOut.parse({
    id: before.id,
    organizationId: before.organizationId,
    name: before.name,
    description: before.description,
    status: 'archived',
    latestRevisionNumber: before.latestRevisionNumber,
    createdAt: before.createdAt,
    updatedAt: now.toISOString(),
  });
}
