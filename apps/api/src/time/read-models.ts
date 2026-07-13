/**
 * `time/read-models` — bulk-hydrated personal Time Ledger projections.
 *
 * @remarks
 * Command code writes normalized facts. This module is the only place that turns those facts into
 * active, timeline, summary, and breakdown read models, so range clipping and context redaction
 * cannot drift between API consumers.
 */
import {
  agentExecution,
  db,
  organization,
  timeAllocation,
  timeCategory,
  timeContext,
  timeInterval,
  timeRecord,
} from '@docket/db';
import type {
  EntityRef,
  TimeBreakdownQuery,
  TimeCategoryOut,
  TimeRecordOut,
  TimeTimelineQuery,
} from '@docket/types';
import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import type { z } from 'zod';

import { canReadTimeContext, resolveTimeHubId } from './access';

type TimeRecordRow = typeof timeRecord.$inferSelect;
type TimeIntervalRow = typeof timeInterval.$inferSelect;
type TimeRecordInput = z.input<typeof TimeRecordOut>;
type TimeCategoryInput = z.input<typeof TimeCategoryOut>;
type TimeMeasuresInput = TimeRecordInput['measures'];

/** Convert a persisted typed context back into its shared entity-reference contract. */
function toEntityRef(row: typeof timeContext.$inferSelect): EntityRef {
  return {
    kind: row.entityKind as EntityRef['kind'],
    source: row.sourceSystem as EntityRef['source'],
    externalId: row.externalId,
    title: row.titleSnapshot,
    url: row.urlSnapshot,
    docketEntityId: row.docketEntityId,
  };
}

/** Return an entity reference stripped of target identity after access has been revoked. */
function redactEntityRef(row: typeof timeContext.$inferSelect): EntityRef {
  return {
    kind: row.entityKind as EntityRef['kind'],
    source: row.sourceSystem as EntityRef['source'],
    externalId: row.id,
    title: null,
    url: null,
    docketEntityId: null,
  };
}

/** Compute exact, separately-labelled measures for one record's complete interval set. */
export function measureIntervals(
  intervals: readonly TimeIntervalRow[],
  now: Date,
): TimeMeasuresInput {
  const completed = intervals.filter((interval) => interval.supersededById === null);
  const first = completed[0];
  if (!first) {
    return {
      elapsedMs: 0,
      humanEffortMs: 0,
      agentEffortMs: 0,
      combinedEffortMs: 0,
      operationalWaitMs: 0,
    };
  }
  let earliest = first.startedAt.getTime();
  let latest = earliest;
  let humanEffortMs = 0;
  let agentEffortMs = 0;
  let operationalWaitMs = 0;
  for (const interval of completed) {
    const start = interval.startedAt.getTime();
    const end = (interval.endedAt ?? now).getTime();
    const duration = Math.max(0, end - start);
    earliest = Math.min(earliest, start);
    latest = Math.max(latest, end);
    if (interval.mode === 'human_active') humanEffortMs += duration;
    if (interval.mode === 'agent_active') agentEffortMs += duration;
    if (interval.mode === 'tool_wait' || interval.mode === 'awaiting_human') {
      operationalWaitMs += duration;
    }
  }
  return {
    elapsedMs: Math.max(0, latest - earliest),
    humanEffortMs,
    agentEffortMs,
    combinedEffortMs: humanEffortMs + agentEffortMs,
    operationalWaitMs,
  };
}

/** Clamp one interval to a reporting range. */
function clipInterval(
  startedAt: Date,
  endedAt: Date | null,
  start: Date,
  end: Date,
  now: Date,
): { start: number; end: number } | null {
  const intervalStart = Math.max(startedAt.getTime(), start.getTime());
  const intervalEnd = Math.min((endedAt ?? now).getTime(), end.getTime());
  return intervalEnd > intervalStart ? { start: intervalStart, end: intervalEnd } : null;
}

