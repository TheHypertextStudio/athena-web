/**
 * `@docket/api` — daily-plan router (TOP-LEVEL, mounted at `/v1/daily-plan`).
 *
 * @remarks
 * A cross-org, personal surface: it reads `c.get('session')` directly (NOT `actorCtx`)
 * and resolves the caller's {@link hub} via `hub.userId = session.user.id`. Items
 * reference a Task in any org where the caller is an active, unarchived human Actor. On create,
 * the referenced `(refOrganizationId, refTaskId)` must be currently viewable through the canonical
 * task grant/visibility resolver, else a 404 (existence-hiding). Day drafts use the same gate
 * before saving or confirming. A null session throws {@link AuthError}.
 */
import { actor, db, dailyPlanDay, dailyPlanItem, hub, task } from '@docket/db';
import {
  AcceptedDailyPlan,
  acceptDailyDraft,
  reviseDailyPlan,
} from '@docket/planning/daily-plan-flow';
import {
  DailyPlanItemCreate,
  DailyPlanItemOut,
  DailyPlanItemUpdate,
} from '@docket/planning/daily-plan-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError, ValidationError } from '../error';
import { created, ok } from '../lib/ok';
import { decodeTupleCursor, pageResultByTuple } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import {
  buildDayRead,
  dayOut,
  dayParam,
  dayReadOut,
  draftInput,
  toDayOut,
} from './daily-plan-day-read';
import { buildTaskViewFilter } from './task-helpers';

type DailyPlanItemRow = typeof dailyPlanItem.$inferSelect;

