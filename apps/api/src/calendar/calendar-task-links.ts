/**
 * `@docket/api` — calendar item ↔ task link service.
 *
 * @remarks
 * Links are many-to-many between a user-scoped {@link calendarItem} and an org-scoped
 * `task`: link an existing task, create-and-link a new one, or detach. These routes are
 * mounted under `/v1/me/calendar/...` (user-scoped, no `orgContextMiddleware`), so the
 * acting org membership is resolved inline here rather than via that middleware — the
 * same actor+role join it performs, reused as a plain function instead of Hono
 * middleware. Authorization order for every mutation is: (1) calendar-item ownership,
 * (2) org membership (actor existence), (3) capability (`contribute`).
 */
import { and, eq, isNull } from 'drizzle-orm';

import { type Capability, satisfies } from '@docket/authz';
import {
  actor,
  calendarItem,
  calendarItemTaskLink,
  type Database,
  role,
  task,
  team,
} from '@docket/db';
import type { CalendarItemTaskLinkCreate, CalendarItemTaskRole } from '@docket/types';

import { buildTaskViewFilter } from '../routes/task-helpers';
import { CapabilityError, ConflictError, NotFoundError } from '../error';

type CalendarItemRow = typeof calendarItem.$inferSelect;
type CalendarItemTaskLinkRow = typeof calendarItemTaskLink.$inferSelect;
type TaskRow = typeof task.$inferSelect;
type TeamRow = typeof team.$inferSelect;

/** The minimal actor identity resolved for a (userId, organizationId) pair. */
interface ContributingActor {
  /** The resolved actor row id (distinct from the Docket user id). */
  id: string;
  /** The actor's role id, or `null` when unassigned — fed into {@link buildTaskViewFilter}. */
  roleId: string | null;
}

