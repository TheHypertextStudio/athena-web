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
  actor,
  cycle,
  db,
  initiative,
  initiativeProject,
  organization,
  program,
  project,
  task,
  timeAllocation,
  timeCategory,
  timeContext,
  timeInterval,
  timeRecord,
} from '@docket/db';
import type { EntityRef } from '@docket/connections/event-contract';
import type {
  TimeBreakdownQuery,
  TimeCategoryOut,
  TimeCyclePeriodOut,
  TimeRecordOut,
  TimeTimelineQuery,
} from '../contracts/time';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { canReadTimeContext, resolveTimeHubId } from './access';
import { resolveAnchorSuggestion } from './anchor-suggestion';
import { resourceAccessKey, resolveResourceAccess } from '../permissions/resource-access';

type TimeRecordRow = typeof timeRecord.$inferSelect;
type TimeIntervalRow = typeof timeInterval.$inferSelect;
type TimeRecordInput = z.input<typeof TimeRecordOut>;
type TimeCategoryInput = z.input<typeof TimeCategoryOut>;
type TimeCyclePeriodInput = z.input<typeof TimeCyclePeriodOut>;
type TimeMeasuresInput = TimeRecordInput['measures'];

/** A neutral label that preserves the duration fact without preserving a revoked task's title. */
const REDACTED_TASK_TITLE = 'Restricted work';

