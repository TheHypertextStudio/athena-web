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
 * Naming is enforced here rather than at stop time, and it is enforced structurally: this module
 * refuses to produce an anchor without a non-empty trimmed title, so a nameless tracking session
 * has no representation to begin with. {@link ../time/commands.stopTimeRecord} still re-checks
 * at stop — see its remarks for why a redundant guard is the right call.
 */
import { actor, db, organization, task, team } from '@docket/db';
import { and, asc, desc, eq } from 'drizzle-orm';

import { ConflictError, NotFoundError, ValidationError } from '../error';

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
  /** The person's own words. Becomes the new task's title when one is created. */
  readonly label: string;
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
async function actorIdFor(userId: string, organizationId: string): Promise<string | null> {
  const rows = await db
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
async function anchorToExistingTask(userId: string, taskId: string): Promise<TaskAnchor> {
  const rows = await db
    .select({ id: task.id, title: task.title, organizationId: task.organizationId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Task not found');
  const actorId = await actorIdFor(userId, row.organizationId);
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
 */
async function resolveTargetOrganization(
  userId: string,
  requested: string | undefined,
): Promise<string> {
  if (requested) {
    const actorId = await actorIdFor(userId, requested);
    if (!actorId) throw new NotFoundError('Workspace not found');
    return requested;
  }
  const memberships = await db
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
  userId: string,
  label: string,
  requestedOrganizationId: string | undefined,
): Promise<TaskAnchor> {
  const title = requireTrackingName(label);
  const organizationId = await resolveTargetOrganization(userId, requestedOrganizationId);
  const actorId = await actorIdFor(userId, organizationId);
  const teamRows = await db
    .select({ id: team.id, workflowStates: team.workflowStates })
    .from(team)
    .where(eq(team.organizationId, organizationId))
    .orderBy(asc(team.createdAt))
    .limit(1);
  const teamRow = teamRows[0];
  if (!teamRow) throw new ConflictError('Create a team before tracking time');
  const state = teamRow.workflowStates[0]?.key ?? 'backlog';
  const inserted = await db
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
 * @param userId - The tracking user.
 * @param request - How the caller named what they are working on.
 * @returns the resolved {@link TaskAnchor}.
 *
 * @throws {ValidationError} When the label is empty or whitespace-only.
 * @throws {NotFoundError} When a named task or workspace is not visible to the caller.
 */
export async function resolveTaskAnchor(
  userId: string,
  request: TaskAnchorRequest,
): Promise<TaskAnchor> {
  requireTrackingName(request.label);
  if (request.taskId) return anchorToExistingTask(userId, request.taskId);
  return anchorToNewTask(userId, request.label, request.organizationId);
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
