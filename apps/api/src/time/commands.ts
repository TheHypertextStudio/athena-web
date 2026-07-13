/**
 * `time/commands` — transactional writes to the personal Time Ledger.
 *
 * @remarks
 * This module owns state transitions and normalized fact writes only. Authorization lives in
 * {@link ./access}, while public record/category serialization comes from {@link ./read-models}.
 * Keeping those concerns apart makes it possible to add a Time entry point without accidentally
 * bypassing Hub ownership, context validation, or read-time privacy policy.
 */
import {
  db,
  timeAllocation,
  timeCategory,
  timeContext,
  timeInterval,
  timeRecord,
} from '@docket/db';
import type {
  TimeAllocationReplace,
  TimeCategoryCreate,
  TimeContextCreate,
  TimeIntervalCreate,
  TimeRecordCreate,
  TimeRecordOut,
  TimeRecordUpdate,
} from '@docket/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';
import {
  assertOwnedTimeCategory,
  type PreparedTimeContext,
  prepareInitialTimeContexts,
  resolveTimeHubId,
  validateTimeAllocationTarget,
  validateTimeContext,
} from './access';
import { hydrateTimeRecords, toTimeCategoryOut } from './read-models';

type TimeRecordRow = typeof timeRecord.$inferSelect;
type TimeRecordInput = z.input<typeof TimeRecordOut>;
type TimeRecordCreateInput = z.input<typeof TimeRecordCreate>;
type TimeCategoryInput = ReturnType<typeof toTimeCategoryOut>;