/** Measure one serialized record only within a reporting range. */
export function measureRecordInRange(
  record: TimeRecordInput,
  start: Date,
  end: Date,
  now = new Date(),
): TimeMeasuresInput {
  const clipped = record.intervals.flatMap((interval) => {
    if (interval.supersededById) return [];
    const bounds = clipInterval(
      new Date(interval.startedAt),
      interval.endedAt ? new Date(interval.endedAt) : null,
      start,
      end,
      now,
    );
    return bounds ? [{ ...interval, ...bounds }] : [];
  });
  const first = clipped[0];
  if (!first) {
    return {
      elapsedMs: 0,
      humanEffortMs: 0,
      agentEffortMs: 0,
      combinedEffortMs: 0,
      operationalWaitMs: 0,
    };
  }
  let earliest = first.start;
  let latest = first.end;
  let humanEffortMs = 0;
  let agentEffortMs = 0;
  let operationalWaitMs = 0;
  for (const interval of clipped) {
    const duration = interval.end - interval.start;
    earliest = Math.min(earliest, interval.start);
    latest = Math.max(latest, interval.end);
    if (interval.mode === 'human_active') humanEffortMs += duration;
    if (interval.mode === 'agent_active') agentEffortMs += duration;
    if (interval.mode === 'tool_wait' || interval.mode === 'awaiting_human') {
      operationalWaitMs += duration;
    }
  }
  return {
    elapsedMs: latest - earliest,
    humanEffortMs,
    agentEffortMs,
    combinedEffortMs: humanEffortMs + agentEffortMs,
    operationalWaitMs,
  };
}

/** Build full Time Records from three bounded relation queries instead of three queries per row. */
export async function hydrateTimeRecords(
  records: readonly TimeRecordRow[],
  viewerUserId: string,
  now = new Date(),
): Promise<TimeRecordInput[]> {
  if (records.length === 0) return [];
  const ids = records.map((record) => record.id);
  const [intervals, contexts, allocations] = await Promise.all([
    db
      .select()
      .from(timeInterval)
      .where(inArray(timeInterval.timeRecordId, ids))
      .orderBy(asc(timeInterval.startedAt)),
    db
      .select()
      .from(timeContext)
      .where(inArray(timeContext.timeRecordId, ids))
      .orderBy(asc(timeContext.createdAt)),
    db
      .select()
      .from(timeAllocation)
      .where(inArray(timeAllocation.timeRecordId, ids))
      .orderBy(asc(timeAllocation.createdAt)),
  ]);
  const intervalsByRecord = groupByRecord(intervals);
  const contextsByRecord = groupByRecord(contexts);
  const allocationsByRecord = groupByRecord(allocations);
  const contextVisibility = new Map(
    await Promise.all(
      contexts.map(
        async (context) => [context.id, await canReadTimeContext(viewerUserId, context)] as const,
      ),
    ),
  );
  return records.map((record) => {
    const recordIntervals = intervalsByRecord.get(record.id) ?? [];
    const recordContexts = contextsByRecord.get(record.id) ?? [];
    const recordAllocations = allocationsByRecord.get(record.id) ?? [];
    return {
      id: record.id,
      hubId: record.hubId,
      title: record.title,
      outcomeNote: record.outcomeNote,
      status: record.status,
      categoryId: record.categoryId,
      captureSource: record.captureSource,
      startedAt: record.startedAt?.toISOString() ?? null,
      endedAt: record.endedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      closedAt: record.closedAt?.toISOString() ?? null,
      intervals: recordIntervals.map((interval) => ({
        id: interval.id,
        timeRecordId: interval.timeRecordId,
        actorKind: interval.actorKind,
        userId: interval.userId,
        agentExecutionId: interval.agentExecutionId,
        mode: interval.mode,
        source: interval.source,
        startedAt: interval.startedAt.toISOString(),
        endedAt: interval.endedAt?.toISOString() ?? null,
        supersededById: interval.supersededById,
        createdAt: interval.createdAt.toISOString(),
        closedAt: interval.closedAt?.toISOString() ?? null,
      })),
      contexts: recordContexts.map((context) => ({
        id: context.id,
        timeRecordId: context.timeRecordId,
        role: context.role,
        entityRef: contextVisibility.get(context.id)
          ? toEntityRef(context)
          : redactEntityRef(context),
        organizationId: contextVisibility.get(context.id) ? context.organizationId : null,
        createdAt: context.createdAt.toISOString(),
      })),
      allocations: recordAllocations.map((allocation) => ({
        id: allocation.id,
        timeRecordId: allocation.timeRecordId,
        targetKind: allocation.targetKind,
        targetId: allocation.targetId,
        organizationId: allocation.organizationId,
        basisPoints: allocation.basisPoints,
        createdAt: allocation.createdAt.toISOString(),
        updatedAt: allocation.updatedAt.toISOString(),
      })),
      measures: measureIntervals(recordIntervals, now),
    };
  });
}

