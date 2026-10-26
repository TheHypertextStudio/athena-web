import {
  processOccurrence,
  recurrenceSeries,
  recurrenceSeriesRevision,
  template,
  type BlueprintOccurrenceRoot,
  type Database,
} from '@docket/db';
import { AcceptedScheduleClaim } from '@docket/work/work-schedule-claim';
import { BlueprintError } from '@docket/work/blueprints';
import { BlueprintCivilDate } from '@docket/work/work-template-blueprint';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ApiError, ConflictError, NotFoundError } from '../../error';
import type { TemplateTransaction } from '../templates/persistence';
import type { WorkCreationBatchCommand } from '../work-creation/types';
import { authorizeRetainedRecurrence, loadCreationActor } from '../work-creation/context';
import { createWorkBatchInTransaction } from '../work-creation/service';
import { deferWorkCreationEffects } from '../work-creation/effects';
import type { WorkCreationBatchResult } from '../work-creation/types';
import {
  authorizeScheduleContinuity,
  authorizeScheduleExecution,
  type ScheduleAttemptIdentity,
} from './schedule-authority';
import {
  compileScheduleCommand,
  parseScheduleDocument,
  scheduleDocumentRoots,
  scheduleDraftFingerprint,
} from './schedule-compiler';
import { preflightScheduleClaim } from './schedule-preflight';
import { registerNativeScheduleDateOwnership } from './schedule-native-reflow';
import { attachPersistedPrivateScheduleStructures } from './schedule-private-structure';
import { canRetryScheduleOccurrence } from './schedule-run-recovery';
import { resolveMissedScheduleOccurrence } from './schedule-run-resolution';

/** Application-owned failure categories; exception and provider text never enters run storage. */
export type ScheduleFailureCode =
  | 'schedule_permission_changed'
  | 'schedule_unavailable'
  | 'schedule_invalid'
  | 'schedule_limit'
  | 'schedule_execution_failed';
