/**
 * `@docket/api` — the task an Athena session's work is about.
 */
import type { TurnSubjectTask } from '@docket/athena/turn';
import { db, sessionActivity, task } from '@docket/db';
import { and, asc, eq } from 'drizzle-orm';

import { activePlanContext } from '../lib/plan-draft/context';
import type { ActivePlanContext } from './system-prompt';

/**
 * The task a session's work is about: the task the person asked from, else the task the work was
 * filed as.
 *
 * @remarks
 * The task the person asked from is the `source` of the invocation context stamped on the
 * session's opening `response` row; it was authorized against the caller when the work began.
 *
 * @param sessionId - The session being run.
 * @param taskId - The session's own task link.
 * @returns the task and its workspace, or undefined when the work has no task that still exists.
 */
export async function sessionSubjectTask(
  sessionId: string,
  taskId: string | null,
): Promise<TurnSubjectTask | undefined> {
  const opening = await db
    .select({ body: sessionActivity.body })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.type, 'response')))
    .orderBy(asc(sessionActivity.createdAt))
    .limit(1);
  const source = opening[0]?.body.context?.source;
  const subjectId = source?.type === 'task' ? source.id : taskId;
  if (!subjectId) return undefined;
  const rows = await db
    .select({ id: task.id, organizationId: task.organizationId })
    .from(task)
    .where(eq(task.id, subjectId))
    .limit(1);
  return rows[0];
}

/** What a run tells the model about the work before its first turn. */
export interface PromptContext {
  /** The plan open on the canvas, when there is one. */
  readonly activePlan: ActivePlanContext | null;
  /** The task this work is about, when it has one. */
  readonly subjectTask: TurnSubjectTask | undefined;
}

/**
 * The plan and the task a session's run is about.
 *
 * @param sessionId - The session being run.
 * @param taskId - The session's own task link.
 */
export async function promptContext(
  sessionId: string,
  taskId: string | null,
): Promise<PromptContext> {
  const [activePlan, subjectTask] = await Promise.all([
    activePlanContext(sessionId),
    sessionSubjectTask(sessionId, taskId),
  ]);
  return { activePlan, subjectTask };
}
