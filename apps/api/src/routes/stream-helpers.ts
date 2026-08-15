/**
 * `@docket/api` — project an `event` row into the unified {@link StreamEventOut}.
 *
 * @remarks
 * One projection shared by both feed surfaces (cross-org personal + per-workspace). The row
 * carries typed `source` attribution, the canonical `entity`/`actor`, the typed `detail`, and a
 * derived `rendering` hint so heterogeneous origins render through one homogeneous row.
 * `actorIsViewer` compares the resolved Docket actor with the caller's actor ids so the client can
 * say "You" without guessing from names. `relevance` is retained for compatibility with older
 * recipient projections and is `null` on context-wide timelines.
 */
import { actor, agentSession, comment, db, event, task } from '@docket/db';
import type { auditEvent } from '@docket/db';
import type { EventKind, StreamEventOut, StreamRelevance } from '@docket/types';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import { publish } from '../lib/event-bus';

import { buildTaskViewFilter, type ViewableTaskParts } from './task-helpers';

/** The selected `event` row shape. */
type EventRow = typeof event.$inferSelect;
type AuditEventRow = typeof auditEvent.$inferSelect;

/** The event fields needed to decide whether it carries a private task. */
export type TaskBearingStreamEventRow = Pick<
  EventRow,
  'organizationId' | 'entityKind' | 'entityAssociation' | 'docketEntityId'
>;

/** The audit fields needed to decide whether it carries a private task or task comment. */
export type TaskBearingAuditEventRow = Pick<
  AuditEventRow,
  'organizationId' | 'subjectType' | 'subjectId'
>;

/** One active human actor whose task visibility participates in an event-delivery decision. */
export interface TaskEventViewer {
  readonly organizationId: string;
  readonly actorId: string;
}

/** A precomputed, canonical task-access decision for event and audit delivery. */
export interface TaskBearingEventVisibility {
  /** Keep direct task-bearing observation events visible to at least one supplied viewer. */
  filterStreamEvents<T extends TaskBearingStreamEventRow>(rows: readonly T[]): Promise<T[]>;
  /** Keep direct-task, task-comment, and task-bound agent-session audit events visible. */
  filterAuditEvents<T extends TaskBearingAuditEventRow>(rows: readonly T[]): Promise<T[]>;
}

/** A bounded page after an access filter has been applied ahead of serialization. */
export interface VisibilityFilteredPage<T> {
  readonly items: T[];
  readonly hasMore: boolean;
}

/** A cursor-aware source used by {@link collectVisibilityFilteredPage}. */
export interface VisibilityPageScan<T, Cursor> {
  readonly limit: number;
  readonly initialCursor: Cursor | null;
  readonly cursorOf: (row: T) => Cursor;
  readonly fetch: (cursor: Cursor | null, limit: number) => Promise<readonly T[]>;
  readonly filter: (rows: readonly T[]) => Promise<readonly T[]>;
}

const EVENT_PAGE_SCAN_SIZE = 64;

/** How one event/audit row relates to task visibility, including a deliberately fail-closed link. */
type TaskEventRelation =
  | { readonly kind: 'non_task' }
  | { readonly kind: 'task'; readonly taskId: string }
  | { readonly kind: 'unresolved_task' };

const NON_TASK_EVENT: TaskEventRelation = { kind: 'non_task' };
const UNRESOLVED_TASK_EVENT: TaskEventRelation = { kind: 'unresolved_task' };

function taskKey(organizationId: string, taskId: string): string {
  return `${organizationId}\u0000${taskId}`;
}

/** Key a session by the workspace that can safely own an organization-scoped feed row. */
function agentSessionKey(session: {
  readonly id: string;
  readonly organizationId: string | null;
  readonly contextOrganizationId: string | null;
}): string | null {
  // Registered sessions carry `organizationId`; user-owned Athena sessions carry their active
  // workspace in `contextOrganizationId` instead.
  const organizationId = session.organizationId ?? session.contextOrganizationId;
  return organizationId ? taskKey(organizationId, session.id) : null;
}

/** Whether a manually resolved mail or calendar observation now identifies a Docket task. */
function manuallyLinkedTask(row: TaskBearingStreamEventRow): boolean {
  return (
    row.entityAssociation === 'matched' &&
    row.docketEntityId !== null &&
    (row.entityKind === 'thread' || row.entityKind === 'calendar_event')
  );
}