/** Load a record under its Hub boundary or hide it as not found. */
async function getOwnedRecord(id: string, hubId: string): Promise<TimeRecordRow> {
  const rows = await db
    .select()
    .from(timeRecord)
    .where(and(eq(timeRecord.id, id), eq(timeRecord.hubId, hubId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Time record not found');
  return row;
}

/** Hydrate one record through the shared read model, applying the current user's context policy. */
async function toTimeRecordOut(
  record: TimeRecordRow,
  userId: string,
  now = new Date(),
): Promise<TimeRecordInput> {
  const [hydrated] = await hydrateTimeRecords([record], userId, now);
  if (!hydrated) throw new NotFoundError('Time record not found');
  return hydrated;
}

/** Insert a validated typed context while preserving its trusted organization scope. */
async function insertContext(
  recordId: string,
  userId: string,
  input: TimeContextCreate,
): Promise<void> {
  const organizationId = await validateTimeContext(userId, input);
  await db.insert(timeContext).values({
    timeRecordId: recordId,
    role: input.role,
    entityKind: input.entityRef.kind,
    sourceSystem: input.entityRef.source,
    externalId: input.entityRef.externalId,
    titleSnapshot: input.entityRef.title,
    urlSnapshot: input.entityRef.url,
    docketEntityId: input.entityRef.docketEntityId,
    organizationId,
    createdByUserId: userId,
  });
}

/** Seed a reportable allocation only when the launch explicitly named a Docket task or workspace. */
function defaultAllocationFromContexts(
  contexts: readonly PreparedTimeContext[],
): { targetKind: 'task' | 'workspace'; targetId: string; organizationId: string } | null {
  const primary = contexts.find(
    (context) =>
      context.role === 'primary' &&
      context.entityRef.source === 'docket' &&
      context.entityRef.kind === 'work_item' &&
      context.entityRef.docketEntityId !== null &&
      context.organizationId !== null,
  );
  if (primary?.entityRef.docketEntityId && primary.organizationId) {
    return {
      targetKind: 'task',
      targetId: primary.entityRef.docketEntityId,
      organizationId: primary.organizationId,
    };
  }
  const workspace = contexts.find(
    (context) =>
      context.entityRef.source === 'docket' &&
      context.entityRef.kind === 'organization' &&
      context.entityRef.docketEntityId !== null &&
      context.organizationId !== null,
  );
  if (workspace?.entityRef.docketEntityId && workspace.organizationId) {
    return {
      targetKind: 'workspace',
      targetId: workspace.entityRef.docketEntityId,
      organizationId: workspace.organizationId,
    };
  }
  return null;
}

/** Refresh a record's envelope from its non-superseded exact intervals. */
async function refreshRecordEnvelope(recordId: string, now: Date): Promise<void> {
  const intervals = await db
    .select()
    .from(timeInterval)
    .where(and(eq(timeInterval.timeRecordId, recordId), isNull(timeInterval.supersededById)));
  if (intervals.length === 0) return;
  const starts = intervals.map((interval) => interval.startedAt.getTime());
  const ends = intervals.map((interval) => (interval.endedAt ?? now).getTime());
  await db
    .update(timeRecord)
    .set({ startedAt: new Date(Math.min(...starts)), endedAt: new Date(Math.max(...ends)) })
    .where(eq(timeRecord.id, recordId));
}

/** Create a live timer or a closed historical/reconstructed record. */
export async function createTimeRecord(
  userId: string,
  input: TimeRecordCreateInput,
): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  await assertOwnedTimeCategory(input.context.suggestedCategoryId, hubId);
  const now = new Date();
  const live = input.startNow !== false;
  const captureSource = input.captureSource ?? (live ? 'live' : 'manual');
  const historicalStart = input.startsAt ? new Date(input.startsAt) : null;
  const historicalEnd = input.endsAt ? new Date(input.endsAt) : null;
  if (!live && (!historicalStart || !historicalEnd)) {
    throw new Error('Validated historical time was missing its bounds');
  }
  const contexts = await prepareInitialTimeContexts(userId, input.context);
  const defaultAllocation = defaultAllocationFromContexts(contexts);
  const record = await db.transaction(async (tx) => {
    if (live) {
      const active = await tx
        .select({ recordId: timeInterval.timeRecordId })
        .from(timeInterval)
        .where(
          and(
            eq(timeInterval.hubId, hubId),
            eq(timeInterval.userId, userId),
            eq(timeInterval.mode, 'human_active'),
            isNull(timeInterval.endedAt),
          ),
        );
      const recordIds = [...new Set(active.map((entry) => entry.recordId))];
      if (recordIds.length > 0) {
        await tx
          .update(timeInterval)
          .set({ endedAt: now, closedAt: now })
          .where(
            and(
              eq(timeInterval.hubId, hubId),
              eq(timeInterval.userId, userId),
              eq(timeInterval.mode, 'human_active'),
              isNull(timeInterval.endedAt),
            ),
          );
        await tx
          .update(timeRecord)
          .set({ status: 'paused' })
          .where(inArray(timeRecord.id, recordIds));
      }
    }
    const [inserted] = await tx
      .insert(timeRecord)
      .values({
        hubId,
        createdByUserId: userId,
        title: input.context.label,
        status: live ? 'open' : 'closed',
        categoryId: input.context.suggestedCategoryId ?? null,
        captureSource,
        ...(live
          ? { startedAt: now }
          : { startedAt: historicalStart, endedAt: historicalEnd, closedAt: now }),
      })
      .returning();
    if (!inserted) throw new Error('time record insert returned no row');
    if (contexts.length > 0) {
      await tx.insert(timeContext).values(
        contexts.map((context) => ({
          timeRecordId: inserted.id,
          role: context.role,
          entityKind: context.entityRef.kind,
          sourceSystem: context.entityRef.source,
          externalId: context.entityRef.externalId,
          titleSnapshot: context.entityRef.title,
          urlSnapshot: context.entityRef.url,
          docketEntityId: context.entityRef.docketEntityId,
          organizationId: context.organizationId,
          createdByUserId: userId,
        })),
      );
    }
    if (defaultAllocation) {
      await tx.insert(timeAllocation).values({
        timeRecordId: inserted.id,
        targetKind: defaultAllocation.targetKind,
        targetId: defaultAllocation.targetId,
        organizationId: defaultAllocation.organizationId,
        basisPoints: 10_000,
      });
    }
    await tx.insert(timeInterval).values({
      timeRecordId: inserted.id,
      hubId,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: live
        ? 'user_timer'
        : captureSource === 'reconstructed'
          ? 'reconstructed_entry'
          : 'manual_entry',
      startedAt: live ? now : (historicalStart ?? now),
      ...(live ? {} : { endedAt: historicalEnd ?? now, closedAt: now }),
    });
    return inserted;
  });
  return toTimeRecordOut(record, userId, now);
}

/** Start or resume a paused record, atomically switching away from any other user tracker. */
export async function startTimeRecord(userId: string, id: string): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(id, hubId);
  if (
    record.status === 'closed' ||
    record.status === 'submitted' ||
    record.status === 'superseded'
  ) {
    throw new ConflictError('Closed time records cannot be resumed');
  }
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const alreadyActive = await tx
      .select({ id: timeInterval.id })
      .from(timeInterval)
      .where(
        and(
          eq(timeInterval.timeRecordId, id),
          eq(timeInterval.userId, userId),
          eq(timeInterval.mode, 'human_active'),
          isNull(timeInterval.endedAt),
        ),
      )
      .limit(1);
    if (alreadyActive[0]) return record;
    const active = await tx
      .select({ recordId: timeInterval.timeRecordId })
      .from(timeInterval)
      .where(
        and(
          eq(timeInterval.hubId, hubId),
          eq(timeInterval.userId, userId),
          eq(timeInterval.mode, 'human_active'),
          isNull(timeInterval.endedAt),
        ),
      );
    const recordIds = [...new Set(active.map((entry) => entry.recordId))];
    if (recordIds.length > 0) {
      await tx
        .update(timeInterval)
        .set({ endedAt: now, closedAt: now })
        .where(
          and(
            eq(timeInterval.hubId, hubId),
            eq(timeInterval.userId, userId),
            eq(timeInterval.mode, 'human_active'),
            isNull(timeInterval.endedAt),
          ),
        );
      await tx
        .update(timeRecord)
        .set({ status: 'paused' })
        .where(inArray(timeRecord.id, recordIds));
    }
    await tx.insert(timeInterval).values({
      timeRecordId: id,
      hubId,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt: now,
    });
    const [resumed] = await tx
      .update(timeRecord)
      .set({ status: 'open', startedAt: record.startedAt ?? now, endedAt: null, closedAt: null })
      .where(eq(timeRecord.id, id))
      .returning();
    if (!resumed) throw new NotFoundError('Time record not found');
    return resumed;
  });
  return toTimeRecordOut(updated, userId, now);
}

