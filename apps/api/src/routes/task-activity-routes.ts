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
import { taskCreationEntryId } from '@docket/work/task-model';
import {
  TaskActivityChange,
  TaskActivityOut,
  TaskActivityQuery,
} from '@docket/connections/activity-contract';
import { and, asc, eq, inArray, isNull, or, sql, type SQLWrapper } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam, zQuery } from '../lib/validate';

import { buildTaskViewFilter, idParam, loadTask } from './task-helpers';

type ActivityEntry = z.input<typeof TaskActivityOut>;

/** Fields from a child that alter a parent's understanding of its contained work. */
const MEANINGFUL_CHILD_FIELDS = new Set(['description', 'state', 'assigneeId', 'dueDate']);

/** Fields from a blocker that can alter whether the current task may proceed. */
const DEPENDENCY_READINESS_FIELDS = new Set(['state', 'dueDate']);

/** Encode one `(createdAt, id)` position without exposing a storage-table cursor. */
function encodeActivityCursor(entry: ActivityEntry): string {
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

/** Read safe application text from a session activity body. */
function sessionBody(body: Record<string, unknown>, type: string): string | null {
  if (type === 'error') return 'An automated task update could not be completed.';
  const action = body['action'];
  if (action && typeof action === 'object') {
    const summary = (action as Record<string, unknown>)['summary'];
    if (typeof summary === 'string' && summary.length > 0) return summary;
  }
  const text = body['text'];
  return typeof text === 'string' && text.length > 0 ? text : null;
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
          taskId: id,
          actorId: null,
          actorName: null,
          type: 'updated',
          category: 'task',
          change: null,
          body: null,
          subjectTaskId: null,
          subjectTaskTitle: null,
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

    const entries: ActivityEntry[] = [
      {
        id: taskCreationEntryId(taskRow.id),
        taskId: taskRow.id,
        actorId: taskRow.createdBy,
        actorName: creatorRows[0]?.name ?? null,
        type: 'created',
        category: 'task',
        change: null,
        body: null,
        subjectTaskId: null,
        subjectTaskTitle: null,
        createdAt: taskRow.createdAt.toISOString(),
      },
    ];
    for (const child of childCreations) {
      entries.push({
        id: `child-created:${child.id}`,
        taskId: id,
        actorId: child.createdBy,
        actorName: child.actorName,
        type: 'child',
        category: 'subtask',
        change: null,
        body: null,
        subjectTaskId: child.id,
        subjectTaskTitle: child.title,
        createdAt: child.createdAt.toISOString(),
      });
    }
    for (const row of directLedger) {
      const parsed = TaskActivityChange.safeParse(row.metadata);
      if (!parsed.success) continue;
      entries.push({
        id: `audit:${row.id}`,
        taskId: id,
        actorId: row.actorId,
        actorName: row.actorName,
        type: 'updated',
        category:
          parsed.data.field === 'resource'
            ? 'resource'
            : parsed.data.field === 'dependency' || parsed.data.field === 'relatedTask'
              ? 'relationship'
              : parsed.data.field === 'subtask'
                ? 'subtask'
                : 'task',
        change: parsed.data,
        body: null,
        subjectTaskId: null,
        subjectTaskTitle: null,
        createdAt: row.createdAt.toISOString(),
      });
    }
    for (const row of comments) {
      entries.push({
        id: `comment:${row.id}`,
        taskId: id,
        actorId: row.authorId,
        actorName: row.actorName,
        type: 'comment',
        category: 'comment',
        change: null,
        body: row.body,
        subjectTaskId: null,
        subjectTaskTitle: null,
        createdAt: row.createdAt.toISOString(),
      });
    }
    for (const row of timerEvents) {
      entries.push({
        id: `event:${row.id}`,
        taskId: id,
        actorId: row.actor?.docketActorId ?? null,
        actorName: row.actor?.displayName ?? null,
        type: 'timer',
        category: 'time',
        change: null,
        body: row.title,
        subjectTaskId: null,
        subjectTaskTitle: null,
        createdAt: row.occurredAt.toISOString(),
      });
    }
    for (const row of taskSessions) {
      entries.push({
        id: `session:${row.id}`,
        taskId: id,
        actorId: null,
        actorName: null,
        type: 'session',
        category: 'automation',
        change: null,
        body: sessionBody(row.body, row.type),
        subjectTaskId: null,
        subjectTaskTitle: null,
        createdAt: row.createdAt.toISOString(),
      });
    }
    for (const row of childLedger) {
      const parsed = TaskActivityChange.safeParse(row.metadata);
      if (!parsed.success || !MEANINGFUL_CHILD_FIELDS.has(parsed.data.field)) {
        continue;
      }
      entries.push({
        id: `child:${row.id}`,
        taskId: id,
        actorId: row.actorId,
        actorName: row.actorName,
        type: 'child',
        category: 'subtask',
        change: parsed.data,
        body: null,
        subjectTaskId: row.taskId,
        subjectTaskTitle: row.taskTitle,
        createdAt: row.createdAt.toISOString(),
      });
    }
    for (const row of blockerLedger) {
      const parsed = TaskActivityChange.safeParse(row.metadata);
      if (!parsed.success || !DEPENDENCY_READINESS_FIELDS.has(parsed.data.field)) {
        continue;
      }
      if (
        parsed.data.field === 'state' &&
        !/done|cancel|block/i.test(`${parsed.data.from ?? ''} ${parsed.data.to ?? ''}`)
      ) {
        continue;
      }
      entries.push({
        id: `dependency:${row.id}`,
        taskId: id,
        actorId: row.actorId,
        actorName: row.actorName,
        type: 'dependency',
        category: 'relationship',
        change: parsed.data,
        body: null,
        subjectTaskId: row.taskId,
        subjectTaskTitle: row.taskTitle,
        createdAt: row.createdAt.toISOString(),
      });
    }

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
