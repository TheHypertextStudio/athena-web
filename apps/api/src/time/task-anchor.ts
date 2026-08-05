/**
 * `time/task-anchor` — resolving the ordinary Docket Task a tracking session is anchored to.
 *
 * @remarks
 * The universal timer has exactly one subject, and it is a normal Task. There is deliberately no
 * timer-only entity: a session started from a task detail page anchors to that task, and a
 * session started from the shell with a freeform name *creates* a task, in a real workspace, on
 * a real team, in that team's first workflow state — assignable, schedulable, and completable
 * like anything else in the list. That is what "this task is a normal Docket task" has to mean
 * for the tracked time to reconcile against project, program, initiative and workspace rollups
 * at all.
 *
 * Naming is enforced at **stop**, not at start. A session may run without an anchor — that is what
 * lets the timer begin on one click and ask what the work was afterwards — but it cannot *finish*
 * without one. The guarantee is held by the `time_record_closed_requires_anchor` constraint in the
 * database rather than by this module refusing to produce an anchor, because an invariant that
 * holds only while one write path remembers to validate is one refactor away from being lost.
 * {@link ../time/commands.stopTimeRecord} is where the caller is asked, and
 * {@link anchorExistingRecord} is what turns their answer into the anchor.
 */
import {
  actor,
  db,
  organization,
  task,
  team,
  timeAllocation,
  timeInterval,
  timeRecord,
} from '@docket/db';
import { and, asc, desc, eq } from 'drizzle-orm';

import { ConflictError, NotFoundError, ValidationError } from '../error';

/**
 * A transaction handle, or the pooled connection when there is no transaction in play.
 *
 * @remarks
 * Every helper below takes one rather than closing over `db`, because {@link anchorExistingRecord}
 * has to create the task and stamp it onto the record and all of its segments as one atomic act.
 * A read against the outer `db` from inside a transaction does not see that transaction's own
 * writes and, on the embedded Postgres used in development, stalls outright.
 */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A resolved tracking subject: an existing Task row's identity plus its workspace. */
export interface TaskAnchor {
  readonly taskId: string;
  readonly organizationId: string;
  /** The task's title at the moment tracking began — the record's own label. */
  readonly title: string;
  /** The caller's human Actor in that workspace, for event attribution. */
  readonly actorId: string | null;
  /** Whether this anchor was created by the timer rather than picked from existing work. */
  readonly created: boolean;
}

/** How a caller named what they are tracking. */
export interface TaskAnchorRequest {
  /** An existing Docket task to track. */
  readonly taskId?: string | undefined;
  /** Where to create the task when `taskId` is absent. */
  readonly organizationId?: string | undefined;
  /**
   * The person's own words. Becomes the new task's title when one is created.
   *
   * Absent alongside `taskId` means the session starts unanchored and is named later.
   */
  readonly label?: string | undefined;
}

/**
 * Reject a title that is empty or only whitespace, naming the offending field.
 *
 * @remarks
 * Raised as a {@link ValidationError} so the wire answer is the same `validation_error` Problem
 * with a `too_small` field issue that every other empty-required-string produces. A client
 * branches on the stable code and its own field path — never on a server sentence, which the
 * UI-copy rule forbids rendering.
 *
 * @param label - The proposed name.
 * @param field - The Problem `fieldErrors` key to report the failure under.
 * @returns the trimmed, non-empty name.
 * @throws {ValidationError} When the name is empty or whitespace-only.
 */
export function requireTrackingName(
  label: string | null | undefined,
  field = 'context.label',
): string {
  const trimmed = (label ?? '').trim();
  if (trimmed.length === 0) {
    throw new ValidationError([
      { message: 'A tracked task must be named', path: field.split('.') },
    ]);
  }
  return trimmed;
}