/** List the cycles in workspaces where the caller still has an active human membership. */
export async function listPersonalTimeCycles(userId: string): Promise<TimeCyclePeriodInput[]> {
  const rows = await db
    .select({
      id: cycle.id,
      workspaceId: cycle.organizationId,
      workspaceName: organization.name,
      name: cycle.name,
      number: cycle.number,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
    })
    .from(cycle)
    .innerJoin(organization, eq(organization.id, cycle.organizationId))
    .innerJoin(
      actor,
      and(
        eq(actor.organizationId, cycle.organizationId),
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .where(and(isNull(cycle.archivedAt), isNull(organization.archivedAt)))
    .orderBy(desc(cycle.startsAt), asc(cycle.id));
  return rows.map((row) => {
    const name = row.name?.trim() ?? '';
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      name: name === '' ? `Cycle ${row.number}` : name,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    };
  });
}

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

/** Return the task a stored Docket work-item context points to, if it has one. */
function taskIdFromContext(context: typeof timeContext.$inferSelect): string | null {
  return context.sourceSystem === 'docket' && context.entityKind === 'work_item'
    ? (context.docketEntityId ?? context.externalId)
    : null;
}

/**
 * Whether a Docket context reveals where a task sits in the work hierarchy.
 *
 * @remarks
 * A record can outlive the caller's task access, so these durable snapshots cannot reveal the
 * hidden anchor's workspace, project, program, initiative, or cycle. A Docket calendar event is
 * intentionally excluded: its separate personal-calendar access check remains authoritative.
 */
function isDocketTaskPlacementContext(context: typeof timeContext.$inferSelect): boolean {
  if (context.sourceSystem !== 'docket') return false;
  return (
    context.entityKind === 'work_item' ||
    context.entityKind === 'project' ||
    context.entityKind === 'program' ||
    context.entityKind === 'initiative' ||
    context.entityKind === 'cycle' ||
    context.entityKind === 'organization'
  );
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
      contexts
        .filter((context) => taskIdFromContext(context) === null)
        .map(
          async (context) => [context.id, await canReadTimeContext(viewerUserId, context)] as const,
        ),
    ),
  );
  // A ledger record keeps durable duration facts, but its links remain live authorization facts.
  // Resolve every stored task reference in one batch rather than turning the shell's always-on
  // tracker read into one grant query per record, interval, context, or allocation.
  const taskIds = [
    ...records.flatMap((record) => (record.taskId ? [record.taskId] : [])),
    ...intervals.flatMap((interval) => (interval.taskId ? [interval.taskId] : [])),
    ...contexts.flatMap((context) => {
      const taskId = taskIdFromContext(context);
      return taskId ? [taskId] : [];
    }),
    ...allocations.flatMap((allocation) =>
      allocation.targetKind === 'task' ? [allocation.targetId] : [],
    ),
  ];
  const referencedTaskIds = [...new Set(taskIds)];
  const taskRows = referencedTaskIds.length
    ? await db
        .select({ id: task.id, organizationId: task.organizationId })
        .from(task)
        .where(inArray(task.id, referencedTaskIds))
    : [];
  const organizationByTask = new Map(taskRows.map((row) => [row.id, row.organizationId]));
  const taskAccess = await resolveResourceAccess(
    viewerUserId,
    taskRows.map((row) => ({
      organizationId: row.organizationId,
      kind: 'task' as const,
      id: row.id,
    })),
  );
  const canViewTask = (taskId: string | null): boolean => {
    if (!taskId) return false;
    const organizationId = organizationByTask.get(taskId);
    return Boolean(
      organizationId &&
      taskAccess.get(resourceAccessKey({ organizationId, kind: 'task', id: taskId }))?.canView,
    );
  };
  const canViewContext = (context: typeof timeContext.$inferSelect): boolean => {
    const contextTaskId = taskIdFromContext(context);
    return contextTaskId
      ? canViewTask(contextTaskId)
      : (contextVisibility.get(context.id) ?? false);
  };
  return records.map((record) => {
    const recordIntervals = intervalsByRecord.get(record.id) ?? [];
    const recordContexts = contextsByRecord.get(record.id) ?? [];
    const recordAllocations = allocationsByRecord.get(record.id) ?? [];
    const recordTaskVisible = record.taskId === null || canViewTask(record.taskId);
    return {
      id: record.id,
      hubId: record.hubId,
      taskId: recordTaskVisible ? record.taskId : null,
      organizationId:
        record.taskId && recordTaskVisible ? (organizationByTask.get(record.taskId) ?? null) : null,
      title: recordTaskVisible ? record.title : REDACTED_TASK_TITLE,
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
        taskId: interval.taskId && !canViewTask(interval.taskId) ? null : interval.taskId,
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
      contexts: recordContexts.map((context) => {
        // The anchor's hierarchy is task-derived context, not merely organization-owned history.
        // Once task access is revoked, redact every Docket placement snapshot. Personal calendar
        // and external contexts retain their independent visibility policy. A personal Docket
        // calendar event can still be read, but not with the hidden anchor's workspace scope.
        const hiddenTaskPlacement = !recordTaskVisible && isDocketTaskPlacementContext(context);
        const visible = !hiddenTaskPlacement && canViewContext(context);
        const organizationId =
          visible && (recordTaskVisible || context.sourceSystem !== 'docket')
            ? context.organizationId
            : null;
        return {
          id: context.id,
          timeRecordId: context.timeRecordId,
          role: context.role,
          entityRef: visible ? toEntityRef(context) : redactEntityRef(context),
          organizationId,
          createdAt: context.createdAt.toISOString(),
        };
      }),
      allocations: recordAllocations
        .filter(
          (allocation) =>
            // A hidden anchor cannot carry an organization/project placement into a personal
            // history response. Personal categories remain safe because they have no workspace
            // or task identity. A visible record still filters any separately-targeted task.
            (recordTaskVisible || allocation.targetKind === 'category') &&
            (allocation.targetKind !== 'task' || canViewTask(allocation.targetId)),
        )
        .map((allocation) => ({
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

/** Narrowing predicate for `.filter()`, which cannot narrow a nullable element type on its own. */
function isPresent<T>(value: T | null): value is T {
  return value !== null;
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

/**
 * Read the shell's active tracker with the same policy as timeline/detail projections.
 *
 * @remarks
 * The candidate is `timeRecord` itself, not a join through an open `timeInterval`: pausing closes
 * the interval and moves the record to `status: 'paused'` (see `pauseTimeRecord` in
 * `./commands.ts`), so a record can be exactly the caller's "one active tracker" — the thing the
 * shell should keep showing with a Resume control — without having any open interval left.
 *
 * `'open'` always outranks `'paused'` in the ordering: `startTimeRecord`/`createTimeRecord` close
 * out whatever was open before opening the next one (see `closeOpenHumanSegments`), so at most one
 * `'open'` record can exist per Hub at any instant. `'paused'` records, in contrast, can genuinely
 * pile up — `closeOpenHumanSegments` only pauses a record that currently holds the open interval,
 * so a record already paused before a different record starts live is never touched and stays
 * paused indefinitely. Among paused candidates the most recently updated one wins, because
 * `updatedAt` is bumped by the pause transition itself (`$onUpdate` on `timeRecord`), which makes
 * it the correct signal for "the one the caller paused most recently" rather than an arbitrary
 * long-abandoned session.
 */
export async function getActiveTime(userId: string) {
  const hubId = await resolveTimeHubId(userId);
  const now = new Date();
  const active = await db
    .select()
    .from(timeRecord)
    .where(and(eq(timeRecord.hubId, hubId), inArray(timeRecord.status, ['open', 'paused'])))
    .orderBy(
      sql`case when ${timeRecord.status} = 'open' then 0 else 1 end`,
      desc(timeRecord.updatedAt),
    )
    .limit(1);
  const [record] = await hydrateTimeRecords(active, userId, now);
  // Only worth resolving when there is nothing anchored to show. A running, named session already
  // answers "what am I on", and the shell polls this read continuously — spending four queries per
  // poll to suggest work the caller is demonstrably already doing is pure waste.
  const suggestion = record?.taskId ? null : await resolveAnchorSuggestion(userId, hubId, now);
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
    suggestion,
    serverNow: now.toISOString(),
    activeAgentExecutions: activeAgentExecutions.map((execution) => ({
      ...execution,
      startedAt: execution.startedAt?.toISOString() ?? null,
    })),
  };
}

/** Resolve the Time Records in a range before every personal-ledger projection measures them. */
async function selectFilteredTimeRecords(userId: string, query: TimeTimelineQuery) {
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
  if (ids.length === 0) return { hubId, records: [] };

  let scopedTaskIds: string[] | null = null;
  if (query.workspaceId || query.projectId) {
    const scopedTasks = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          query.workspaceId ? eq(task.organizationId, query.workspaceId) : undefined,
          query.projectId ? eq(task.projectId, query.projectId) : undefined,
        ),
      );
    scopedTaskIds = scopedTasks.map((row) => row.id);
  }
  if (query.taskId) {
    scopedTaskIds = scopedTaskIds
      ? scopedTaskIds.filter((taskId) => taskId === query.taskId)
      : [query.taskId];
  }
  if (scopedTaskIds !== null && scopedTaskIds.length === 0) return { hubId, records: [] };

  const records = await db
    .select()
    .from(timeRecord)
    .where(
      and(
        eq(timeRecord.hubId, hubId),
        inArray(timeRecord.id, ids),
        ne(timeRecord.status, 'superseded'),
        scopedTaskIds !== null ? inArray(timeRecord.taskId, scopedTaskIds) : undefined,
        query.categoryId ? eq(timeRecord.categoryId, query.categoryId) : undefined,
        query.captureSource ? eq(timeRecord.captureSource, query.captureSource) : undefined,
      ),
    )
    .orderBy(asc(timeRecord.startedAt));
  return { hubId, records };
}

/** Return records with any interval overlapping the requested range. */
export async function getTimeTimeline(
  userId: string,
  query: TimeTimelineQuery,
): Promise<TimeRecordInput[]> {
  const { records } = await selectFilteredTimeRecords(userId, query);
  if (records.length === 0) return [];
  const start = new Date(query.start);
  const end = new Date(query.end);
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
  // The length check above guarantees spans[0] exists; the `?.`/`?? 0` only narrow
  // noUncheckedIndexedAccess's `| undefined` and never actually fall back.
  /* v8 ignore start -- @preserve defensive: see the comment above */
  let currentStart = spans[0]?.start ?? 0;
  let currentEnd = spans[0]?.end ?? 0;
  /* v8 ignore stop */
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
  const start = new Date(query.start);
  const end = new Date(query.end);
  const now = new Date();
  const { records } = await selectFilteredTimeRecords(userId, query);
  if (records.length === 0) {
    return {
      elapsedMs: 0,
      humanEffortMs: 0,
      agentEffortMs: 0,
      combinedEffortMs: 0,
      operationalWaitMs: 0,
    };
  }
  const intervals = await db
    .select()
    .from(timeInterval)
    .where(
      and(
        inArray(
          timeInterval.timeRecordId,
          records.map((record) => record.id),
        ),
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

/** One bucket a tracked task rolls up into on a hierarchy dimension. */
interface HierarchyPlacement {
  readonly key: string;
  readonly label: string;
}

/** Every hierarchy coordinate one tracked task occupies. */
interface TaskPlacement {
  readonly workspace: HierarchyPlacement;
  readonly task: HierarchyPlacement;
  readonly project: HierarchyPlacement;
  readonly program: HierarchyPlacement;
  readonly initiative: HierarchyPlacement;
}

/**
 * Resolve where each tracked task sits in the work hierarchy.
 *
 * @remarks
 * Rollups above the task are DERIVED, never allocated: nobody attributes time to an initiative
 * by hand, so asking for such an allocation would guarantee every initiative reported zero. The
 * chain walked here is the one the product already draws — task → project → program, and
 * project or program → initiative through the initiative join tables — with a task's own
 * `programId` overriding its project's when both are set.
 *
 * A task that stops short of a level lands in that level's explicit unassigned bucket ("No
 * project", "No program", "No initiative"). It is never dropped, which is what keeps every
 * dimension summing to the same period total.
 *
 * A project may belong to several initiatives. Only the lowest-id one receives the credit,
 * because splitting it would double count and dropping it would lose time — and a person
 * reading "how much went to this initiative" wants a number that adds up more than they want a
 * many-to-many faithfully reproduced.
 */
async function resolveTaskPlacements(
  taskIds: readonly string[],
): Promise<Map<string, TaskPlacement>> {
  const placements = new Map<string, TaskPlacement>();
  if (taskIds.length === 0) return placements;
  const taskRows = await db
    .select({
      id: task.id,
      title: task.title,
      organizationId: task.organizationId,
      projectId: task.projectId,
      programId: task.programId,
      organizationName: organization.name,
      projectName: project.name,
      projectProgramId: project.programId,
    })
    .from(task)
    .innerJoin(organization, eq(organization.id, task.organizationId))
    .leftJoin(project, eq(project.id, task.projectId))
    .where(inArray(task.id, taskIds));

  const programIds = [
    ...new Set(
      taskRows.flatMap((row) => {
        const id = row.programId ?? row.projectProgramId;
        return id ? [id] : [];
      }),
    ),
  ];
  const projectIds = [
    ...new Set(taskRows.flatMap((row) => (row.projectId ? [row.projectId] : []))),
  ];
  const [programRows, initiativeLinks] = await Promise.all([
    programIds.length > 0
      ? db
          .select({ id: program.id, name: program.name })
          .from(program)
          .where(inArray(program.id, programIds))
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .select({
            projectId: initiativeProject.projectId,
            initiativeId: initiative.id,
            name: initiative.name,
          })
          .from(initiativeProject)
          .innerJoin(initiative, eq(initiative.id, initiativeProject.initiativeId))
          .where(inArray(initiativeProject.projectId, projectIds))
          .orderBy(asc(initiative.id))
      : Promise.resolve([]),
  ]);
  const programName = new Map(programRows.map((row) => [row.id, row.name]));
  const initiativeByProject = new Map<string, { id: string; name: string }>();
  for (const link of initiativeLinks) {
    if (!initiativeByProject.has(link.projectId)) {
      initiativeByProject.set(link.projectId, { id: link.initiativeId, name: link.name });
    }
  }

  for (const row of taskRows) {
    const programId = row.programId ?? row.projectProgramId;
    const linkedInitiative = row.projectId ? initiativeByProject.get(row.projectId) : undefined;
    // `task.project_id`/`task.program_id` (and `project.program_id`) all have an
    // `onDelete: 'set null'` FK, so whenever `row.projectId`/`programId` below is non-null it
    // always still names a real, joined row — the `?? 'Project'`/`?? 'Program'` fallbacks exist
    // only to satisfy the join's `| null` column type and this Map's `| undefined` return, and
    // never actually fire (only relevant when the id is set, per the ternaries below).
    /* v8 ignore next 2 -- @preserve defensive: see the comment above */
    const projectLabel = row.projectName ?? 'Project';
    const programLabel = (programId && programName.get(programId)) ?? 'Program';
    placements.set(row.id, {
      workspace: { key: row.organizationId, label: row.organizationName },
      task: { key: row.id, label: row.title },
      project: row.projectId
        ? { key: row.projectId, label: projectLabel }
        : { key: 'unassigned:project', label: 'No project' },
      program: programId
        ? { key: programId, label: programLabel }
        : { key: 'unassigned:program', label: 'No program' },
      initiative: linkedInitiative
        ? { key: linkedInitiative.id, label: linkedInitiative.name }
        : { key: 'unassigned:initiative', label: 'No initiative' },
    });
  }
  return placements;
}

/**
 * Build a bounded personal breakdown whose buckets reconcile with the reported total.
 *
 * @remarks
 * Effort measures (`humanEffortMs`, `agentEffortMs`, `combinedEffortMs`) sum across buckets to
 * the period total exactly, on every dimension, because each record contributes its whole
 * measure to exactly one bucket. `elapsedMs` deliberately does not: the total merges overlapping
 * wall-clock spans so parallel human and agent work is not counted twice, and a merge has no
 * per-bucket decomposition. Reflection surfaces therefore headline an effort measure.
 */
export async function getTimeBreakdown(userId: string, query: TimeBreakdownQuery) {
  const [hubId, records, total] = await Promise.all([
    resolveTimeHubId(userId),
    getTimeTimeline(userId, query),
    getTimeSummary(userId, query),
  ]);
  const start = new Date(query.start);
  const end = new Date(query.end);
  const now = new Date();
  const [categories, placements] = await Promise.all([
    db
      .select({ id: timeCategory.id, name: timeCategory.name })
      .from(timeCategory)
      .where(eq(timeCategory.hubId, hubId)),
    // A breakdown reads terminal records, and the closed-requires-anchor constraint means those
    // always carry a task. The filter is what makes that guarantee visible to the type system
    // rather than an assertion, and it also keeps a still-running unanchored session — which a
    // range query can legitimately overlap — from being looked up as if it had one.
    resolveTaskPlacements([...new Set(records.map((record) => record.taskId).filter(isPresent))]),
  ]);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
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
      // `time_record.category_id` has an `onDelete: 'set null'` FK to `time_category` — a
      // deleted category always nulls the reference rather than leaving it dangling, so a
      // non-null `categoryId` here is always resolvable in `categoryName` (queried for every
      // category on this Hub, with no archived-state filter). "Archived category" is a label
      // for a state the data model cannot actually produce; kept as a readable fallback rather
      // than a thrown assertion, since a UI string is cheap insurance and a throw is not.
      let categoryLabel = 'Uncategorized';
      if (record.categoryId) {
        /* v8 ignore next -- @preserve defensive: see the comment above */
        categoryLabel = categoryName.get(record.categoryId) ?? 'Archived category';
      }
      add(key, categoryLabel, measures);
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
    if (query.groupBy === 'capture_source') {
      const labels = {
        live: 'Live timer',
        manual: 'Manual entry',
        reconstructed: 'Reconstructed',
        agent: 'Agent-created',
      } as const;
      add(record.captureSource, labels[record.captureSource], measures);
      continue;
    }
    const placement = record.taskId ? placements.get(record.taskId) : undefined;
    // `placements` is resolved (above) for exactly `[...new Set(records.map(r => r.taskId))]`,
    // and `time_record.task_id` cascade-deletes with its task, so every record's task always
    // exists and is always in `placements` — every `TaskPlacement` field is always populated
    // too (`resolveTaskPlacements` sets an explicit "No project"/"No program"/"No initiative"
    // bucket rather than ever leaving one out). This fallback exists only to satisfy the two
    // Map/index lookups' `| undefined` types.
    /* v8 ignore next 4 -- @preserve defensive: see the comment above */
    const bucket = placement?.[query.groupBy] ?? {
      key: `unassigned:${query.groupBy}`,
      label: 'Unassigned',
    };
    add(bucket.key, bucket.label, measures);
  }
  return {
    groupBy: query.groupBy,
    buckets: [...buckets.values()].sort(
      (left, right) => right.measures.combinedEffortMs - left.measures.combinedEffortMs,
    ),
    total,
  };
}
