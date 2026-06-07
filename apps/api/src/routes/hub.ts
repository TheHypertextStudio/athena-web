/**
 * `@docket/api` — hub aggregation router (TOP-LEVEL, mounted at `/v1/hub`).
 *
 * @remarks
 * The caller's cross-org command center. Every route reads `c.get('session')` directly
 * (NOT `actorCtx`), resolves the orgs the session user is an **active human** Actor in,
 * and aggregates across them — returning org-chipped items (each carries its originating
 * `organizationId` / org chip). A null session throws {@link AuthError}; an empty org
 * set yields empty aggregations. These are read-only projections that NEVER merge tenant
 * data: aggregation is fan-out queries per membership, server-merged, with each item
 * carrying its own org id (no cross-tenant SQL join).
 */
import {
  actor,
  agentSession,
  auditEvent,
  db,
  dailyPlanItem,
  hub,
  milestone,
  notification,
  organization,
  program,
  project,
  task,
  taskDependency,
} from '@docket/db';
import type {
  AuditEventOut,
  HubMilestoneItem,
  HubProgramLane,
  HubProjectBar,
  HubSearchHit,
  HubTaskItem,
  NotificationOut,
  OrgChip,
} from '@docket/types';
import {
  HubActivityOut,
  HubInboxOut,
  HubPortfolioOut,
  HubSearchOut,
  HubTodayOut,
  ListQuery,
} from '@docket/types';
import { and, count, desc, eq, ilike, inArray, isNull, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError } from '../error';
import { ok } from '../lib/ok';
import { zQuery } from '../lib/validate';

type TaskRow = typeof task.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type ProgramRow = typeof program.$inferSelect;
type MilestoneRow = typeof milestone.$inferSelect;
type OrgRow = typeof organization.$inferSelect;
type NotificationRow = typeof notification.$inferSelect;
type AuditEventRow = typeof auditEvent.$inferSelect;

/** Project lifecycle states that count as "in flight" for the portfolio timeline. */
const IN_FLIGHT_PROJECT_STATES = ['planned', 'active'] as const;

function toTaskItem(t: TaskRow): z.input<typeof HubTaskItem> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    projectId: t.projectId,
    dueDate: t.dueDate?.toISOString() ?? null,
  };
}

function toNotificationOut(n: NotificationRow): z.input<typeof NotificationOut> {
  return {
    id: n.id,
    userId: n.userId,
    organizationId: n.organizationId,
    type: n.type,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

function toAuditEventOut(e: AuditEventRow): z.input<typeof AuditEventOut> {
  return {
    id: e.id,
    organizationId: e.organizationId,
    actorId: e.actorId,
    initiatorId: e.initiatorId,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    type: e.type,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
  };
}

function toOrgChip(o: OrgRow): z.input<typeof OrgChip> {
  return { id: o.id, name: o.name, slug: o.slug, avatar: o.avatar };
}

function toMilestoneItem(m: MilestoneRow): z.input<typeof HubMilestoneItem> {
  return {
    id: m.id,
    name: m.name,
    targetDate: m.targetDate?.toISOString() ?? null,
  };
}

function toSearchHit(
  organizationId: string,
  type: z.input<typeof HubSearchHit>['type'],
  id: string,
  title: string,
): z.input<typeof HubSearchHit> {
  return { organizationId, type, id, title };
}

/**
 * The org ids the user is an **active human** Actor in (their cross-org scope).
 *
 * @param userId - The session user's global id.
 * @returns the distinct organization ids the user has an active human Actor in.
 */
async function callerOrgIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human'), eq(actor.status, 'active')));
  return [...new Set(rows.map((r) => r.organizationId))];
}

/** The caller's active human Actor ids (one per org), for "assigned to me" filters. */
async function callerActorIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(and(eq(actor.userId, userId), eq(actor.kind, 'human'), eq(actor.status, 'active')));
  return rows.map((r) => r.id);
}