/** Resolve the caller's active human Actor in a workspace, or null when they have none. */
async function actorIdFor(
  executor: Executor,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await executor
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Load an existing task the caller may track, hiding cross-tenant rows as not found. */
async function anchorToExistingTask(
  executor: Executor,
  userId: string,
  taskId: string,
): Promise<TaskAnchor> {
  const rows = await executor
    .select({ id: task.id, title: task.title, organizationId: task.organizationId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Task not found');
  const actorId = await actorIdFor(executor, userId, row.organizationId);
  if (!actorId) throw new NotFoundError('Task not found');
  return {
    taskId: row.id,
    organizationId: row.organizationId,
    title: requireTrackingName(row.title),
    actorId,
    created: false,
  };
}

/**
 * Pick the workspace a freeform tracking session lands in.
 *
 * @remarks
 * The caller's personal workspace is the default because tracking is personal by nature and a
 * quick "start a timer, I'll say what it was" should never require choosing an audience first.
 * An explicit `organizationId` always wins, so starting from inside a team workspace keeps the
 * created task where the work actually lives.
 *
 * Exported because an unanchored session has no task to read a workspace from, and its lifecycle
 * events still have to be attributed somewhere. Attributing them here means the event lands in the
 * same workspace the task itself will land in once the session is named.
 */
export async function resolveTargetOrganization(
  executor: Executor,
  userId: string,
  requested: string | undefined,
): Promise<string> {
  if (requested) {
    const actorId = await actorIdFor(executor, userId, requested);
    if (!actorId) throw new NotFoundError('Workspace not found');
    return requested;
  }
  const memberships = await executor
    .select({ id: organization.id })
    .from(actor)
    .innerJoin(organization, eq(organization.id, actor.organizationId))
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human'), eq(actor.status, 'active')))
    // `desc` on a boolean puts `true` first, so the personal space wins whenever one exists.
    .orderBy(desc(organization.isPersonal), asc(organization.createdAt));
  const chosen = memberships[0];
  if (!chosen) throw new ConflictError('Create a workspace before tracking time');
  return chosen.id;
}

/** Create the ordinary Task a freeform tracking session is about. */
async function anchorToNewTask(
  executor: Executor,
  userId: string,
  label: string,
  requestedOrganizationId: string | undefined,
): Promise<TaskAnchor> {
  const title = requireTrackingName(label);
  const organizationId = await resolveTargetOrganization(executor, userId, requestedOrganizationId);
  const actorId = await actorIdFor(executor, userId, organizationId);
  const teamRows = await executor
    .select({ id: team.id, workflowStates: team.workflowStates })
    .from(team)
    .where(eq(team.organizationId, organizationId))
    .orderBy(asc(team.createdAt))
    .limit(1);
  const teamRow = teamRows[0];
  if (!teamRow) throw new ConflictError('Create a team before tracking time');
  const state = teamRow.workflowStates[0]?.key ?? 'backlog';
  const inserted = await executor
    .insert(task)
    .values({
      organizationId,
      title,
      teamId: teamRow.id,
      state,
      source: 'native',
      createdBy: actorId,
      ...(actorId ? { assigneeId: actorId } : {}),
    })
    .returning({ id: task.id, title: task.title });
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (!row) throw new Error('task insert returned no row');
  return { taskId: row.id, organizationId, title: row.title, actorId, created: true };
}

/**
 * Resolve the Task a tracking session is anchored to, creating one when the caller only named it.
 *
 * @remarks
 * Returns `null` when the caller supplied neither a task nor a name. That is not a failure — it is
 * a person starting the clock before they have decided what to call the work, and the session runs
 * unanchored until {@link anchorExistingRecord} is given an answer.
 *
 * @param userId - The tracking user.
 * @param request - How the caller named what they are working on.
 * @returns the resolved {@link TaskAnchor}, or null for a deliberately nameless start.
 *
 * @throws {NotFoundError} When a named task or workspace is not visible to the caller.
 */
export async function resolveTaskAnchor(
  userId: string,
  request: TaskAnchorRequest,
): Promise<TaskAnchor | null> {
  if (request.taskId) return anchorToExistingTask(db, userId, request.taskId);
  if ((request.label ?? '').trim().length === 0) return null;
  return anchorToNewTask(db, userId, request.label ?? '', request.organizationId);
}

/**
 * Give a running unanchored session its subject, in the transaction that is about to close it.
 *
 * @remarks
 * The record, every one of its segments, and its reportable allocation are all stamped from the
 * same resolved task. The denormalized `time_interval.task_id` is what a breakdown sums — a record
 * that carried an anchor its segments did not would report zero against the task it names — and
 * the allocation is what gives the session credit at all, which it could not have while it had no
 * subject to credit.
 *
 * The caller must already hold the transaction. Splitting the naming from the close would leave a
 * named-but-still-running session behind whenever the second write failed, which is the exact
 * half-finished state the person was trying to get out of.
 *
 * @param tx - The open transaction; every write here must be on it.
 * @param userId - The tracking user, who becomes the new task's assignee.
 * @param recordId - The unanchored record to name.
 * @param label - The person's own words.
 * @param organizationId - Where the task lands; defaults to the caller's personal workspace.
 * @returns the newly created {@link TaskAnchor}.
 *
 * @throws {ValidationError} When the label is empty or whitespace-only.
 */
export async function anchorExistingRecord(
  tx: Executor,
  userId: string,
  recordId: string,
  label: string,
  organizationId: string | undefined,
): Promise<TaskAnchor> {
  const anchor = await anchorToNewTask(tx, userId, label, organizationId);
  await tx
    .update(timeRecord)
    .set({ taskId: anchor.taskId, title: anchor.title })
    .where(eq(timeRecord.id, recordId));
  await tx
    .update(timeInterval)
    .set({ taskId: anchor.taskId })
    .where(eq(timeInterval.timeRecordId, recordId));
  await tx.insert(timeAllocation).values({
    timeRecordId: recordId,
    targetKind: 'task',
    targetId: anchor.taskId,
    organizationId: anchor.organizationId,
    basisPoints: 10_000,
  });
  return anchor;
}

/** Read one anchor's current title + workspace, for guards and public reads. */
export async function readTaskAnchor(
  taskId: string,
): Promise<{ title: string; organizationId: string } | null> {
  const rows = await db
    .select({ title: task.title, organizationId: task.organizationId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  const row = rows[0];
  return row ? { title: row.title, organizationId: row.organizationId } : null;
}