/** Resolve each observation's direct task or indirect task-bound agent-session subject. */
async function taskRelationsForStreamEvents(
  rows: readonly TaskBearingStreamEventRow[],
): Promise<TaskEventRelation[]> {
  const sessionIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.entityKind === 'agent_session' && row.docketEntityId ? [row.docketEntityId] : [],
      ),
    ),
  ];
  const taskBySession = new Map<string, string | null>();
  if (sessionIds.length > 0) {
    const sessions = await db
      .select({
        id: agentSession.id,
        organizationId: agentSession.organizationId,
        contextOrganizationId: agentSession.contextOrganizationId,
        taskId: agentSession.taskId,
      })
      .from(agentSession)
      .where(inArray(agentSession.id, sessionIds));
    for (const session of sessions) {
      const key = agentSessionKey(session);
      if (key) taskBySession.set(key, session.taskId);
    }
  }

  return rows.map((row) => {
    if (manuallyLinkedTask(row)) {
      const taskId = row.docketEntityId;
      return taskId ? { kind: 'task', taskId } : NON_TASK_EVENT;
    }
    if (row.entityKind === 'work_item') {
      return row.docketEntityId ? { kind: 'task', taskId: row.docketEntityId } : NON_TASK_EVENT;
    }
    if (row.entityKind !== 'agent_session') return NON_TASK_EVENT;
    const sessionKey = row.docketEntityId ? taskKey(row.organizationId, row.docketEntityId) : null;
    if (!sessionKey || !taskBySession.has(sessionKey)) {
      return UNRESOLVED_TASK_EVENT;
    }
    const taskId = taskBySession.get(sessionKey);
    return taskId ? { kind: 'task', taskId } : NON_TASK_EVENT;
  });
}

/** Resolve each audit row's direct task or indirect task-comment subject. */
async function taskRelationsForAuditEvents(
  rows: readonly TaskBearingAuditEventRow[],
): Promise<TaskEventRelation[]> {
  const commentIds = [
    ...new Set(rows.filter((row) => row.subjectType === 'comment').map((row) => row.subjectId)),
  ];
  const sessionIds = [
    ...new Set(
      rows.filter((row) => row.subjectType === 'agent_session').map((row) => row.subjectId),
    ),
  ];
  const taskByComment = new Map<string, string>();
  const knownComments = new Set<string>();
  const taskBySession = new Map<string, string | null>();
  const [comments, sessions] = await Promise.all([
    commentIds.length > 0
      ? db
          .select({
            id: comment.id,
            organizationId: comment.organizationId,
            subjectType: comment.subjectType,
            subjectId: comment.subjectId,
          })
          .from(comment)
          .where(inArray(comment.id, commentIds))
      : Promise.resolve([]),
    sessionIds.length > 0
      ? db
          .select({
            id: agentSession.id,
            organizationId: agentSession.organizationId,
            contextOrganizationId: agentSession.contextOrganizationId,
            taskId: agentSession.taskId,
          })
          .from(agentSession)
          .where(inArray(agentSession.id, sessionIds))
      : Promise.resolve([]),
  ]);
  for (const commentRow of comments) {
    const key = taskKey(commentRow.organizationId, commentRow.id);
    knownComments.add(key);
    if (commentRow.subjectType === 'task') {
      taskByComment.set(key, commentRow.subjectId);
    }
  }
  for (const session of sessions) {
    const key = agentSessionKey(session);
    if (key) taskBySession.set(key, session.taskId);
  }

  return rows.map((row) => {
    if (row.subjectType === 'task') return { kind: 'task', taskId: row.subjectId };
    if (row.subjectType === 'comment') {
      const key = taskKey(row.organizationId, row.subjectId);
      // A known comment on a non-task is an ordinary audit event. A missing comment is not
      // safely classifiable, so it is deliberately marked unresolved and hidden below.
      if (!knownComments.has(key)) return UNRESOLVED_TASK_EVENT;
      const taskId = taskByComment.get(key);
      return taskId ? { kind: 'task', taskId } : NON_TASK_EVENT;
    }
    if (row.subjectType === 'agent_session') {
      const sessionKey = taskKey(row.organizationId, row.subjectId);
      if (!taskBySession.has(sessionKey)) return UNRESOLVED_TASK_EVENT;
      const taskId = taskBySession.get(sessionKey);
      return taskId ? { kind: 'task', taskId } : NON_TASK_EVENT;
    }
    return NON_TASK_EVENT;
  });
}

/**
 * Keep task-bearing rows only when a current active human viewer can see their linked task.
 *
 * Rows without a task relationship preserve their existing feed behavior. A missing task or
 * comment-to-task or agent-session-to-task relationship is deliberately fail-closed: the row
 * advertised a task-bearing subject but no current task visibility decision can establish that it
 * is safe to serialize.
 */
