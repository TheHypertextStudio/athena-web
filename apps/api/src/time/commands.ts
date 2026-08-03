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
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';
import { emitTimerEvent } from '../routes/event-emit';
import {
  assertOwnedTimeCategory,
  prepareInitialTimeContexts,
  resolveTimeHubId,
  validateTimeAllocationTarget,
  validateTimeContext,
} from './access';
import { hydrateTimeRecords, toTimeCategoryOut } from './read-models';
import { readTaskAnchor, requireTrackingName, resolveTaskAnchor } from './task-anchor';
import { type JoinCandidate, shouldJoinSegment } from './timer-join';

type TimeRecordRow = typeof timeRecord.$inferSelect;
type TimeRecordInput = z.input<typeof TimeRecordOut>;
type TimeRecordCreateInput = z.input<typeof TimeRecordCreate>;
type TimeCategoryInput = ReturnType<typeof toTimeCategoryOut>;

/**
 * Announce one timer transition on the shared event bus.
 *
 * @remarks
 * Every lifecycle command funnels through here so the five transitions cannot drift apart, and
 * so a new command physically cannot be added without deciding which transition it is. The
 * reported `elapsedMs` is the record's **human effort** — the number the timer face shows — not
 * its wall-clock envelope, because a consumer reacting to "you have been on this for 90 minutes"
 * means time actually tracked, not time since the session opened.
 *
 * Emission is deliberately after the write and outside its transaction: the ledger is the source
 * of truth, and a bus hiccup must never roll back a person's tracked time.
 */
async function announceTimer(
  kind: 'timer_started' | 'timer_paused' | 'timer_resumed' | 'timer_switched' | 'timer_stopped',
  record: TimeRecordInput,
  options: {
    readonly userId: string;
    readonly organizationId: string;
    readonly actorId: string | null;
    readonly occurredAt: Date;
    readonly previousTimeRecordId?: string | null;
  },
): Promise<void> {
  await emitTimerEvent({
    organizationId: options.organizationId,
    kind,
    userId: options.userId,
    actorId: options.actorId,
    occurredAt: options.occurredAt,
    tracked: { type: 'task', id: record.taskId, title: record.title },
    timeRecordId: record.id,
    previousTimeRecordId: options.previousTimeRecordId ?? null,
    elapsedMs: record.measures.humanEffortMs,
    trackedLabel: record.title,
  });
}

