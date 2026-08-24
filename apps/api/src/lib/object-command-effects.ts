/** Durable post-commit consequence queue for canvas object commands. */
import { db, objectCommandEffectJob, type project } from '@docket/db';
import { and, asc, eq, inArray, lt, lte, or } from 'drizzle-orm';

import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { emitEventStrict } from '../routes/event-emit';
import { finishTaskChanges, type RecordTaskChangesInput } from './task-audit';
import { finishTaskStateConsequences, type TaskRow, type TaskStateMutation } from './task-state';

const SUCCEEDED_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SUCCEEDED_JOB_PRUNE_LIMIT = 100;

/** One state-transition consequence stored until a worker publishes it. */
export interface ObjectCommandTaskStateEffect {
  readonly kind: 'task_state';
  readonly mutation: TaskStateMutation;
}

/** One Task field-change consequence stored until a worker publishes it. */
export interface ObjectCommandTaskFieldsEffect {
  readonly kind: 'task_fields';
  readonly change: RecordTaskChangesInput & { readonly assignmentChanged: boolean };
}

/** One Project status event stored until a worker publishes it. */
export interface ObjectCommandProjectStatusEffect {
  readonly kind: 'project_status';
  readonly project: Pick<typeof project.$inferSelect, 'id' | 'name' | 'status'>;
}

/** One entity-write announcement stored until a worker publishes it. */
export interface ObjectCommandEntityWriteEffect {
  readonly kind: 'entity_write';
  readonly sourceTable: 'task' | 'project';
  readonly entityId: string;
  readonly operation: 'upsert' | 'delete';
}

/** A single idempotent consequence in a command-effect job. */
export type ObjectCommandEffect =
  | ObjectCommandTaskStateEffect
  | ObjectCommandTaskFieldsEffect
  | ObjectCommandProjectStatusEffect
  | ObjectCommandEntityWriteEffect;

/** Versioned payload committed with the command and drained after the response. */
export interface ObjectCommandEffectPayload {
  readonly version: 1;
  readonly organizationId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly occurredAt: string;
  readonly effects: readonly ObjectCommandEffect[];
}

type ObjectCommandEffectTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Commit one durable consequence job through the command's active transaction.
 *
 * @param tx - The transaction that owns the command mutation.
 * @param payload - The ordered, versioned consequences to publish after commit.
 * @returns The inserted job id, or null when the payload has no consequences.
 */
export async function enqueueObjectCommandEffectJob(
  tx: ObjectCommandEffectTransaction,
  payload: ObjectCommandEffectPayload,
): Promise<string | null> {
  if (payload.effects.length === 0) return null;
  const [inserted] = await tx
    .insert(objectCommandEffectJob)
    .values({
      organizationId: payload.organizationId,
      actorId: payload.actorId,
      commandId: payload.commandId,
      payload,
    })
    .onConflictDoNothing()
    .returning({ id: objectCommandEffectJob.id });
  return inserted?.id ?? null;
}

/** Runtime controls for one command-effect worker batch. */
export interface ProcessObjectCommandEffectJobsOptions {
  /** Maximum jobs to claim in this batch. */
  readonly limit?: number;
  /** Clock override for deterministic workers and tests. */
  readonly now?: Date;
}

/** Counts returned after one command-effect worker batch. */
export interface ProcessObjectCommandEffectJobsResult {
  readonly processed: number;
  readonly succeeded: number;
  readonly failed: number;
}

/** Drain committed canvas command consequences. */
export async function processObjectCommandEffectJobs(
  options: ProcessObjectCommandEffectJobsOptions = {},
): Promise<ProcessObjectCommandEffectJobsResult> {
  const now = options.now ?? new Date();
  const abandonedBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const due = or(
    and(
      inArray(objectCommandEffectJob.status, ['pending', 'failed']),
      lte(objectCommandEffectJob.runAfter, now),
    ),
    and(
      eq(objectCommandEffectJob.status, 'processing'),
      lt(objectCommandEffectJob.lockedAt, abandonedBefore),
    ),
  );
  const jobs = await db
    .select({ id: objectCommandEffectJob.id })
    .from(objectCommandEffectJob)
    .where(due)
    .orderBy(asc(objectCommandEffectJob.createdAt))
    .limit(options.limit ?? 25);
  let succeeded = 0;
  let failed = 0;

  for (const candidate of jobs) {
    const [job] = await db
      .update(objectCommandEffectJob)
      .set({ status: 'processing', lockedAt: now })
      .where(and(eq(objectCommandEffectJob.id, candidate.id), due))
      .returning();
    if (!job) continue;
    try {
      const payload = parseObjectCommandEffectPayload(job.payload);
      for (let index = job.nextEffect; index < payload.effects.length; index += 1) {
        const effect = payload.effects[index];
        if (!effect) throw new Error('Command effect payload contains an empty effect');
        await processObjectCommandEffect(payload, effect);
        await db
          .update(objectCommandEffectJob)
          .set({ nextEffect: index + 1 })
          .where(eq(objectCommandEffectJob.id, job.id));
      }
      await db
        .update(objectCommandEffectJob)
        .set({
          status: 'succeeded',
          processedAt: now,
          lockedAt: null,
          lastError: null,
        })
        .where(eq(objectCommandEffectJob.id, job.id));
      succeeded += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const retryMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
      await db
        .update(objectCommandEffectJob)
        .set({
          status: 'failed',
          attempts,
          lockedAt: null,
          lastError: error instanceof Error ? error.message : String(error),
          runAfter: new Date(now.getTime() + retryMs),
        })
        .where(eq(objectCommandEffectJob.id, job.id));
      failed += 1;
    }
  }
  try {
    await pruneSucceededObjectCommandEffectJobs(now);
  } catch (error) {
    // Cleanup must not turn a successfully drained consequence batch into a failed cron run.
    console.warn('[object-command-effects] succeeded-job cleanup failed', { error });
  }
  return { processed: succeeded + failed, succeeded, failed };
}