/** Stable expected/provider identity, preserving the existing scheduler's occurrence key semantics. */
export interface ExecuteScheduleOccurrenceCommand {
  readonly organizationId: string;
  readonly seriesId: string;
  readonly seriesRevisionId: string;
  readonly scheduledFor: string;
  readonly originalScheduledFor?: string;
  readonly externalOccurrenceKey?: string;
  /** Internal stable successor identity; never accepted from a public schedule DTO. */
  readonly continuedFromOccurrenceId?: string;
}
/** Current durable run result; complete child identities stay in the private stored receipt. */
export interface ScheduleRunResult {
  readonly occurrenceId: string;
  readonly attempt: number;
  readonly status: (typeof processOccurrence.$inferSelect)['status'];
  readonly failureCode: string | null;
  readonly roots: readonly BlueprintOccurrenceRoot[];
}
function resultOf(row: typeof processOccurrence.$inferSelect): ScheduleRunResult {
  return {
    occurrenceId: row.id,
    attempt: row.attempt,
    status: row.status,
    failureCode: row.failureCode,
    roots: row.blueprintRootRefs ?? [],
  };
}
/** Map only owned classifications; raw errors are never serialized into the occurrence. */
export function scheduleFailureCode(error: unknown): ScheduleFailureCode {
  if (error instanceof BlueprintError)
    return error.code === 'blueprint_limit' ? 'schedule_limit' : 'schedule_invalid';
  if (error instanceof ApiError) {
    if (error.status === 403 || error.status === 401) return 'schedule_permission_changed';
    return error.status === 404 ? 'schedule_unavailable' : 'schedule_invalid';
  }
  return 'schedule_execution_failed';
}
async function lockedRevision(tx: TemplateTransaction, input: ExecuteScheduleOccurrenceCommand) {
  const [series] = await tx
    .select()
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.id, input.seriesId),
        eq(recurrenceSeries.organizationId, input.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  const [revision] = await tx
    .select()
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.id, input.seriesRevisionId),
        eq(recurrenceSeriesRevision.seriesId, input.seriesId),
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
      ),
    )
    .for('update')
    .limit(1);
  if (!series || series.archivedAt || series.status !== 'active' || !revision?.scheduleDraft)
    throw new NotFoundError('Schedule not found');
  return { series, revision };
}
function providerReservationDates(
  row: typeof processOccurrence.$inferSelect,
  input: ExecuteScheduleOccurrenceCommand,
): { scheduledFor?: string; originalScheduledFor?: string } {
  if (!row.externalOccurrenceKey || row.scheduledFor === input.scheduledFor) return {};
  return {
    scheduledFor: input.scheduledFor,
    originalScheduledFor:
      row.originalScheduledFor ?? input.originalScheduledFor ?? row.scheduledFor,
  };
}
async function reserveAttempt(database: Database, input: ExecuteScheduleOccurrenceCommand) {
  return database.transaction(async (tx) => {
    const { revision } = await lockedRevision(tx, input);
    await tx
      .insert(processOccurrence)
      .values({
        organizationId: input.organizationId,
        seriesId: input.seriesId,
        seriesRevisionId: input.seriesRevisionId,
        blueprintInvocationId: revision.blueprintInvocationId,
        scheduledFor: input.scheduledFor,
        originalScheduledFor: input.originalScheduledFor,
        externalOccurrenceKey: input.externalOccurrenceKey,
        continuedFromOccurrenceId: input.continuedFromOccurrenceId,
        runKind: 'scheduled',
      })
      .onConflictDoNothing();
    const where = input.continuedFromOccurrenceId
      ? and(
          eq(processOccurrence.seriesId, input.seriesId),
          eq(processOccurrence.continuedFromOccurrenceId, input.continuedFromOccurrenceId),
        )
      : input.externalOccurrenceKey
        ? and(
            eq(processOccurrence.seriesId, input.seriesId),
            eq(processOccurrence.externalOccurrenceKey, input.externalOccurrenceKey),
          )
        : and(
            eq(processOccurrence.seriesId, input.seriesId),
            eq(processOccurrence.seriesRevisionId, input.seriesRevisionId),
            eq(processOccurrence.scheduledFor, input.scheduledFor),
            isNull(processOccurrence.externalOccurrenceKey),
            isNull(processOccurrence.continuedFromOccurrenceId),
          );
    const [row] = await tx
      .select()
      .from(processOccurrence)
      .where(and(eq(processOccurrence.organizationId, input.organizationId), where))
      .for('update')
      .limit(1);
    if (row?.seriesRevisionId !== input.seriesRevisionId || row.runKind !== 'scheduled')
      throw new ConflictError('The occurrence identity changed.');
    if (row.blueprintAppliedAt || !['expected', 'failed'].includes(row.status))
      return { row, execute: false };
    const [reserved] = await tx
      .update(processOccurrence)
      .set({
        attempt: row.attempt + 1,
        failureCode: null,
        failedAt: null,
        retryAvailableAt: null,
        blueprintInvocationId: revision.blueprintInvocationId,
        ...providerReservationDates(row, input),
      })
      .where(and(eq(processOccurrence.id, row.id), eq(processOccurrence.attempt, row.attempt)))
      .returning();
    if (!reserved) throw new ConflictError('The schedule attempt changed.');
    return { row: reserved, execute: true };
  });
}
/** Locked schedule facts the first claim is compiled from. */
interface ClaimSource {
  readonly organizationId: string;
  readonly series: Awaited<ReturnType<typeof lockedRevision>>['series'];
  readonly revision: Awaited<ReturnType<typeof lockedRevision>>['revision'];
  readonly document: ReturnType<typeof parseScheduleDocument>;
  readonly runDate: string;
}
/** Compile a first claim from the revision, with archive continuity and any private structure. */
async function claimCommand(
  tx: TemplateTransaction,
  source: ClaimSource,
): Promise<WorkCreationBatchCommand> {
  const { organizationId, series, revision, document, runDate } = source;
  const ids = scheduleDocumentRoots(document).map((root) => root.draft.template.workTypeId);
  const definitions = await tx
    .select({
      id: template.id,
      archivedAt: template.archivedAt,
      state: template.publicationState,
    })
    .from(template)
    .where(and(eq(template.organizationId, organizationId), inArray(template.id, ids)));
  const caller = series.createdBy
    ? await loadCreationActor(tx, organizationId, series.createdBy)
    : await authorizeRetainedRecurrence(tx, organizationId, {
        seriesId: series.id,
        revisionId: revision.id,
      });
  const command = definitions.some(
    (definition) => definition.archivedAt !== null || definition.state === 'archived',
  )
    ? await authorizeScheduleContinuity(tx, {
        organizationId,
        seriesRevisionId: revision.id,
        runDate,
      })
    : compileScheduleCommand({
        caller,
        seriesId: series.id,
        ownerProgramId: series.ownerProgramId,
        document,
        runDate,
      });
  return attachPersistedPrivateScheduleStructures(tx, command, {
    organizationId,
    seriesId: series.id,
    invocationId: revision.blueprintInvocationId,
  });
}
async function acceptClaim(
  database: Database,
  input: ExecuteScheduleOccurrenceCommand,
  identity: ScheduleAttemptIdentity,
): Promise<void> {
  await database.transaction(async (tx) => {
    const { series, revision } = await lockedRevision(tx, input);
    const [occurrence] = await tx
      .select()
      .from(processOccurrence)
      .where(
        and(
          eq(processOccurrence.id, identity.occurrenceId),
          eq(processOccurrence.organizationId, identity.organizationId),
        ),
      )
      .for('update')
      .limit(1);
    if (occurrence?.attempt !== identity.attempt || occurrence.runKind !== 'scheduled')
      throw new ConflictError('The schedule attempt changed.');
    if (occurrence.acceptedClaim) return;
    const document = parseScheduleDocument(revision.scheduleDraft);
    const command = await claimCommand(tx, {
      organizationId: input.organizationId,
      series,
      revision,
      document,
      runDate: occurrence.scheduledFor,
    });
    const roots = await preflightScheduleClaim(tx, command, document);
    const claim = AcceptedScheduleClaim.parse({
      kind: 'schedule',
      revision: 1,
      sourceInvocationId: revision.blueprintInvocationId,
      seriesRevisionId: revision.id,
      runDate: occurrence.scheduledFor,
      timezone: scheduleDocumentRoots(document)[0]?.draft.timezone,
      draftFingerprint: scheduleDraftFingerprint(document),
      roots,
    });
    await tx
      .update(processOccurrence)
      .set({ acceptedClaim: claim, acceptedAt: new Date() })
      .where(
        and(
          eq(processOccurrence.id, occurrence.id),
          eq(processOccurrence.attempt, identity.attempt),
          isNull(processOccurrence.acceptedClaim),
        ),
      );
  });
}
function rootReferences(result: WorkCreationBatchResult): BlueprintOccurrenceRoot[] {
  return [...result.rootsByKey].map(([key, root]) => {
    if (root.kind !== 'task' && root.kind !== 'project')
      throw new ConflictError('The schedule root kind changed.');
    const selectedWork = (result.selectedWorkByKey.get(key) ?? []).map((entry) => {
      if (entry.kind === 'initiative') throw new ConflictError('The schedule child kind changed.');
      return { ...entry, kind: entry.kind };
    });
    return {
      key,
      kind: root.kind,
      id: root.id,
      resolvedManifest: result.resolvedManifestsByKey.get(key) ?? [],
      selectedWork,
    };
  });
}
async function applyClaim(
  database: Database,
  identity: ScheduleAttemptIdentity,
): Promise<ScheduleRunResult> {
  const committed = await database.transaction(async (tx) => {
    const command = await authorizeScheduleExecution(tx, identity);
    const created = await createWorkBatchInTransaction(tx, command);
    const [row] = await tx
      .update(processOccurrence)
      .set({
        status: 'materialized',
        blueprintAppliedAt: new Date(),
        blueprintRootRefs: rootReferences(created),
        failureCode: null,
        failedAt: null,
        retryAvailableAt: null,
      })
      .where(
        and(
          eq(processOccurrence.id, identity.occurrenceId),
          eq(processOccurrence.organizationId, identity.organizationId),
          eq(processOccurrence.attempt, identity.attempt),
          isNull(processOccurrence.blueprintAppliedAt),
        ),
      )
      .returning();
    if (!row) throw new ConflictError('The schedule attempt changed.');
    await registerNativeScheduleDateOwnership(tx, {
      organizationId: identity.organizationId,
      occurrenceId: identity.occurrenceId,
    });
    return { row, effects: created.effects };
  });
  deferWorkCreationEffects(committed.effects);
  return resultOf(committed.row);
}
async function recordFailure(
  database: Database,
  identity: ScheduleAttemptIdentity,
  error: unknown,
): Promise<ScheduleRunResult> {
  return database.transaction(async (tx) => {
    const [row] = await tx
      .update(processOccurrence)
      .set({
        status: 'failed',
        failedAt: new Date(),
        failureCode: scheduleFailureCode(error),
        retryAvailableAt: new Date(),
      })
      .where(
        and(
          eq(processOccurrence.id, identity.occurrenceId),
          eq(processOccurrence.organizationId, identity.organizationId),
          eq(processOccurrence.runKind, 'scheduled'),
          eq(processOccurrence.attempt, identity.attempt),
          isNull(processOccurrence.blueprintAppliedAt),
        ),
      )
      .returning();
    if (!row) throw new ConflictError('The schedule attempt changed.');
    return resultOf(row);
  });
}
/** Commit the accepted closure before work; record rolled-back work failures separately with attempt CAS. */
export async function executeScheduleOccurrence(
  database: Database,
  input: ExecuteScheduleOccurrenceCommand,
): Promise<ScheduleRunResult> {
  BlueprintCivilDate.parse(input.scheduledFor);
  if (input.originalScheduledFor) BlueprintCivilDate.parse(input.originalScheduledFor);
  const reserved = await reserveAttempt(database, input);
  if (!reserved.execute) return resultOf(reserved.row);
  const identity = {
    organizationId: input.organizationId,
    occurrenceId: reserved.row.id,
    attempt: reserved.row.attempt,
  };
  try {
    await acceptClaim(database, input, identity);
    return await applyClaim(database, identity);
  } catch (error) {
    return recordFailure(database, identity, error);
  }
}
/** Retry failed work or explicitly resolve a missed run; accepted closure data is never caller-supplied. */
export async function retryScheduleOccurrence(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly occurrenceId: string;
    readonly actorId?: string;
  },
): Promise<ScheduleRunResult> {
  const [row] = await database
    .select()
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.id, input.occurrenceId),
        eq(processOccurrence.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (
    row?.runKind !== 'scheduled' ||
    !row.seriesId ||
    !row.seriesRevisionId ||
    !canRetryScheduleOccurrence(row)
  )
    throw new NotFoundError('Recoverable schedule run not found');
  if (row.status === 'needs_resolution') {
    if (!input.actorId) throw new NotFoundError('Reviewed schedule run not found');
    await resolveMissedScheduleOccurrence(database, {
      organizationId: input.organizationId,
      actorId: input.actorId,
      seriesId: row.seriesId,
      seriesRevisionId: row.seriesRevisionId,
      occurrenceId: row.id,
    });
  }
  return executeScheduleOccurrence(database, {
    organizationId: input.organizationId,
    seriesId: row.seriesId,
    seriesRevisionId: row.seriesRevisionId,
    scheduledFor: row.scheduledFor,
    ...(row.originalScheduledFor ? { originalScheduledFor: row.originalScheduledFor } : {}),
    ...(row.externalOccurrenceKey ? { externalOccurrenceKey: row.externalOccurrenceKey } : {}),
    ...(row.continuedFromOccurrenceId
      ? { continuedFromOccurrenceId: row.continuedFromOccurrenceId }
      : {}),
  });
}