const todayQuery = z.object({ date: z.iso.date() });
const portfolioQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  initiativeId: z.string().optional(),
});
const searchQuery = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Hub router: cross-org `today`, `inbox`, `activity`, `portfolio`, and `search` surfaces. */
const hubRouter = new Hono<AppEnv>()
  .get('/today', zQuery(todayQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { date } = c.req.valid('query');
    const userId = session.user.id;
    const orgIds = await callerOrgIds(userId);
    if (orgIds.length === 0) {
      return ok(c, HubTodayOut, {
        date,
        plan: [],
        calendar: [],
        needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 0 },
      });
    }

    // The caller's Hub + their daily-plan items for the date (cross-org by ref pair).
    const hubRows = await db
      .select({ id: hub.id })
      .from(hub)
      .where(eq(hub.userId, userId))
      .limit(1);
    const hubId = hubRows[0]?.id;
    const planRows = hubId
      ? await db
          .select()
          .from(dailyPlanItem)
          .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date)))
      : [];

    // Only honor plan refs whose org is still in the caller's active scope.
    const inScopePlanRows = planRows.filter((r) => orgIds.includes(r.refOrganizationId));
    const plannedTaskIds = inScopePlanRows.map((r) => r.refTaskId);

    const planned =
      plannedTaskIds.length > 0
        ? await db
            .select()
            .from(task)
            .where(and(inArray(task.organizationId, orgIds), inArray(task.id, plannedTaskIds)))
        : [];

    // Tasks due on the date that are NOT already in the plan (avoid double-listing).
    const dueRows =
      plannedTaskIds.length > 0
        ? await db
            .select()
            .from(task)
            .where(
              and(
                inArray(task.organizationId, orgIds),
                eq(task.dueDate, new Date(date)),
                notInArray(task.id, plannedTaskIds),
              ),
            )
        : await db
            .select()
            .from(task)
            .where(and(inArray(task.organizationId, orgIds), eq(task.dueDate, new Date(date))));

    const plan = [...planned, ...dueRows].map(toTaskItem);

    // Calendar pane: in-scope plan items that carry a timebox window.
    const calendar = inScopePlanRows.flatMap((r) => {
      const startsAt = r.timeboxStartsAt;
      const endsAt = r.timeboxEndsAt;
      if (!startsAt || !endsAt) return [];
      return [
        {
          taskId: r.refTaskId,
          organizationId: r.refOrganizationId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      ];
    });

    // needsAttention.dueToday — every task due on the date (independent of the plan).
    const dueToday = [
      ...planned.filter((t) => sameDay(t.dueDate?.toISOString() ?? null, date)),
      ...dueRows,
    ].map(toTaskItem);

    // needsAttention.approvals — tasks of agent sessions awaiting the caller's approval.
    const awaitingSessions = await db
      .select({ taskId: agentSession.taskId })
      .from(agentSession)
      .where(
        and(
          inArray(agentSession.organizationId, orgIds),
          eq(agentSession.status, 'awaiting_approval'),
        ),
      );
    const approvalTaskIds = [
      ...new Set(awaitingSessions.map((s) => s.taskId).filter((id): id is string => id !== null)),
    ];
    const approvals =
      approvalTaskIds.length > 0
        ? (
            await db
              .select()
              .from(task)
              .where(and(inArray(task.organizationId, orgIds), inArray(task.id, approvalTaskIds)))
          ).map(toTaskItem)
        : [];

    // needsAttention.blocked — the caller's tasks that have an incomplete blocking edge.
    const myActorIds = await callerActorIds(userId);
    const blocked = myActorIds.length > 0 ? await selectBlockedTasks(orgIds, myActorIds) : [];

    // needsAttention.inbox — unread notification count for the user.
    const inboxCountRows = await db
      .select({ n: count() })
      .from(notification)
      .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
    const inbox = inboxCountRows[0]?.n ?? 0;

    return ok(c, HubTodayOut, {
      date,
      plan,
      calendar,
      needsAttention: { approvals, blocked, dueToday, inbox },
    });
  })
  .get('/inbox', async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, session.user.id))
      .orderBy(desc(notification.createdAt));
    return ok(c, HubInboxOut, { items: rows.map(toNotificationOut) });
  })
  .get('/activity', zQuery(ListQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { limit, order } = c.req.valid('query');
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubActivityOut, { items: [] });

    // Fan-out by membership (single IN over the caller's orgs); newest-first by default.
    const orderBy = order === 'asc' ? auditEvent.createdAt : desc(auditEvent.createdAt);
    const rows = await db
      .select()
      .from(auditEvent)
      .where(inArray(auditEvent.organizationId, orgIds))
      .orderBy(orderBy)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return ok(c, HubActivityOut, {
      items: page.map(toAuditEventOut),
      ...(hasMore && last ? { nextCursor: last.id } : {}),
    });
  })
  .get('/portfolio', zQuery(portfolioQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubPortfolioOut, { swimlanes: [] });
    const { from, to } = c.req.valid('query');

    // Org chips (the swimlane bands) — only the caller's orgs, never merged.
    const orgs = await db
      .select()
      .from(organization)
      .where(inArray(organization.id, orgIds))
      .orderBy(organization.name);

    // In-flight programs + projects across scope, plus the projects' milestone diamonds.
    const programs = await db
      .select()
      .from(program)
      .where(
        and(inArray(program.organizationId, orgIds), notInArray(program.status, ['archived'])),
      );
    const projects = await db
      .select()
      .from(project)
      .where(
        and(
          inArray(project.organizationId, orgIds),
          inArray(project.status, [...IN_FLIGHT_PROJECT_STATES]),
        ),
      );

    const inWindow = (p: ProjectRow): boolean => {
      if (from && p.targetDate && p.targetDate < new Date(from)) return false;
      if (to && p.startDate && p.startDate > new Date(to)) return false;
      return true;
    };
    const windowed = projects.filter(inWindow);

    const projectIds = windowed.map((p) => p.id);
    const milestones =
      projectIds.length > 0
        ? await db.select().from(milestone).where(inArray(milestone.projectId, projectIds))
        : [];
    const milestonesByProject = groupBy(milestones, (m) => m.projectId);

    const toBar = (p: ProjectRow): z.input<typeof HubProjectBar> => ({
      id: p.id,
      organizationId: p.organizationId,
      name: p.name,
      status: p.status,
      health: p.health,
      startDate: p.startDate?.toISOString() ?? null,
      targetDate: p.targetDate?.toISOString() ?? null,
      milestones: (milestonesByProject.get(p.id) ?? []).map(toMilestoneItem),
    });

    const projectsByOrg = groupBy(windowed, (p) => p.organizationId);
    const programsByOrg = groupBy(programs, (p) => p.organizationId);

    const swimlanes = orgs.map((org) => {
      const orgProjects = projectsByOrg.get(org.id) ?? [];
      const orgPrograms = programsByOrg.get(org.id) ?? [];
      const programScoped = orgProjects.filter(
        (p): p is ProjectRow & { programId: string } => p.programId !== null,
      );
      const projectsByProgram = groupBy(programScoped, (p) => p.programId);
      const lanes: z.input<typeof HubProgramLane>[] = orgPrograms.map((prog: ProgramRow) => ({
        program: {
          id: prog.id,
          organizationId: prog.organizationId,
          name: prog.name,
          status: prog.status,
          health: prog.health,
        },
        projects: (projectsByProgram.get(prog.id) ?? []).map(toBar),
      }));
      const unassigned = orgProjects.filter((p) => p.programId === null).map(toBar);
      return { organization: toOrgChip(org), programs: lanes, unassigned };
    });

    return ok(c, HubPortfolioOut, { swimlanes });
  })
  .get('/search', zQuery(searchQuery), async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    const { q, limit } = c.req.valid('query');
    const orgIds = await callerOrgIds(session.user.id);
    if (orgIds.length === 0) return ok(c, HubSearchOut, { query: q, results: [] });
    const pattern = `%${q}%`;

    const [taskRows, projectRows, programRows] = await Promise.all([
      db
        .select()
        .from(task)
        .where(and(inArray(task.organizationId, orgIds), ilike(task.title, pattern)))
        .limit(limit),
      db
        .select()
        .from(project)
        .where(and(inArray(project.organizationId, orgIds), ilike(project.name, pattern)))
        .limit(limit),
      db
        .select()
        .from(program)
        .where(and(inArray(program.organizationId, orgIds), ilike(program.name, pattern)))
        .limit(limit),
    ]);

    const results: z.input<typeof HubSearchHit>[] = [
      ...taskRows.map((t) => toSearchHit(t.organizationId, 'task', t.id, t.title)),
      ...projectRows.map((p) => toSearchHit(p.organizationId, 'project', p.id, p.name)),
      ...programRows.map((p) => toSearchHit(p.organizationId, 'program', p.id, p.name)),
    ].slice(0, limit);

    return ok(c, HubSearchOut, { query: q, results });
  });

