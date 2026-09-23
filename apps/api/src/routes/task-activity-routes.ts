/**
 * `@docket/api` — one chronological Activity projection for a task.
 *
 * @remarks
 * Task Activity reads the records that already own each fact. The audit ledger owns task
 * mutations, `comment` owns discussion, `event` owns timers, and `session_activity` owns
 * delegated execution updates. This route only combines them where a reader needs one answer:
 * what has happened to this task?
 */
import {
  actor,
  agentSession,
  auditEvent,
  comment,
  db,
  event,
  sessionActivity,
  task,
  taskDependency,
} from '@docket/db';
import { pageOf } from '../contracts/pagination';
import { TaskActivityOut, TaskActivityQuery } from '@docket/connections/activity-contract';
import { and, asc, eq, inArray, isNull, or, sql, type SQLWrapper } from 'drizzle-orm';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam, zQuery } from '../lib/validate';

import { originOf } from '../mcp/change-set';
import { activityEntries, creationEntry, type ActivityEntry } from './task-activity-entries';
import { buildTaskViewFilter, idParam, loadTask } from './task-helpers';

/** The position an Activity cursor encodes. */
type CursorPosition = Pick<ActivityEntry, 'createdAt' | 'id'>;

/** Encode one `(createdAt, id)` position without exposing a storage-table cursor. */
function encodeActivityCursor(entry: CursorPosition): string {
  return Buffer.from(`${entry.createdAt}|${entry.id}`, 'utf8').toString('base64url');
}

/** Decode an Activity cursor. Invalid cursors restart at the first entry. */
function decodeActivityCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!at || !id || Number.isNaN(Date.parse(at))) return null;
    return { at, id };
  } catch {
    return null;
  }
}

/** Keep only entries strictly after an ascending `(createdAt, id)` cursor. */
function afterCursor(
  entries: readonly ActivityEntry[],
  cursor: string | undefined,
): ActivityEntry[] {
  const position = decodeActivityCursor(cursor);
  if (!position) return [...entries];
  return entries.filter(
    (entry) =>
      entry.createdAt > position.at || (entry.createdAt === position.at && entry.id > position.id),
  );
}

/** Build the source-local keyset predicate for one entry prefix. */
function sourceAfter(
  createdAt: SQLWrapper,
  id: SQLWrapper,
  entryPrefix: string,
  cursor: string | undefined,
) {
  const position = decodeActivityCursor(cursor);
  if (!position) return undefined;
  const at = new Date(position.at);
  if (position.id.startsWith(entryPrefix)) {
    return sql`(${createdAt} > ${at} OR (${createdAt} = ${at} AND ${id} > ${position.id.slice(entryPrefix.length)}))`;
  }
  return entryPrefix.localeCompare(position.id) < 0
    ? sql`${createdAt} > ${at}`
    : sql`${createdAt} >= ${at}`;
}

