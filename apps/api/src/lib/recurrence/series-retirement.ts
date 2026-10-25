import {
  processInstance,
  processInstanceTask,
  processInstanceProject,
  processOccurrence,
  recurrenceSeriesRevision,
  task,
  project,
} from '@docket/db';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { TemplateTransaction } from '../templates/persistence';
import type { TaskStateMutation } from '../task-state';
import { authorizeNativeScheduleOccurrence } from './schedule-native-facts';
import { loadNativeScheduleSnapshot } from './schedule-native-snapshot';

/** One persisted run selected under the owning series lock; native JSON alone supplies no archive authority. */
export interface OccurrenceRetirementCandidate {
  readonly occurrenceId: string;
  readonly instanceId: string | null;
  readonly native: boolean;
  readonly applied: boolean;
}
/** Retired rows and parent transitions; observers publish only after the owning transaction commits. */
export interface OccurrenceRetirementResult {
  readonly taskIds: string[];
  readonly projectIds: string[];
  readonly completedOccurrenceIds: string[];
  readonly cascades: TaskStateMutation[];
}
/** Read canonical run identities first and consult old instance rows only for unconverted candidates. */
export async function loadOccurrenceRetirementCandidates(
  tx: TemplateTransaction,
  input: {
    readonly organizationId: string;
    readonly seriesId: string;
    readonly from?: string;
    readonly on?: string;
  },
): Promise<OccurrenceRetirementCandidate[]> {
  const rows = await tx
    .select({
      occurrenceId: processOccurrence.id,
      native: sql<boolean>`${recurrenceSeriesRevision.scheduleDraft} is not null`,
      applied: sql<boolean>`${processOccurrence.blueprintAppliedAt} is not null`,
    })
    .from(processOccurrence)
    .leftJoin(
      recurrenceSeriesRevision,
      and(
        eq(recurrenceSeriesRevision.id, processOccurrence.seriesRevisionId),
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
        eq(recurrenceSeriesRevision.seriesId, input.seriesId),
      ),
    )
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.seriesId, input.seriesId),
        input.from ? gte(processOccurrence.scheduledFor, input.from) : undefined,
        input.on ? eq(processOccurrence.scheduledFor, input.on) : undefined,
        inArray(processOccurrence.status, ['expected', 'materialized', 'needs_resolution']),
      ),
    );
  const ids = rows.filter((row) => !row.native).map((row) => row.occurrenceId);
  const legacy = ids.length
    ? await tx
        .select({ occurrenceId: processInstance.occurrenceId, id: processInstance.id })
        .from(processInstance)
        .where(
          and(
            eq(processInstance.organizationId, input.organizationId),
            inArray(processInstance.occurrenceId, ids),
          ),
        )
    : [];
  const instances = new Map(legacy.map((row) => [row.occurrenceId, row.id]));
  return rows.map((row) => ({ ...row, instanceId: instances.get(row.occurrenceId) ?? null }));
}
interface RetirementWork {
  readonly tasks: readonly Pick<typeof task.$inferSelect, 'id' | 'completedAt' | 'parentTaskId'>[];
  readonly projects: readonly Pick<typeof project.$inferSelect, 'id'>[];
}
async function nativeWork(
  tx: TemplateTransaction,
  input: { readonly organizationId: string; readonly actorId?: string | undefined },
  candidate: OccurrenceRetirementCandidate,
): Promise<RetirementWork> {
  if (!candidate.applied) return { tasks: [], projects: [] };
  const facts = await authorizeNativeScheduleOccurrence(tx, {
    ...input,
    occurrenceId: candidate.occurrenceId,
  });
  const snapshot = await loadNativeScheduleSnapshot(tx, facts, 'edit');
  const selected = new Set(
    facts.roots.flatMap((root) =>
      [root, ...(root.selectedWork ?? [])].map((work) => `${work.kind}:${work.id}`),
    ),
  );
  const tasks: RetirementWork['tasks'][number][] = [],
    projects: RetirementWork['projects'][number][] = [];
  for (const [key, work] of snapshot.rowsByRef)
    if (selected.has(key)) {
      if (work.kind === 'task') tasks.push(work.row);
      else if (work.kind === 'project') projects.push(work.row);
    }
  return { tasks, projects };
}
async function retainedWork(
  tx: TemplateTransaction,
  candidate: OccurrenceRetirementCandidate,
): Promise<RetirementWork> {
  if (!candidate.instanceId) return { tasks: [], projects: [] };
  const [tasks, projects] = await Promise.all([
    tx
      .select({ id: task.id, completedAt: task.completedAt, parentTaskId: task.parentTaskId })
      .from(processInstanceTask)
      .innerJoin(task, eq(task.id, processInstanceTask.taskId))
      .where(eq(processInstanceTask.instanceId, candidate.instanceId)),
    tx
      .select({ id: project.id })
      .from(processInstanceProject)
      .innerJoin(project, eq(project.id, processInstanceProject.projectId))
      .where(eq(processInstanceProject.instanceId, candidate.instanceId)),
  ]);
  return { tasks, projects };
}
async function archiveWork(
  tx: TemplateTransaction,
  work: RetirementWork,
  now: Date,
): Promise<void> {
  if (work.tasks.length)
    await tx
      .update(task)
      .set({ archivedAt: now })
      .where(
        inArray(
          task.id,
          work.tasks.map((row) => row.id),
        ),
      );
  if (work.projects.length)
    await tx
      .update(project)
      .set({ archivedAt: now })
      .where(
        inArray(
          project.id,
          work.projects.map((row) => row.id),
        ),
      );
}
/** Archive only authorized actual selected work, preserving completed runs and the retained path's existing maps. */
export async function retireGeneratedOccurrenceWork(
  tx: TemplateTransaction,
  input: {
    readonly organizationId: string;
    readonly actorId?: string | undefined;
    readonly candidates: readonly OccurrenceRetirementCandidate[];
    readonly now: Date;
  },
): Promise<OccurrenceRetirementResult> {
  const taskIds: string[] = [],
    projectIds: string[] = [],
    parentTaskIds: (string | null)[] = [],
    completedOccurrenceIds: string[] = [];
  for (const candidate of input.candidates) {
    const work = candidate.native
      ? await nativeWork(tx, input, candidate)
      : await retainedWork(tx, candidate);
    if (work.tasks.some((row) => row.completedAt !== null)) {
      completedOccurrenceIds.push(candidate.occurrenceId);
      continue;
    }
    await archiveWork(tx, work, input.now);
    taskIds.push(...work.tasks.map((row) => row.id));
    projectIds.push(...work.projects.map((row) => row.id));
    parentTaskIds.push(...work.tasks.map((row) => row.parentTaskId));
    if (candidate.instanceId)
      await tx
        .update(processInstance)
        .set({ status: 'canceled' })
        .where(eq(processInstance.id, candidate.instanceId));
  }
  const { applySubtaskCompletionPolicyForParents } = await import('../task-state');
  const cascades = await applySubtaskCompletionPolicyForParents(
    tx,
    input.organizationId,
    parentTaskIds,
  );
  return { taskIds, projectIds, completedOccurrenceIds, cascades };
}