/**
 * Select the caller's tasks (assigned to one of their actor ids) that are blocked by at
 * least one incomplete blocking task, across the given orgs.
 *
 * @param orgIds - The caller's in-scope org ids.
 * @param actorIds - The caller's active human actor ids.
 * @returns the blocked-task Hub items (deduplicated).
 */
async function selectBlockedTasks(
  orgIds: string[],
  actorIds: string[],
): Promise<z.input<typeof HubTaskItem>[]> {
  // The caller's open tasks across scope.
  const mine = await db
    .select()
    .from(task)
    .where(and(inArray(task.organizationId, orgIds), inArray(task.assigneeId, actorIds)));
  if (mine.length === 0) return [];

  // The blocking edges into those tasks, with the blocking task's completion state.
  const blockedIds = mine.map((t) => t.id);
  const edges = await db
    .select({
      blockedTaskId: taskDependency.blockedTaskId,
      blockingCompletedAt: task.completedAt,
    })
    .from(taskDependency)
    .innerJoin(task, eq(task.id, taskDependency.blockingTaskId))
    .where(inArray(taskDependency.blockedTaskId, blockedIds));

  const blockedSet = new Set(
    edges.filter((e) => e.blockingCompletedAt === null).map((e) => e.blockedTaskId),
  );
  return mine.filter((t) => blockedSet.has(t.id)).map(toTaskItem);
}

/** Whether an ISO timestamp string falls on the given `YYYY-MM-DD` UTC date. */
function sameDay(iso: string | null | undefined, date: string): boolean {
  if (!iso) return false;
  return iso.slice(0, 10) === date;
}

/** Group rows by a derived key into a Map preserving insertion order. */
function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

export default hubRouter;