/** Group a relation list by its Time Record id. */
function groupByRecord<T extends { timeRecordId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const items = grouped.get(row.timeRecordId) ?? [];
    items.push(row);
    grouped.set(row.timeRecordId, items);
  }
  return grouped;
}

/** Read the shell's active tracker with the same policy as timeline/detail projections. */
export async function getActiveTime(userId: string) {
  const hubId = await resolveTimeHubId(userId);
  const now = new Date();
  const active = await db
    .select({ record: timeRecord })
    .from(timeInterval)
    .innerJoin(timeRecord, eq(timeRecord.id, timeInterval.timeRecordId))
    .where(
      and(
        eq(timeInterval.hubId, hubId),
        eq(timeInterval.userId, userId),
        eq(timeInterval.mode, 'human_active'),
        isNull(timeInterval.endedAt),
      ),
    )
    .limit(1);
  const [record] = await hydrateTimeRecords(
    active.map((row) => row.record),
    userId,
    now,
  );
  const activeAgentExecutions = await db
    .select({
      id: agentExecution.id,
      sessionId: agentExecution.sessionId,
      timeRecordId: agentExecution.timeRecordId,
      status: agentExecution.status,
      startedAt: agentExecution.startedAt,
    })
    .from(agentExecution)
    .where(
      and(
        eq(agentExecution.initiatedByUserId, userId),
        inArray(agentExecution.status, ['queued', 'running', 'tool_wait', 'awaiting_human']),
      ),
    )
    .orderBy(asc(agentExecution.queuedAt));
  return {
    record: record ?? null,
    serverNow: now.toISOString(),
    activeAgentExecutions: activeAgentExecutions.map((execution) => ({
      ...execution,
      startedAt: execution.startedAt?.toISOString() ?? null,
    })),
  };
}

/** Return records with any interval overlapping the requested range. */
export async function getTimeTimeline(
  userId: string,
  query: TimeTimelineQuery,
): Promise<TimeRecordInput[]> {
  const hubId = await resolveTimeHubId(userId);
  const start = new Date(query.start);
  const end = new Date(query.end);
  const intervalRows = await db
    .select({ recordId: timeInterval.timeRecordId })
    .from(timeInterval)
    .where(
      and(
        eq(timeInterval.hubId, hubId),
        lt(timeInterval.startedAt, end),
        or(isNull(timeInterval.endedAt), gt(timeInterval.endedAt, start)),
        isNull(timeInterval.supersededById),
      ),
    )
    .orderBy(asc(timeInterval.startedAt));
  const ids = [...new Set(intervalRows.map((interval) => interval.recordId))];
  if (ids.length === 0) return [];
  const records = await db
    .select()
    .from(timeRecord)
    .where(and(eq(timeRecord.hubId, hubId), inArray(timeRecord.id, ids)))
    .orderBy(asc(timeRecord.startedAt));
  const now = new Date();
  const hydrated = await hydrateTimeRecords(records, userId, now);
  return hydrated.map((record) => ({
    ...record,
    measures: measureRecordInRange(record, start, end, now),
  }));
}