async function pruneSucceededObjectCommandEffectJobs(now: Date): Promise<void> {
  const expiredBefore = new Date(now.getTime() - SUCCEEDED_JOB_RETENTION_MS);
  const expired = await db
    .select({ id: objectCommandEffectJob.id })
    .from(objectCommandEffectJob)
    .where(
      and(
        eq(objectCommandEffectJob.status, 'succeeded'),
        lt(objectCommandEffectJob.processedAt, expiredBefore),
      ),
    )
    .orderBy(asc(objectCommandEffectJob.processedAt))
    .limit(SUCCEEDED_JOB_PRUNE_LIMIT);
  if (expired.length === 0) return;
  await db.delete(objectCommandEffectJob).where(
    inArray(
      objectCommandEffectJob.id,
      expired.map((job) => job.id),
    ),
  );
}

function parseObjectCommandEffectPayload(value: unknown): ObjectCommandEffectPayload {
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'version') !== 1 ||
    !Array.isArray(Reflect.get(value, 'effects'))
  ) {
    throw new Error('Command effect payload is invalid');
  }
  return value as ObjectCommandEffectPayload;
}

async function processObjectCommandEffect(
  payload: ObjectCommandEffectPayload,
  effect: unknown,
): Promise<void> {
  const occurredAt = new Date(payload.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error('Command effect time is invalid');
  if (typeof effect !== 'object' || effect === null) {
    throw new Error('Unsupported command effect');
  }
  const kind: unknown = Reflect.get(effect, 'kind');
  if (kind === 'task_state') {
    const taskState = effect as ObjectCommandTaskStateEffect;
    await finishTaskStateConsequences(
      {
        actorId: payload.actorId,
        enqueueSearch: false,
        occurredAt,
        dedupeToken: payload.commandId,
        strict: true,
      },
      reviveTaskStateMutation(taskState.mutation),
    );
    return;
  }
  if (kind === 'task_fields') {
    const taskFields = effect as ObjectCommandTaskFieldsEffect;
    await finishTaskChanges(taskFields.change, {
      occurredAt,
      dedupeToken: payload.commandId,
      strict: true,
    });
    if (taskFields.change.assignmentChanged) {
      await emitEventStrict({
        organizationId: payload.organizationId,
        kind: 'assignment',
        actorId: payload.actorId,
        occurredAt,
        title: taskFields.change.title,
        subject: {
          type: 'task',
          id: taskFields.change.taskId,
          title: taskFields.change.title,
        },
        dedupeToken: payload.commandId,
      });
    }
    return;
  }
  if (kind === 'project_status') {
    const projectStatus = effect as ObjectCommandProjectStatusEffect;
    await emitEventStrict({
      organizationId: payload.organizationId,
      kind: 'status_change',
      actorId: payload.actorId,
      occurredAt,
      title: projectStatus.project.name,
      subject: {
        type: 'project',
        id: projectStatus.project.id,
        title: projectStatus.project.name,
      },
      detail: {
        schema: 'docket.state_change',
        fromState: null,
        toState: projectStatus.project.status,
      },
      dedupeToken: payload.commandId,
    });
    return;
  }
  if (kind === 'entity_write') {
    const entityWrite = effect as ObjectCommandEntityWriteEffect;
    await (entityWrite.operation === 'delete' ? enqueueSearchDelete : enqueueSearchUpsert)(
      payload.organizationId,
      entityWrite.sourceTable,
      entityWrite.entityId,
    );
    return;
  }
  throw new Error('Unsupported command effect');
}

const TASK_ROW_DATE_FIELDS = [
  'createdAt',
  'updatedAt',
  'archivedAt',
  'startDate',
  'dueDate',
  'externalUpdatedAt',
  'lastPushedAt',
  'completedAt',
  'canceledAt',
] as const;

function reviveTaskRow(value: TaskRow): TaskRow {
  const revived = { ...value } as Record<string, unknown>;
  for (const field of TASK_ROW_DATE_FIELDS) {
    const stored = revived[field];
    if (typeof stored === 'string') revived[field] = new Date(stored);
  }
  return revived as TaskRow;
}

function reviveTaskStateMutation(mutation: TaskStateMutation): TaskStateMutation {
  return { before: reviveTaskRow(mutation.before), after: reviveTaskRow(mutation.after) };
}