/** Close the caller's active human interval while keeping the record resumable. */
export async function pauseTimeRecord(userId: string, id: string): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  await getOwnedRecord(id, hubId);
  const now = new Date();
  const closed = await db
    .update(timeInterval)
    .set({ endedAt: now, closedAt: now })
    .where(
      and(
        eq(timeInterval.timeRecordId, id),
        eq(timeInterval.userId, userId),
        eq(timeInterval.mode, 'human_active'),
        isNull(timeInterval.endedAt),
      ),
    )
    .returning();
  if (!closed[0]) throw new ConflictError('Time record is not actively tracking');
  const [updated] = await db
    .update(timeRecord)
    .set({ status: 'paused' })
    .where(eq(timeRecord.id, id))
    .returning();
  if (!updated) throw new NotFoundError('Time record not found');
  await refreshRecordEnvelope(id, now);
  return toTimeRecordOut(updated, userId, now);
}

/** Stop the caller's record and close its human tracker. */
export async function stopTimeRecord(userId: string, id: string): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(id, hubId);
  if (record.status === 'submitted' || record.status === 'superseded') {
    throw new ConflictError('This time record can no longer be changed');
  }
  const now = new Date();
  await db
    .update(timeInterval)
    .set({ endedAt: now, closedAt: now })
    .where(
      and(
        eq(timeInterval.timeRecordId, id),
        eq(timeInterval.userId, userId),
        eq(timeInterval.mode, 'human_active'),
        isNull(timeInterval.endedAt),
      ),
    );
  await refreshRecordEnvelope(id, now);
  const [updated] = await db
    .update(timeRecord)
    .set({ status: 'closed', closedAt: now, endedAt: now })
    .where(eq(timeRecord.id, id))
    .returning();
  if (!updated) throw new NotFoundError('Time record not found');
  return toTimeRecordOut(updated, userId, now);
}