/** Load the caller's own calendar item, or throw {@link NotFoundError} (existence-hiding). */
async function requireOwnedItem(
  db: Database,
  userId: string,
  itemId: string,
): Promise<CalendarItemRow> {
  const rows = await db
    .select()
    .from(calendarItem)
    .where(and(eq(calendarItem.id, itemId), eq(calendarItem.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new NotFoundError('Calendar item not found');
  return row;
}

/**
 * Resolve the caller's actor for `organizationId` and assert it holds `contribute`.
 *
 * @remarks
 * Mirrors `org-context-middleware.ts`'s actor+role join (org-scoped, so a stray
 * cross-org `roleId` never leaks capabilities), adapted to a plain function since these
 * routes are user-scoped rather than mounted behind that middleware.
 *
 * @throws {NotFoundError} When the caller has no actor in `organizationId` (existence-hiding).
 * @throws {CapabilityError} When the actor's role capabilities do not satisfy `contribute`.
 */
async function requireContributingActor(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<ContributingActor> {
  const rows = await db
    .select({ actor, role })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(role.organizationId, organizationId)))
    .where(and(eq(actor.userId, userId), eq(actor.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new NotFoundError('Organization not found');

  const capabilities = (row.role !== null ? row.role.capabilities : []) as Capability[];
  if (!capabilities.some((cap) => satisfies(cap, 'contribute'))) throw new CapabilityError();

  return { id: row.actor.id, roleId: row.actor.roleId };
}

/** Load a task in `organizationId` that the actor may view, or throw {@link NotFoundError}. */
async function requireViewableTask(
  db: Database,
  input: { organizationId: string; taskId: string; actorId: string; roleId: string | null },
): Promise<TaskRow> {
  const rows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.id, input.taskId),
        eq(task.organizationId, input.organizationId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new NotFoundError('Task not found');

  const canView = await buildTaskViewFilter(input.organizationId, input.actorId, input.roleId);
  if (!canView(row)) throw new NotFoundError('Task not found');

  return row;
}

/**
 * Resolve the target team for a create-and-link task: the given `teamId` when present
 * (checked in-org), else the org's first team — the same resolution
 * `resolveTaskTarget` in `me-calendar.ts` uses for the legacy create-task flow.
 */
async function resolveTargetTeam(
  db: Database,
  organizationId: string,
  teamId: string | undefined,
): Promise<TeamRow> {
  const rows = await db
    .select()
    .from(team)
    .where(
      teamId !== undefined
        ? and(eq(team.id, teamId), eq(team.organizationId, organizationId))
        : eq(team.organizationId, organizationId),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new NotFoundError('Target team not found');
  return row;
}

/** Build the snapshot columns copied from the calendar item onto a new link row. */
function itemSnapshot(item: CalendarItemRow) {
  return {
    itemTitleSnapshot: item.title,
    itemStartsAtSnapshot: item.startsAt,
    itemEndsAtSnapshot: item.endsAt,
  };
}

/** Insert a `calendar_item_task_link` row and return it, or throw on an unexpected empty insert. */
async function insertLink(
  db: Database,
  input: {
    item: CalendarItemRow;
    taskId: string;
    organizationId: string;
    createdBy: string;
    role: CalendarItemTaskRole | undefined;
    note: string | undefined;
  },
): Promise<CalendarItemTaskLinkRow> {
  // Documented defaults, not hidden fallbacks: the DTO declares both fields optional with
  // a server-side default ('related' for role, null for note) — never a silently-guessed
  // value for something the caller was required to specify.
  const linkRole = input.role ?? 'related';
  const note = input.note ?? null;
  const inserted = await db
    .insert(calendarItemTaskLink)
    .values({
      calendarItemId: input.item.id,
      taskId: input.taskId,
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      role: linkRole,
      sort: 0,
      note,
      ...itemSnapshot(input.item),
    })
    .returning();
  const row = inserted[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (row === undefined) throw new Error('calendar item task link insert returned no row');
  return row;
}

/**
 * Link a task to a calendar item — either an existing task (`mode: 'link'`) or a newly
 * created one (`mode: 'create'`).
 *
 * @remarks
 * Common validation for both modes: the calendar item must be owned by `userId`, the
 * caller must have an actor in `input.organizationId`, and that actor's role must
 * satisfy `contribute`. Mode `'link'` additionally requires the task to exist in that
 * org and pass {@link buildTaskViewFilter} for the caller, and rejects a duplicate link
 * with {@link ConflictError}. Mode `'create'` creates the task first (same team
 * resolution and initial-state derivation as the legacy `POST /events/:id/create-task`
 * route), deriving its title from the calendar item's title when omitted.
 *
 * @param db - The database client.
 * @param input.userId - The caller's Docket user id.
 * @param input.itemId - The calendar item id to link a task to.
 * @param input.input - The validated {@link CalendarItemTaskLinkCreate} body.
 * @throws {NotFoundError} When the item, org membership, or (mode `'link'`) task is
 *   missing or not visible to the caller.
 * @throws {CapabilityError} When the actor's role lacks `contribute`.
 * @throws {ConflictError} When the task is already linked to this item.
 */
export async function linkTaskToItem(
  db: Database,
  input: { userId: string; itemId: string; input: CalendarItemTaskLinkCreate },
): Promise<{ link: CalendarItemTaskLinkRow; task: TaskRow }> {
  const { userId, itemId, input: body } = input;

  const item = await requireOwnedItem(db, userId, itemId);
  const actingActor = await requireContributingActor(db, userId, body.organizationId);

  if (body.mode === 'link') {
    const taskRow = await requireViewableTask(db, {
      organizationId: body.organizationId,
      taskId: body.taskId,
      actorId: actingActor.id,
      roleId: actingActor.roleId,
    });

    const existingLinkRows = await db
      .select({ calendarItemId: calendarItemTaskLink.calendarItemId })
      .from(calendarItemTaskLink)
      .where(
        and(
          eq(calendarItemTaskLink.calendarItemId, itemId),
          eq(calendarItemTaskLink.taskId, body.taskId),
        ),
      )
      .limit(1);
    if (existingLinkRows[0] !== undefined) {
      throw new ConflictError('This task is already linked to this calendar item');
    }

    const link = await insertLink(db, {
      item,
      taskId: taskRow.id,
      organizationId: body.organizationId,
      createdBy: actingActor.id,
      role: body.role,
      note: body.note,
    });
    return { link, task: taskRow };
  }

  // mode === 'create'
  const targetTeam = await resolveTargetTeam(db, body.organizationId, body.teamId);
  // Documented default, not a hidden fallback: the DTO declares `title` as "omitted derives
  // from the calendar item title" — the same derivation the legacy create-task route uses.
  const title = body.title ?? item.title;
  const firstState = targetTeam.workflowStates[0];
  const state = firstState !== undefined ? firstState.key : 'backlog';

  const createdRows = await db
    .insert(task)
    .values({
      organizationId: body.organizationId,
      teamId: targetTeam.id,
      createdBy: actingActor.id,
      title,
      ...(body.note !== undefined ? { description: body.note } : {}),
      state,
      priority: 'none',
    })
    .returning();
  const taskRow = createdRows[0];
  /* v8 ignore next -- @preserve defensive: insert always returns a row */
  if (taskRow === undefined) throw new Error('calendar-linked task insert returned no row');

  const link = await insertLink(db, {
    item,
    taskId: taskRow.id,
    organizationId: body.organizationId,
    createdBy: actingActor.id,
    role: body.role,
    note: body.note,
  });
  return { link, task: taskRow };
}

/**
 * Detach a task from a calendar item without deleting the task.
 *
 * @param db - The database client.
 * @param input.userId - The caller's Docket user id.
 * @param input.itemId - The calendar item id.
 * @param input.taskId - The task id to unlink.
 * @throws {NotFoundError} When the item is not owned by `userId` or no link exists.
 * @throws {CapabilityError} When the caller's actor in the link's org lacks `contribute`.
 * @returns the deleted link row (a tombstone for the response).
 */
export async function detachTaskFromItem(
  db: Database,
  input: { userId: string; itemId: string; taskId: string },
): Promise<CalendarItemTaskLinkRow> {
  const { userId, itemId, taskId } = input;

  await requireOwnedItem(db, userId, itemId);

  const linkRows = await db
    .select()
    .from(calendarItemTaskLink)
    .where(
      and(eq(calendarItemTaskLink.calendarItemId, itemId), eq(calendarItemTaskLink.taskId, taskId)),
    )
    .limit(1);
  const link = linkRows[0];
  if (link === undefined) throw new NotFoundError('Task link not found');

  await requireContributingActor(db, userId, link.organizationId);

  const deletedRows = await db
    .delete(calendarItemTaskLink)
    .where(
      and(eq(calendarItemTaskLink.calendarItemId, itemId), eq(calendarItemTaskLink.taskId, taskId)),
    )
    .returning();
  const deleted = deletedRows[0];
  /* v8 ignore next -- @preserve defensive: existence was verified above */
  if (deleted === undefined) throw new NotFoundError('Task link not found');
  return deleted;
}