/** The caller's most recent human segment, whatever task it was on. */
async function latestHumanSegment(hubId: string, userId: string): Promise<JoinCandidate | null> {
  const rows = await db
    .select({
      id: timeInterval.id,
      taskId: timeInterval.taskId,
      endedAt: timeInterval.endedAt,
      timeRecordId: timeInterval.timeRecordId,
    })
    .from(timeInterval)
    .where(
      and(
        eq(timeInterval.hubId, hubId),
        eq(timeInterval.userId, userId),
        eq(timeInterval.mode, 'human_active'),
        isNull(timeInterval.supersededById),
      ),
    )
    .orderBy(desc(timeInterval.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** The most recent human segment on one record. */
async function latestSegmentForRecord(recordId: string): Promise<JoinCandidate | null> {
  const rows = await db
    .select({ id: timeInterval.id, taskId: timeInterval.taskId, endedAt: timeInterval.endedAt })
    .from(timeInterval)
    .where(
      and(
        eq(timeInterval.timeRecordId, recordId),
        eq(timeInterval.mode, 'human_active'),
        isNull(timeInterval.supersededById),
      ),
    )
    .orderBy(desc(timeInterval.startedAt))
    .limit(1);
  // A record's creation transaction always inserts its first `human_active` interval (see
  // `createTimeRecord` below), and no route ever hard-deletes an interval — only supersedes it in
  // place. A record reachable here (past `getOwnedRecord`) therefore always has at least one row.
  /* v8 ignore next -- @preserve defensive: every owned record has at least one human_active interval */
  return rows[0] ?? null;
}

/** Read a Docket task id out of a typed primary context, when the caller supplied one that way. */
function taskIdFromPrimaryRef(
  primaryRef: TimeRecordCreateInput['context']['primaryRef'],
): string | undefined {
  if (!primaryRef) return undefined;
  if (primaryRef.source !== 'docket' || primaryRef.kind !== 'work_item') return undefined;
  // `externalId` is required on an `EntityRef`, so the second arm is the fallback, not a guard.
  return primaryRef.docketEntityId ?? primaryRef.externalId;
}

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
  // `hydrateTimeRecords` maps its input array 1:1 to its output array; passing exactly one record
  // always yields exactly one hydrated record back.
  /* v8 ignore next -- @preserve defensive: hydrateTimeRecords always returns one row per input */
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

/** Refresh a record's envelope from its non-superseded exact intervals. */
async function refreshRecordEnvelope(recordId: string, now: Date): Promise<void> {
  const intervals = await db
    .select()
    .from(timeInterval)
    .where(and(eq(timeInterval.timeRecordId, recordId), isNull(timeInterval.supersededById)));
  // Every call site runs immediately after mutating this record's intervals (adding, closing, or
  // reopening one), so a non-superseded interval always exists by the time this query runs.
  /* v8 ignore next -- @preserve defensive: caller always leaves at least one live interval */
  if (intervals.length === 0) return;
  const starts = intervals.map((interval) => interval.startedAt.getTime());
  const ends = intervals.map((interval) => (interval.endedAt ?? now).getTime());
  await db
    .update(timeRecord)
    .set({ startedAt: new Date(Math.min(...starts)), endedAt: new Date(Math.max(...ends)) })
    .where(eq(timeRecord.id, recordId));
}

/**
 * Close every open human segment for one user, returning the records that were tracking.
 *
 * @remarks
 * This is the switch half of "start tracking something else": exactly one human segment may be
 * open per Hub, so beginning anything new has to hand off from whatever was running. Doing it in
 * the same transaction as the new segment is what makes the handoff exact — there is no instant
 * at which two segments are open, and none at which neither is.
 */
async function closeOpenHumanSegments(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  hubId: string,
  userId: string,
  now: Date,
): Promise<string[]> {
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
  if (recordIds.length === 0) return [];
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
  await tx.update(timeRecord).set({ status: 'paused' }).where(inArray(timeRecord.id, recordIds));
  return recordIds;
}

/**
 * Create a live timer or a closed historical/reconstructed record.
 *
 * @remarks
 * Live creation is the universal timer's entry point, and it does three things a plain insert
 * would not:
 *
 * - **It anchors to a real Task.** `context.taskId` (or a `work_item` primary ref) tracks
 *   existing work; a bare label creates an ordinary task from those words. Either way the
 *   session has a first-class subject, which is what lets a segment carry a task and a breakdown
 *   roll up through project → program → initiative → workspace.
 * - **It applies the sub-minute continuation rule.** Starting the same task again within
 *   {@link ./timer-join.TIMER_JOIN_WINDOW_MS} of the last segment ending REOPENS that segment
 *   and returns its record, rather than minting a second record with a gap between them. The
 *   caller sees one continuous stretch because that is what the storage now holds.
 * - **It hands off atomically.** Anything already tracking is closed in the same transaction, and
 *   the transition is announced as a single `timer_switched` — never a stop plus a start, which
 *   would let a consumer count the same seconds twice.
 *
 * @param userId - The tracking user.
 * @param input - The typed create body.
 * @returns the live (or historical) record.
 */
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
  const anchor = await resolveTaskAnchor(userId, {
    taskId: input.context.taskId ?? taskIdFromPrimaryRef(input.context.primaryRef),
    organizationId: input.context.organizationId,
    label: input.context.label,
  });
  const contexts = await prepareInitialTimeContexts(userId, input.context);
  // The anchor IS the subject, so it is also the reportable credit. Deriving the allocation from
  // context instead would let a record's contexts and its rollup disagree about what was worked
  // on — the exact ambiguity a NOT NULL anchor exists to remove.
  const defaultAllocation = {
    targetKind: 'task' as const,
    targetId: anchor.taskId,
    organizationId: anchor.organizationId,
  };

  if (live) {
    const candidate = await latestHumanSegment(hubId, userId);
    if (candidate && shouldJoinSegment(candidate, anchor.taskId, now)) {
      const joined = await resumeJoinedSegment(userId, hubId, candidate, now);
      if (joined) return joined;
    }
  }

  const outcome = await db.transaction(async (tx) => {
    const switchedFrom = live ? await closeOpenHumanSegments(tx, hubId, userId, now) : [];
    const [inserted] = await tx
      .insert(timeRecord)
      .values({
        hubId,
        createdByUserId: userId,
        taskId: anchor.taskId,
        title: input.context.label.trim(),
        status: live ? 'open' : 'closed',
        categoryId: input.context.suggestedCategoryId ?? null,
        captureSource,
        ...(live
          ? { startedAt: now }
          : { startedAt: historicalStart, endedAt: historicalEnd, closedAt: now }),
      })
      .returning();
    /* v8 ignore next -- @preserve defensive: insert always returns a row */
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
    await tx.insert(timeAllocation).values({
      timeRecordId: inserted.id,
      targetKind: defaultAllocation.targetKind,
      targetId: defaultAllocation.targetId,
      organizationId: defaultAllocation.organizationId,
      basisPoints: 10_000,
    });
    await tx.insert(timeInterval).values({
      timeRecordId: inserted.id,
      hubId,
      taskId: anchor.taskId,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: live
        ? 'user_timer'
        : captureSource === 'reconstructed'
          ? 'reconstructed_entry'
          : 'manual_entry',
      // The guard above (`!live && (!historicalStart || !historicalEnd)`) already proved both are
      // non-null on every path that reaches here with `live` false, so these are unreachable.
      /* v8 ignore next 2 -- @preserve defensive: historical bounds are already validated non-null */
      startedAt: live ? now : (historicalStart ?? now),
      ...(live ? {} : { endedAt: historicalEnd ?? now, closedAt: now }),
    });
    return { record: inserted, switchedFrom };
  });
  const hydrated = await toTimeRecordOut(outcome.record, userId, now);
  if (live) {
    const previous = outcome.switchedFrom[0] ?? null;
    await announceTimer(previous ? 'timer_switched' : 'timer_started', hydrated, {
      userId,
      organizationId: anchor.organizationId,
      actorId: anchor.actorId,
      occurredAt: now,
      previousTimeRecordId: previous,
    });
  }
  return hydrated;
}

/**
 * Reopen a segment that ended moments ago, so the interruption leaves no seam.
 *
 * @remarks
 * The reopened segment's `endedAt`/`closedAt` are cleared, which is why the storage keeps its
 * promise that the persisted segments are exactly the segments a report sums — a joined resume
 * produces no second row to reconcile away later. Returns `null` when another writer closed the
 * window first (a concurrent start), so the caller falls through to the ordinary path instead of
 * silently doing nothing.
 */
async function resumeJoinedSegment(
  userId: string,
  hubId: string,
  candidate: JoinCandidate,
  now: Date,
): Promise<TimeRecordInput | null> {
  const outcome = await db.transaction(async (tx) => {
    const switchedFrom = await closeOpenHumanSegments(tx, hubId, userId, now);
    const reopened = await tx
      .update(timeInterval)
      .set({ endedAt: null, closedAt: null })
      .where(and(eq(timeInterval.id, candidate.id), isNull(timeInterval.supersededById)))
      .returning({ recordId: timeInterval.timeRecordId });
    const recordId = reopened[0]?.recordId;
    if (!recordId) return null;
    const [record] = await tx
      .update(timeRecord)
      .set({ status: 'open', endedAt: null, closedAt: null })
      .where(eq(timeRecord.id, recordId))
      .returning();
    return record ? { record, switchedFrom } : null;
  });
  if (!outcome) return null;
  const hydrated = await toTimeRecordOut(outcome.record, userId, now);
  const anchor = await readTaskAnchor(hydrated.taskId);
  if (anchor) {
    const previous = outcome.switchedFrom.find((id) => id !== hydrated.id) ?? null;
    await announceTimer(previous ? 'timer_switched' : 'timer_resumed', hydrated, {
      userId,
      organizationId: anchor.organizationId,
      actorId: null,
      occurredAt: now,
      previousTimeRecordId: previous,
    });
  }
  return hydrated;
}

/**
 * Start or resume a paused record, atomically switching away from any other user tracker.
 *
 * @remarks
 * Resuming applies the same sub-minute continuation rule as a fresh start: if this record's last
 * segment closed under a minute ago, that segment is reopened rather than a new one appended, so
 * a brief interruption never fragments the history.
 */
export async function startTimeRecord(userId: string, id: string): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(id, hubId);
  if (record.status === 'submitted' || record.status === 'superseded') {
    throw new ConflictError('This time record can no longer be changed');
  }
  const now = new Date();
  const alreadyActive = await db
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
  if (alreadyActive[0]) return toTimeRecordOut(record, userId, now);

  // The continuation rule is checked BEFORE the closed-record guard, deliberately: a session
  // stopped forty seconds ago and restarted is the interruption the rule exists for, and
  // refusing it as "closed" would fragment exactly the history it was written to keep whole.
  const candidate = await latestSegmentForRecord(id);
  if (candidate && shouldJoinSegment(candidate, record.taskId, now)) {
    const joined = await resumeJoinedSegment(userId, hubId, candidate, now);
    if (joined) return joined;
  }
  if (record.status === 'closed') {
    throw new ConflictError('Closed time records cannot be resumed');
  }

  const outcome = await db.transaction(async (tx) => {
    const switchedFrom = await closeOpenHumanSegments(tx, hubId, userId, now);
    await tx.insert(timeInterval).values({
      timeRecordId: id,
      hubId,
      taskId: record.taskId,
      actorKind: 'human',
      userId,
      mode: 'human_active',
      source: 'user_timer',
      startedAt: now,
    });
    const [resumed] = await tx
      .update(timeRecord)
      .set({
        status: 'open',
        // The column is nullable at the type level, but every insert in this module always sets
        // it and no update ever clears it, so a record reachable here always already has one.
        /* v8 ignore next -- @preserve defensive: startedAt is always set once a record exists */
        startedAt: record.startedAt ?? now,
        endedAt: null,
        closedAt: null,
      })
      .where(eq(timeRecord.id, id))
      .returning();
    // `id` was already confirmed to exist under this Hub by `getOwnedRecord` earlier in this same
    // request, and no route deletes a time record.
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!resumed) throw new NotFoundError('Time record not found');
    return { record: resumed, switchedFrom };
  });
  const hydrated = await toTimeRecordOut(outcome.record, userId, now);
  const anchor = await readTaskAnchor(hydrated.taskId);
  if (anchor) {
    const previous = outcome.switchedFrom.find((entry) => entry !== id) ?? null;
    await announceTimer(previous ? 'timer_switched' : 'timer_resumed', hydrated, {
      userId,
      organizationId: anchor.organizationId,
      actorId: null,
      occurredAt: now,
      previousTimeRecordId: previous,
    });
  }
  return hydrated;
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
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!updated) throw new NotFoundError('Time record not found');
  await refreshRecordEnvelope(id, now);
  const hydrated = await toTimeRecordOut(updated, userId, now);
  const anchor = await readTaskAnchor(hydrated.taskId);
  if (anchor) {
    await announceTimer('timer_paused', hydrated, {
      userId,
      organizationId: anchor.organizationId,
      actorId: null,
      occurredAt: now,
    });
  }
  return hydrated;
}