async function filterTaskBearingRows<T extends { readonly organizationId: string }>(
  rows: readonly T[],
  relations: readonly TaskEventRelation[],
  filtersByOrganization: ReadonlyMap<string, readonly ((task: ViewableTaskParts) => boolean)[]>,
): Promise<T[]> {
  const ids = [
    ...new Set(
      relations.flatMap((relation) => (relation.kind === 'task' ? [relation.taskId] : [])),
    ),
  ];
  if (ids.length === 0) {
    return rows.filter(
      (_row, index) =>
        (relations[index] ?? UNRESOLVED_TASK_EVENT).kind !== UNRESOLVED_TASK_EVENT.kind,
    );
  }

  const tasks = await db
    .select({
      id: task.id,
      organizationId: task.organizationId,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(and(inArray(task.id, ids), isNull(task.archivedAt)));
  const tasksByKey = new Map(
    tasks.map((taskRow) => [taskKey(taskRow.organizationId, taskRow.id), taskRow]),
  );

  return rows.filter((row, index) => {
    const relation = relations[index] ?? UNRESOLVED_TASK_EVENT;
    if (relation.kind === 'non_task') return true;
    if (relation.kind === 'unresolved_task') return false;
    const taskRow = tasksByKey.get(taskKey(row.organizationId, relation.taskId));
    if (!taskRow) return false;
    return (filtersByOrganization.get(row.organizationId) ?? []).some((filter) => filter(taskRow));
  });
}

/**
 * Build the canonical task visibility decision for event delivery.
 *
 * @remarks
 * Task-bearing observations identify the task through a matched `work_item` association or a
 * task-bound agent session. Audit rows can identify it directly, through a comment's polymorphic
 * subject, or through an agent session. All paths use {@link buildTaskViewFilter}; this helper
 * only resolves the event-to-task topology and never recreates grant, role, expiration, or
 * public-baseline rules.
 */
export async function buildTaskBearingEventVisibility(
  viewers: readonly TaskEventViewer[],
): Promise<TaskBearingEventVisibility> {
  const uniqueViewers = new Map<string, TaskEventViewer>();
  for (const viewer of viewers) {
    uniqueViewers.set(`${viewer.organizationId}\u0000${viewer.actorId}`, viewer);
  }
  const filters = await Promise.all(
    [...uniqueViewers.values()].map(async (viewer) => ({
      organizationId: viewer.organizationId,
      filter: await buildTaskViewFilter(viewer.organizationId, viewer.actorId),
    })),
  );
  const filtersByOrganization = new Map<string, ((task: ViewableTaskParts) => boolean)[]>();
  for (const { organizationId, filter } of filters) {
    const organizationFilters = filtersByOrganization.get(organizationId) ?? [];
    organizationFilters.push(filter);
    filtersByOrganization.set(organizationId, organizationFilters);
  }

  return {
    async filterStreamEvents<T extends TaskBearingStreamEventRow>(
      rows: readonly T[],
    ): Promise<T[]> {
      return filterTaskBearingRows(
        rows,
        await taskRelationsForStreamEvents(rows),
        filtersByOrganization,
      );
    },
    async filterAuditEvents<T extends TaskBearingAuditEventRow>(rows: readonly T[]): Promise<T[]> {
      return filterTaskBearingRows(
        rows,
        await taskRelationsForAuditEvents(rows),
        filtersByOrganization,
      );
    },
  };
}

/**
 * Scan ordered source rows until a visibility-filtered page is full or exhausted.
 *
 * @remarks
 * The returned page cursor must be derived from its final visible row, not the final raw row.
 * Continuing from that visible row deliberately re-scans intervening hidden rows, which keeps a
 * later visible row reachable when private events sit between two public/granted events.
 */
export async function collectVisibilityFilteredPage<T, Cursor>(
  scan: VisibilityPageScan<T, Cursor>,
): Promise<VisibilityFilteredPage<T>> {
  const batchSize = Math.max(EVENT_PAGE_SCAN_SIZE, scan.limit + 1);
  const items: T[] = [];
  let cursor = scan.initialCursor;

  for (;;) {
    const rows = await scan.fetch(cursor, batchSize);
    if (rows.length === 0) return { items, hasMore: false };
    for (const row of await scan.filter(rows)) {
      items.push(row);
      if (items.length > scan.limit) {
        return { items: items.slice(0, scan.limit), hasMore: true };
      }
    }
    if (rows.length < batchSize) return { items, hasMore: false };
    const last = rows[rows.length - 1];
    /* v8 ignore next -- @preserve non-empty rows always have a last element */
    if (!last) return { items, hasMore: false };
    cursor = scan.cursorOf(last);
  }
}

/** Resolve the user's currently active human actors in the event's organization. */
async function activeUserTaskEventViewers(
  userId: string,
  organizationId: string,
): Promise<TaskEventViewer[]> {
  return db
    .select({ actorId: actor.id, organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
}

/**
 * Decide whether one user may currently receive a persisted task-bearing stream event.
 *
 * Non-task events intentionally retain the event bus's existing recipient behavior. The live
 * edge invokes this immediately before publishing and again immediately before writing SSE data,
 * so recipient rows produced before a grant revocation cannot authorize later delivery.
 */
export async function canUserReceiveTaskBearingStreamEvent(
  userId: string,
  row: TaskBearingStreamEventRow,
): Promise<boolean> {
  if (
    row.entityKind !== 'work_item' &&
    row.entityKind !== 'agent_session' &&
    !manuallyLinkedTask(row)
  ) {
    return true;
  }
  if (row.entityKind === 'work_item' && !row.docketEntityId) return true;
  const visibility = await buildTaskBearingEventVisibility(
    await activeUserTaskEventViewers(userId, row.organizationId),
  );
  return (await visibility.filterStreamEvents([row])).length === 1;
}

/**
 * Recheck a queued live event against current task access immediately before SSE serialization.
 *
 * A bus-only payload without a persisted `event` row preserves the existing best-effort behavior;
 * production event emission always supplies a persisted row through {@link publishEvent}.
 */
export async function canDeliverQueuedStreamEvent(
  userId: string,
  eventId: string,
): Promise<boolean> {
  const [row] = await db.select().from(event).where(eq(event.id, eventId)).limit(1);
  return row ? canUserReceiveTaskBearingStreamEvent(userId, row) : true;
}

/** Coarse rendering category per kind — drives grouping/tone, source-agnostic. */
function categoryFor(kind: EventKind): string {
  switch (kind) {
    case 'mention':
    case 'comment':
    case 'message':
    case 'reaction':
    case 'email_received':
      return 'social';
    case 'assignment':
    case 'task_assignment':
    case 'elicitation_requested':
    case 'agent_blocked':
      return 'inbound';
    case 'status_change':
    case 'completed':
    case 'created':
    case 'field_change':
    case 'elicitation_answered':
    case 'elicitation_expired':
    case 'agent_started':
    case 'agent_progress':
    case 'agent_completed':
    case 'agent_failed':
      return 'progress';
    case 'calendar_invite':
    case 'calendar_update':
    case 'meeting_attended':
      return 'calendar';
    case 'timer_started':
    case 'timer_paused':
    case 'timer_resumed':
    case 'timer_switched':
    case 'timer_stopped':
      return 'tracking';
    default:
      return 'other';
  }
}

/**
 * Project one event row (+ its personal-feed relevance) to the feed DTO.
 *
 * @param row - The event row.
 * @param relevance - The recipient reason for a legacy projection, or `null` for timelines.
 * @param viewerActorIds - Docket actor ids that represent the current caller in this context.
 */
export function toStreamEventOut(
  row: EventRow,
  relevance: StreamRelevance | null,
  viewerActorIds: ReadonlySet<string> = new Set(),
): z.input<typeof StreamEventOut> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    source: {
      system: row.sourceSystem,
      integrationId: row.integrationId,
      externalUrl: row.externalUrl,
    },
    kind: row.kind,
    occurredAt: row.occurredAt.toISOString(),
    title: row.title,
    summary: row.summary,
    permalink: row.permalink,
    actor: row.actor,
    entity: row.entity,
    participants: row.participants,
    detail: row.detail,
    actorIsViewer: Boolean(row.actor?.docketActorId && viewerActorIds.has(row.actor.docketActorId)),
    relevance,
    rendering: { icon: row.kind, category: categoryFor(row.kind) },
    createdAt: row.createdAt.toISOString(),
  };
}

/** One recipient of a freshly-created event, with the reason it concerns them. */
export interface StreamRecipient {
  readonly userId: string;
  readonly reason: StreamRelevance;
}

/**
 * Publish a just-created event to its recipients' live SSE connections (best-effort).
 *
 * @remarks
 * Fetches the row once, rechecks each recipient's current task visibility, and fans
 * `toStreamEventOut(row, reason)` to eligible recipients via the in-process {@link publish} bus.
 * Called after the emit/drain inserts commit; never throws into the caller's write path (the
 * caller catches).
 *
 * @param eventId - The event just inserted.
 * @param recipients - The users it reached, with each one's relevance reason.
 */
export async function publishEvent(
  eventId: string,
  recipients: readonly StreamRecipient[],
): Promise<void> {
  if (recipients.length === 0) return;
  const [row] = await db.select().from(event).where(eq(event.id, eventId)).limit(1);
  if (!row) return;
  for (const r of recipients) {
    if (await canUserReceiveTaskBearingStreamEvent(r.userId, row)) {
      publish(r.userId, toStreamEventOut(row, r.reason));
    }
  }
}