/** The canonical task Activity route, mounted on the tasks router at `/`. */
export const taskActivityRoutes = new Hono<AppEnv>().get(
  '/:id/activity',
  apiDoc({
    tag: 'Tasks',
    summary: "Get a task's Activity",
    response: pageOf(TaskActivityOut),
    description:
      'Return one cursor-paginated chronological record for a task. It combines creation, task changes, comments, timer transitions, delegated execution updates, meaningful direct-child changes, and dependency changes that alter readiness. `category` narrows this one history; it never switches to a separate comments, history, or execution feed.',
  }),
  zParam(idParam),
  zQuery(TaskActivityQuery),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const query = c.req.valid('query');
    const sourceLimit = query.limit + 1;
    const taskRow = await loadTask(orgId, id);
    const canView = await buildTaskViewFilter(orgId, actorId);
    if (!canView(taskRow)) throw new NotFoundError('Task not found');
    const readVisibleSource = async <T extends { readonly id: string; readonly createdAt: Date }>(
      entryPrefix: string,
      read: (cursor: string | undefined) => Promise<readonly T[]>,
      toViewable: (row: T) => Parameters<typeof canView>[0],
    ): Promise<T[]> => {
      const visible: T[] = [];
      let cursor = query.cursor;
      while (visible.length < sourceLimit) {
        const batch = await read(cursor);
        for (const row of batch) {
          if (canView(toViewable(row))) visible.push(row);
        }
        if (batch.length < sourceLimit) break;
        const last = batch.at(-1);
        if (!last) break;
        cursor = encodeActivityCursor({
          id: `${entryPrefix}${last.id}`,
          createdAt: last.createdAt.toISOString(),
        });
      }
      return visible.slice(0, sourceLimit);
    };

    const creatorRows = taskRow.createdBy
      ? await db
          .select({ name: actor.displayName })
          .from(actor)
          .where(and(eq(actor.id, taskRow.createdBy), eq(actor.organizationId, orgId)))
          .limit(1)
      : [];
    const directLedger = await db
      .select({
        id: auditEvent.id,
        actorId: auditEvent.actorId,
        actorName: actor.displayName,
        metadata: auditEvent.metadata,
        origin: auditEvent.origin,
        createdAt: auditEvent.createdAt,
      })
      .from(auditEvent)
      .leftJoin(actor, eq(auditEvent.actorId, actor.id))
      .where(
        and(
          eq(auditEvent.organizationId, orgId),
          eq(auditEvent.subjectType, 'task'),
          eq(auditEvent.subjectId, id),
          eq(auditEvent.type, 'updated'),
          sourceAfter(auditEvent.createdAt, auditEvent.id, 'audit:', query.cursor),
        ),
      )
      .orderBy(asc(auditEvent.createdAt), asc(auditEvent.id))
      .limit(sourceLimit);
    const comments = await db
      .select({
        id: comment.id,
        authorId: comment.authorId,
        actorName: actor.displayName,
        body: comment.body,
        createdAt: comment.createdAt,
      })
      .from(comment)
      .leftJoin(actor, eq(comment.authorId, actor.id))
      .where(
        and(
          eq(comment.organizationId, orgId),
          eq(comment.subjectType, 'task'),
          eq(comment.subjectId, id),
          sourceAfter(comment.createdAt, comment.id, 'comment:', query.cursor),
        ),
      )
      .orderBy(asc(comment.createdAt), asc(comment.id))
      .limit(sourceLimit);
    const timerEvents = await db
      .select({
        id: event.id,
        actor: event.actor,
        title: event.title,
        occurredAt: event.occurredAt,
      })
      .from(event)
      .where(
        and(
          eq(event.organizationId, orgId),
          eq(event.docketEntityId, id),
          inArray(event.kind, [
            'timer_started',
            'timer_paused',
            'timer_resumed',
            'timer_switched',
            'timer_stopped',
          ]),
          sourceAfter(event.occurredAt, event.id, 'event:', query.cursor),
        ),
      )
      .orderBy(asc(event.occurredAt), asc(event.id))
      .limit(sourceLimit);
    const taskSessions = await db
      .select({
        id: sessionActivity.id,
        type: sessionActivity.type,
        body: sessionActivity.body,
        createdAt: sessionActivity.createdAt,
      })
      .from(sessionActivity)
      .innerJoin(agentSession, eq(sessionActivity.sessionId, agentSession.id))
      .where(
        and(
          eq(agentSession.taskId, id),
          or(eq(agentSession.organizationId, orgId), eq(agentSession.contextOrganizationId, orgId)),
          sourceAfter(sessionActivity.createdAt, sessionActivity.id, 'session:', query.cursor),
        ),
      )
      .orderBy(asc(sessionActivity.createdAt), asc(sessionActivity.id))
      .limit(sourceLimit);

    const childCreations = await readVisibleSource(
      'child-created:',
      (cursor) =>
        db
          .select({
            id: task.id,
            title: task.title,
            createdBy: task.createdBy,
            createdAt: task.createdAt,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
            visibility: task.visibility,
            actorName: actor.displayName,
          })
          .from(task)
          .leftJoin(actor, eq(task.createdBy, actor.id))
          .where(
            and(
              eq(task.organizationId, orgId),
              eq(task.parentTaskId, id),
              isNull(task.archivedAt),
              sourceAfter(task.createdAt, task.id, 'child-created:', cursor),
            ),
          )
          .orderBy(asc(task.createdAt), asc(task.id))
          .limit(sourceLimit),
      (row) => row,
    );
    const childLedger = await readVisibleSource(
      'child:',
      (cursor) =>
        db
          .select({
            id: auditEvent.id,
            actorId: auditEvent.actorId,
            actorName: actor.displayName,
            taskId: task.id,
            taskTitle: task.title,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
            visibility: task.visibility,
            metadata: auditEvent.metadata,
            origin: auditEvent.origin,
            createdAt: auditEvent.createdAt,
          })
          .from(auditEvent)
          .innerJoin(
            task,
            and(
              eq(auditEvent.subjectId, task.id),
              eq(task.organizationId, orgId),
              eq(task.parentTaskId, id),
              isNull(task.archivedAt),
            ),
          )
          .leftJoin(actor, eq(auditEvent.actorId, actor.id))
          .where(
            and(
              eq(auditEvent.organizationId, orgId),
              eq(auditEvent.subjectType, 'task'),
              eq(auditEvent.type, 'updated'),
              sourceAfter(auditEvent.createdAt, auditEvent.id, 'child:', cursor),
            ),
          )
          .orderBy(asc(auditEvent.createdAt), asc(auditEvent.id))
          .limit(sourceLimit),
      (row) => ({
        id: row.taskId,
        teamId: row.teamId,
        projectId: row.projectId,
        programId: row.programId,
        visibility: row.visibility,
      }),
    );
    const blockerLedger = await readVisibleSource(
      'dependency:',
      (cursor) =>
        db
          .select({
            id: auditEvent.id,
            actorId: auditEvent.actorId,
            actorName: actor.displayName,
            taskId: task.id,
            taskTitle: task.title,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
            visibility: task.visibility,
            metadata: auditEvent.metadata,
            origin: auditEvent.origin,
            createdAt: auditEvent.createdAt,
          })
          .from(auditEvent)
          .innerJoin(
            taskDependency,
            and(
              eq(auditEvent.subjectId, taskDependency.blockingTaskId),
              eq(taskDependency.organizationId, orgId),
              eq(taskDependency.blockedTaskId, id),
            ),
          )
          .innerJoin(
            task,
            and(
              eq(auditEvent.subjectId, task.id),
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
            ),
          )
          .leftJoin(actor, eq(auditEvent.actorId, actor.id))
          .where(
            and(
              eq(auditEvent.organizationId, orgId),
              eq(auditEvent.subjectType, 'task'),
              eq(auditEvent.type, 'updated'),
              sourceAfter(auditEvent.createdAt, auditEvent.id, 'dependency:', cursor),
            ),
          )
          .orderBy(asc(auditEvent.createdAt), asc(auditEvent.id))
          .limit(sourceLimit),
      (row) => ({
        id: row.taskId,
        teamId: row.teamId,
        projectId: row.projectId,
        programId: row.programId,
        visibility: row.visibility,
      }),
    );

    const created = await originOf('task', taskRow.id);
    const entries: ActivityEntry[] = [
      creationEntry(taskRow, creatorRows[0]?.name ?? null, created?.origin ?? null),
      ...activityEntries(id, {
        childCreations,
        directLedger,
        comments,
        timerEvents,
        taskSessions,
        childLedger,
        blockerLedger,
      }),
    ];

    const ordered = entries
      .filter((entry) => query.category === undefined || entry.category === query.category)
      .sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt.localeCompare(b.createdAt),
      );
    const after = afterCursor(ordered, query.cursor);
    const items = after.slice(0, query.limit);
    const next = after[query.limit];
    const lastItem = items.at(-1);
    return ok(c, pageOf(TaskActivityOut), {
      items,
      ...(next && lastItem ? { nextCursor: encodeActivityCursor(lastItem) } : {}),
    });
  },
);