/**
 * Stop the caller's record and close its human tracker.
 *
 * @remarks
 * Stopping re-checks that the tracked task is named, and refuses with a `validation_error`
 * Problem — leaving the session open and still accruing — when it is not. Creation already makes
 * an unnamed session unrepresentable, so this guard is redundant *by design*: the requirement is
 * that finishing without documenting the work be impossible, and an invariant that holds only
 * because one write path happens to validate is an invariant one refactor away from being lost.
 * Checking it where the session would become permanent is the check that cannot be bypassed —
 * not by the REST route, not by MCP, not by a future importer.
 */
export async function stopTimeRecord(userId: string, id: string): Promise<TimeRecordInput> {
  const hubId = await resolveTimeHubId(userId);
  const record = await getOwnedRecord(id, hubId);
  if (record.status === 'submitted' || record.status === 'superseded') {
    throw new ConflictError('This time record can no longer be changed');
  }
  const anchor = await readTaskAnchor(record.taskId);
  requireTrackingName(record.title, 'title');
  requireTrackingName(anchor?.title, 'title');
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
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
  if (!updated) throw new NotFoundError('Time record not found');
  const hydrated = await toTimeRecordOut(updated, userId, now);
  if (anchor) {
    await announceTimer('timer_stopped', hydrated, {
      userId,
      organizationId: anchor.organizationId,
      actorId: null,
      occurredAt: now,
    });
  }
  return hydrated;
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
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
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
    taskId: record.taskId,
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
  /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
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
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!created) throw new Error('time category insert returned no row');
  return toTimeCategoryOut(created);
}