/** Merge overlapping wall-clock spans so aggregate elapsed time never double counts parallel work. */
function mergedElapsedMs(
  intervals: readonly TimeIntervalRow[],
  start: Date,
  end: Date,
  now: Date,
): number {
  const spans = intervals
    .filter((interval) => interval.supersededById === null)
    .flatMap((interval) => {
      const clipped = clipInterval(interval.startedAt, interval.endedAt, start, end, now);
      return clipped ? [clipped] : [];
    })
    .sort((left, right) => left.start - right.start);
  if (spans.length === 0) return 0;
  let elapsedMs = 0;
  let currentStart = spans[0]?.start ?? 0;
  let currentEnd = spans[0]?.end ?? 0;
  for (const span of spans.slice(1)) {
    if (span.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, span.end);
      continue;
    }
    elapsedMs += currentEnd - currentStart;
    currentStart = span.start;
    currentEnd = span.end;
  }
  return elapsedMs + currentEnd - currentStart;
}

/** Aggregate bounded personal effort and elapsed-wall-clock measures. */
export async function getTimeSummary(
  userId: string,
  query: TimeTimelineQuery,
): Promise<TimeMeasuresInput> {
  const hubId = await resolveTimeHubId(userId);
  const start = new Date(query.start);
  const end = new Date(query.end);
  const now = new Date();
  const intervals = await db
    .select()
    .from(timeInterval)
    .where(
      and(
        eq(timeInterval.hubId, hubId),
        lt(timeInterval.startedAt, end),
        or(isNull(timeInterval.endedAt), gt(timeInterval.endedAt, start)),
        isNull(timeInterval.supersededById),
      ),
    );
  let humanEffortMs = 0;
  let agentEffortMs = 0;
  let operationalWaitMs = 0;
  for (const interval of intervals) {
    const clipped = clipInterval(interval.startedAt, interval.endedAt, start, end, now);
    if (!clipped) continue;
    const duration = clipped.end - clipped.start;
    if (interval.mode === 'human_active') humanEffortMs += duration;
    if (interval.mode === 'agent_active') agentEffortMs += duration;
    if (interval.mode === 'tool_wait' || interval.mode === 'awaiting_human')
      operationalWaitMs += duration;
  }
  return {
    elapsedMs: mergedElapsedMs(intervals, start, end, now),
    humanEffortMs,
    agentEffortMs,
    combinedEffortMs: humanEffortMs + agentEffortMs,
    operationalWaitMs,
  };
}