/** Edit only the semantic, user-controlled fields of a record. */
export async function updateTimeRecord(
  userId: string,
  id: string,
  input: TimeRecordUpdate,
): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  await getOwnedRecord(id, hubId);
  if (input.categoryId !== undefined) await assertOwnedTimeCategory(input.categoryId, hubId);
  const [updated] = await db
    .update(timeRecord)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.outcomeNote !== undefined ? { outcomeNote: input.outcomeNote } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    })
    .where(and(eq(timeRecord.id, id), eq(timeRecord.hubId, hubId)))
    .returning();
  if (!updated) throw new NotFoundError('Time record not found');
  return toTimeRecordOut(updated, userId);
}

/** Add one explicitly manual/reconstructed exact interval to a record. */
export async function addHistoricalInterval(
  userId: string,
  id: string,
  input: TimeIntervalCreate,
): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(id, hubId);
  if (record.status === 'submitted' || record.status === 'superseded') {
    throw new ConflictError('This time record can no longer be changed');
  }
  const now = new Date();
  await db.insert(timeInterval).values({
    timeRecordId: id,
    hubId,
    actorKind: 'human',
    userId,
    mode: 'human_active',
    source: input.source,
    startedAt: new Date(input.startsAt),
    endedAt: new Date(input.endsAt),
    closedAt: now,
  });
  await refreshRecordEnvelope(id, now);
  const [updated] = await db
    .update(timeRecord)
    .set({ status: record.status === 'open' ? 'open' : 'closed' })
    .where(eq(timeRecord.id, id))
    .returning();
  if (!updated) throw new NotFoundError('Time record not found');
  return toTimeRecordOut(updated, userId, now);
}

/** Attach a validated typed context; context and allocation remain intentionally separate. */
export async function addTimeContext(
  userId: string,
  id: string,
  input: TimeContextCreate,
): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(id, hubId);
  await insertContext(id, userId, input);
  return toTimeRecordOut(record, userId);
}

/** Delete a context only from a record owned by the caller's Hub. */
export async function removeTimeContext(
  userId: string,
  recordId: string,
  contextId: string,
): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(recordId, hubId);
  const deleted = await db
    .delete(timeContext)
    .where(and(eq(timeContext.id, contextId), eq(timeContext.timeRecordId, recordId)))
    .returning({ id: timeContext.id });
  if (!deleted[0]) throw new NotFoundError('Time context not found');
  return toTimeRecordOut(record, userId);
}

/** Replace an allocation set atomically after Zod has proved its 100% invariant. */
export async function replaceTimeAllocations(
  userId: string,
  id: string,
  input: TimeAllocationReplace,
): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(id, hubId);
  if (record.status === 'submitted' || record.status === 'superseded') {
    throw new ConflictError('This time record can no longer be changed');
  }
  const allocations = await Promise.all(
    input.allocations.map(async (allocation) => ({
      ...allocation,
      organizationId: await validateTimeAllocationTarget(userId, hubId, allocation),
    })),
  );
  await db.transaction(async (tx) => {
    await tx.delete(timeAllocation).where(eq(timeAllocation.timeRecordId, id));
    if (allocations.length > 0) {
      await tx.insert(timeAllocation).values(
        allocations.map((allocation) => ({
          timeRecordId: id,
          targetKind: allocation.targetKind,
          targetId: allocation.targetId,
          organizationId: allocation.organizationId,
          basisPoints: allocation.basisPoints,
        })),
      );
    }
  });
  return toTimeRecordOut(record, userId);
}

/** Create one Hub-owned category, validating an optional parent remains in the same Hub. */
export async function createTimeCategory(
  userId: string,
  input: TimeCategoryCreate,
): Promise<TimeCategoryInput> {
  const hubId = await resolveTimeHubId(userId);
  if (input.parentId) await assertOwnedTimeCategory(input.parentId, hubId);
  const [created] = await db
    .insert(timeCategory)
    .values({
      hubId,
      name: input.name,
      color: input.color ?? null,
      parentId: input.parentId ?? null,
      sort: input.sort ?? 0,
    })
    .returning();
  if (!created) throw new Error('time category insert returned no row');
  return toTimeCategoryOut(created);
}