function toOut(d: DailyPlanItemRow): z.input<typeof DailyPlanItemOut> {
  return {
    id: d.id,
    refOrganizationId: d.refOrganizationId,
    refTaskId: d.refTaskId,
    date: d.date,
    sort: d.sort,
    status: d.status,
    timeboxStartsAt: d.timeboxStartsAt?.toISOString() ?? null,
    timeboxEndsAt: d.timeboxEndsAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Resolve (or 404) the caller's Hub id from the session user. */
async function resolveHubId(userId: string): Promise<string> {
  const rows = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Hub not found');
  return row.id;
}

/**
 * Assert that the session user is an active human viewer of this current, in-org Task.
 *
 * A daily-plan row is only a personal pointer, so creating one cannot grant access to the
 * referenced work. Reuse the task visibility resolver rather than reproducing grant semantics.
 */
async function requireViewableTask(
  userId: string,
  organizationId: string,
  taskId: string,
): Promise<void> {
  const callerRows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  const caller = callerRows[0];
  if (!caller) throw new NotFoundError('Task not found');

  const taskRows = await db
    .select({
      id: task.id,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .where(
      and(eq(task.id, taskId), eq(task.organizationId, organizationId), isNull(task.archivedAt)),
    )
    .limit(1);
  const taskRow = taskRows[0];
  if (!taskRow) throw new NotFoundError('Task not found');

  const canView = await buildTaskViewFilter(organizationId, caller.id);
  if (!canView(taskRow)) throw new NotFoundError('Task not found');
}

const listQuery = CursorQuery.extend({ date: z.iso.date() });
const idParam = z.object({ id: z.string() });
/** Daily-plan router: accepted day history, editable drafts, and legacy item operations. */
const dailyPlan = new Hono<AppEnv>()
  .get(
    '/day/:date',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Read a daily planning draft and accepted history',
      response: dayReadOut,
      description:
        "Return the caller's draft, accepted history, visible task state, agenda events, and time-ledger work for one day.",
    }),
    zParam(dayParam),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('param');
      const hubId = await resolveHubId(session.user.id);
      const [row] = await db
        .select()
        .from(dailyPlanDay)
        .where(and(eq(dailyPlanDay.hubId, hubId), eq(dailyPlanDay.date, date)))
        .limit(1);
      return ok(c, dayReadOut, await buildDayRead(session.user.id, hubId, date, row));
    },
  )
  .put(
    '/day/:date/draft',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Save a resumable daily planning draft',
      response: dayOut,
      description:
        "Save the caller's editable draft and resume step. The accepted plan and recorded work do not change.",
    }),
    zParam(dayParam),
    zJson(draftInput),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('param');
      const { draft, resumeStep: step } = c.req.valid('json');
      if (draft.date !== date) {
        throw new ValidationError([
          { path: ['draft', 'date'], message: 'Draft date must match the requested day' },
        ]);
      }
      for (const entry of draft.tasks) {
        await requireViewableTask(session.user.id, entry.organizationId, entry.taskId);
      }
      const hubId = await resolveHubId(session.user.id);
      const [row] = await db
        .insert(dailyPlanDay)
        .values({ hubId, date, draft, resumeStep: step })
        .onConflictDoUpdate({
          target: [dailyPlanDay.hubId, dailyPlanDay.date],
          set: { draft, resumeStep: step },
        })
        .returning();
      return ok(c, dayOut, toDayOut(date, row));
    },
  )
  .post(
    '/day/:date/confirm',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Accept a daily planning draft',
      response: dayOut,
      description:
        'Accept the draft as the original commitment or a later revision. Confirmation never starts a timer or rewrites actual work.',
    }),
    zParam(dayParam),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date } = c.req.valid('param');
      const hubId = await resolveHubId(session.user.id);
      const [existing] = await db
        .select()
        .from(dailyPlanDay)
        .where(and(eq(dailyPlanDay.hubId, hubId), eq(dailyPlanDay.date, date)))
        .limit(1);
      if (!existing?.draft) throw new ConflictError('No draft is ready to confirm');
      const confirmedDraft = existing.draft;
      for (const entry of confirmedDraft.tasks) {
        await requireViewableTask(session.user.id, entry.organizationId, entry.taskId);
      }
      const acceptedAt = new Date().toISOString();
      const accepted = existing.accepted
        ? reviseDailyPlan(AcceptedDailyPlan.parse(existing.accepted), confirmedDraft, acceptedAt)
        : acceptDailyDraft(confirmedDraft, acceptedAt);
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(dailyPlanDay)
          .set({ draft: null, accepted, resumeStep: 'plan_today' })
          .where(
            and(
              eq(dailyPlanDay.hubId, hubId),
              eq(dailyPlanDay.date, date),
              eq(dailyPlanDay.draft, confirmedDraft),
            ),
          )
          .returning();
        if (!updated) throw new ConflictError('The planning draft changed before confirmation');

        // Today still reads daily_plan_item. Keep its task projection in step with the accepted
        // version until Today and the agenda read the version directly. One row represents work,
        // while the accepted snapshot retains every planned session for that work.
        const legacy = await tx
          .select()
          .from(dailyPlanItem)
          .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)));
        const selected = new Set(confirmedDraft.tasks.map((entry) => entry.taskId));
        for (const item of legacy) {
          if (item.status !== 'done' && !selected.has(item.refTaskId)) {
            await tx.delete(dailyPlanItem).where(eq(dailyPlanItem.id, item.id));
          }
        }
        for (const entry of confirmedDraft.tasks) {
          const firstSession = confirmedDraft.sessions.find((session) =>
            session.allocations.some((allocation) => allocation.taskId === entry.taskId),
          );
          const current = legacy.find((item) => item.refTaskId === entry.taskId);
          const values = {
            sort: entry.sort,
            timeboxStartsAt: firstSession ? new Date(firstSession.startsAt) : null,
            timeboxEndsAt: firstSession ? new Date(firstSession.endsAt) : null,
          };
          if (current) {
            await tx.update(dailyPlanItem).set(values).where(eq(dailyPlanItem.id, current.id));
          } else {
            await tx.insert(dailyPlanItem).values({
              hubId,
              date,
              refOrganizationId: entry.organizationId,
              refTaskId: entry.taskId,
              ...values,
            });
          }
        }
        return updated;
      });
      return ok(c, dayOut, toDayOut(date, row));
    },
  )
  .get(
    '/',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Get the daily plan',
      response: pageOf(DailyPlanItemOut),
      description: `Return the caller's personal daily plan for one required calendar \`date\`, ordered by \`sort ASC, id ASC\`. Pages default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Reuse a cursor only for the same date. The plan can contain work from several workspaces but contains only the caller's items.

Session-only, no capability. Returns 401 when unauthenticated and 404 when the caller has no Hub. This read has no side effects. Related: \`POST /\` to add an item, \`PATCH /:id\` to reorder, complete, or timebox it, \`DELETE /:id\` to remove it, and \`GET /hub/today\` for the cross-workspace Today view.`,
    }),
    zQuery(listQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { date, cursor, limit } = c.req.valid('query');
      const hubId = await resolveHubId(session.user.id);
      const boundary = decodeTupleCursor(cursor);
      if (
        boundary &&
        (boundary.length !== 2 ||
          typeof boundary[0] !== 'number' ||
          !Number.isInteger(boundary[0]) ||
          typeof boundary[1] !== 'string')
      ) {
        throw new ValidationError([
          { path: ['cursor'], message: 'The cursor is invalid or expired.' },
        ]);
      }
      const boundarySort = boundary?.[0] as number | undefined;
      const boundaryId = boundary?.[1] as string | undefined;
      const rows = await db
        .select()
        .from(dailyPlanItem)
        .where(
          and(
            eq(dailyPlanItem.hubId, hubId),
            eq(dailyPlanItem.date, date),
            boundarySort !== undefined && boundaryId
              ? or(
                  gt(dailyPlanItem.sort, boundarySort),
                  and(eq(dailyPlanItem.sort, boundarySort), gt(dailyPlanItem.id, boundaryId)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(dailyPlanItem.sort), asc(dailyPlanItem.id))
        .limit(limit + 1);
      return ok(
        c,
        pageOf(DailyPlanItemOut),
        pageResultByTuple(rows.map(toOut), limit, (item) => [item.sort, item.id]),
      );
    },
  )
  .post(
    '/',
    apiDoc({
      status: 201,
      tag: 'DailyPlan',
      summary: 'Add a daily-plan item',
      response: DailyPlanItemOut,
      description: `Add a visible task to the caller's daily plan for \`date\`. Supply \`refOrganizationId\` and \`refTaskId\`, plus an optional sort position and timebox. The caller must be an active member of the task's organization and must be able to view the task. Docket returns 404 when any of those conditions is not met.

The new item starts with status \`planned\` and appears in \`GET /daily-plan\` and \`GET /v1/hub/today\`. The authenticated user owns the item; the request cannot choose another owner.`,
    }),
    zJson(DailyPlanItemCreate),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const body = c.req.valid('json');
      const hubId = await resolveHubId(session.user.id);

      await requireViewableTask(session.user.id, body.refOrganizationId, body.refTaskId);

      const inserted = await db
        .insert(dailyPlanItem)
        .values({
          hubId,
          refOrganizationId: body.refOrganizationId,
          refTaskId: body.refTaskId,
          date: body.date,
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
          ...(body.timeboxStartsAt !== undefined
            ? { timeboxStartsAt: body.timeboxStartsAt ? new Date(body.timeboxStartsAt) : null }
            : {}),
          ...(body.timeboxEndsAt !== undefined
            ? { timeboxEndsAt: body.timeboxEndsAt ? new Date(body.timeboxEndsAt) : null }
            : {}),
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('daily plan item insert returned no row');
      return created(c, DailyPlanItemOut, toOut(row), null);
    },
  )
  .patch(
    '/:id',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Update a daily-plan item',
      response: DailyPlanItemOut,
      description: `Update a daily-plan item's lifecycle: mark it \`done\`/\`planned\` (\`status\`), reorder it within the day (\`sort\`), or set/clear its calendar timebox (\`timeboxStartsAt\`/\`timeboxEndsAt\`). All body fields are optional — only the keys present are written, so this is a partial update; a null timebox value clears that side of the window. The task reference and date are immutable here (remove and re-add to retarget).

**Ownership is enforced first:** the item must exist under the caller's own Hub (\`(id, hubId)\`), else **404 (Daily plan item not found)** — a caller cannot patch another person's plan item. The status/timebox changes flow into \`GET /daily-plan\` and the Hub Today calendar pane. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub or the item isn't theirs.`,
    }),
    zParam(idParam),
    zJson(DailyPlanItemUpdate),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const hubId = await resolveHubId(session.user.id);

      const existing = await db
        .select({ id: dailyPlanItem.id })
        .from(dailyPlanItem)
        .where(and(eq(dailyPlanItem.id, id), eq(dailyPlanItem.hubId, hubId)))
        .limit(1);
      if (!existing[0]) throw new NotFoundError('Daily plan item not found');

      const updated = await db
        .update(dailyPlanItem)
        .set({
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
          ...(body.timeboxStartsAt !== undefined
            ? { timeboxStartsAt: body.timeboxStartsAt ? new Date(body.timeboxStartsAt) : null }
            : {}),
          ...(body.timeboxEndsAt !== undefined
            ? { timeboxEndsAt: body.timeboxEndsAt ? new Date(body.timeboxEndsAt) : null }
            : {}),
        })
        .where(and(eq(dailyPlanItem.id, id), eq(dailyPlanItem.hubId, hubId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the daily-plan item was verified to exist above */
      if (!row) throw new NotFoundError('Daily plan item not found');
      return ok(c, DailyPlanItemOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    apiDoc({
      tag: 'DailyPlan',
      summary: 'Remove a daily-plan item',
      response: DailyPlanItemOut,
      description: `Remove a Task from the caller's daily plan and return the removed item so the client can confirm the change or offer Undo. This only removes the Task from that day. The Task itself is unchanged.

An item that does not belong to the caller, or an unknown id, returns **404 (Daily plan item not found)**. Session-only, no capability. Returns 401 when unauthenticated and 404 when the caller has no Hub.`,
    }),
    zParam(idParam),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { id } = c.req.valid('param');
      const hubId = await resolveHubId(session.user.id);
      const deleted = await db
        .delete(dailyPlanItem)
        .where(and(eq(dailyPlanItem.id, id), eq(dailyPlanItem.hubId, hubId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Daily plan item not found');
      return ok(c, DailyPlanItemOut, toOut(row));
    },
  );

export default dailyPlan;