/** Serialize a Hub-owned personal category. */
export function toTimeCategoryOut(row: typeof timeCategory.$inferSelect): TimeCategoryInput {
  return {
    id: row.id,
    hubId: row.hubId,
    parentId: row.parentId,
    name: row.name,
    color: row.color,
    sort: row.sort,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** List a caller's personal category taxonomy. */
export async function listTimeCategories(userId: string): Promise<TimeCategoryInput[]> {
  const hubId = await resolveTimeHubId(userId);
  const rows = await db
    .select()
    .from(timeCategory)
    .where(eq(timeCategory.hubId, hubId))
    .orderBy(asc(timeCategory.sort), asc(timeCategory.name));
  return rows.map(toTimeCategoryOut);
}

/** Sum independently-labelled measures. */
function addMeasures(left: TimeMeasuresInput, right: TimeMeasuresInput): TimeMeasuresInput {
  return {
    elapsedMs: left.elapsedMs + right.elapsedMs,
    humanEffortMs: left.humanEffortMs + right.humanEffortMs,
    agentEffortMs: left.agentEffortMs + right.agentEffortMs,
    combinedEffortMs: left.combinedEffortMs + right.combinedEffortMs,
    operationalWaitMs: left.operationalWaitMs + right.operationalWaitMs,
  };
}

/** Scale a record's measures by explicit allocation credit. */
function scaleMeasures(measures: TimeMeasuresInput, basisPoints: number): TimeMeasuresInput {
  const scale = (value: number) => Math.floor((value * basisPoints) / 10_000);
  return {
    elapsedMs: scale(measures.elapsedMs),
    humanEffortMs: scale(measures.humanEffortMs),
    agentEffortMs: scale(measures.agentEffortMs),
    combinedEffortMs: scale(measures.combinedEffortMs),
    operationalWaitMs: scale(measures.operationalWaitMs),
  };
}

/** Build a bounded personal breakdown whose buckets reconcile with the reported total. */
export async function getTimeBreakdown(userId: string, query: TimeBreakdownQuery) {
  const [hubId, records, total] = await Promise.all([
    resolveTimeHubId(userId),
    getTimeTimeline(userId, query),
    getTimeSummary(userId, query),
  ]);
  const start = new Date(query.start);
  const end = new Date(query.end);
  const now = new Date();
  const organizationIds = [
    ...new Set(
      records.flatMap((record) =>
        record.allocations.flatMap((allocation) =>
          allocation.organizationId ? [allocation.organizationId] : [],
        ),
      ),
    ),
  ];
  const [categories, organizations] = await Promise.all([
    db
      .select({ id: timeCategory.id, name: timeCategory.name })
      .from(timeCategory)
      .where(eq(timeCategory.hubId, hubId)),
    organizationIds.length > 0
      ? db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(inArray(organization.id, organizationIds))
      : Promise.resolve([]),
  ]);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const organizationName = new Map(
    organizations.map((workspace) => [workspace.id, workspace.name]),
  );
  const buckets = new Map<string, { key: string; label: string; measures: TimeMeasuresInput }>();
  const add = (key: string, label: string, measures: TimeMeasuresInput): void => {
    const existing = buckets.get(key);
    buckets.set(key, {
      key,
      label,
      measures: existing ? addMeasures(existing.measures, measures) : measures,
    });
  };

  for (const record of records) {
    const measures = measureRecordInRange(record, start, end, now);
    if (query.groupBy === 'category') {
      const key = record.categoryId ?? 'unclassified';
      add(
        key,
        record.categoryId
          ? (categoryName.get(record.categoryId) ?? 'Archived category')
          : 'Uncategorized',
        measures,
      );
      continue;
    }
    if (query.groupBy === 'actor') {
      if (measures.humanEffortMs > 0) {
        add('human', 'You', {
          elapsedMs: 0,
          humanEffortMs: measures.humanEffortMs,
          agentEffortMs: 0,
          combinedEffortMs: measures.humanEffortMs,
          operationalWaitMs: 0,
        });
      }
      if (measures.agentEffortMs > 0 || measures.operationalWaitMs > 0) {
        add('agent', 'Agents', {
          elapsedMs: 0,
          humanEffortMs: 0,
          agentEffortMs: measures.agentEffortMs,
          combinedEffortMs: measures.agentEffortMs,
          operationalWaitMs: measures.operationalWaitMs,
        });
      }
      continue;
    }
    const matching =
      query.groupBy === 'workspace'
        ? record.allocations.filter((allocation) => allocation.organizationId !== null)
        : record.allocations.filter((allocation) => allocation.targetKind === query.groupBy);
    const matchedBasisPoints = matching.reduce(
      (sum, allocation) => sum + allocation.basisPoints,
      0,
    );
    for (const allocation of matching) {
      const key =
        query.groupBy === 'workspace'
          ? (allocation.organizationId ?? allocation.targetId)
          : allocation.targetId;
      const context = record.contexts.find(
        (candidate) => candidate.entityRef.docketEntityId === allocation.targetId,
      );
      const label =
        query.groupBy === 'workspace'
          ? (organizationName.get(key) ?? 'Workspace')
          : (context?.entityRef.title ?? allocation.targetId);
      add(key, label, scaleMeasures(measures, allocation.basisPoints));
    }
    if (matchedBasisPoints < 10_000) {
      add(
        `unallocated:${query.groupBy}`,
        'Unallocated',
        scaleMeasures(measures, 10_000 - matchedBasisPoints),
      );
    }
  }
  return {
    groupBy: query.groupBy,
    buckets: [...buckets.values()].sort(
      (left, right) => right.measures.combinedEffortMs - left.measures.combinedEffortMs,
    ),
    total,
  };
}
