/** Live, permission-filtered task discovery for personal daily planning. */
import { db, hub, organization, task } from '@docket/db';
import { addDays, instantAt } from '@docket/planning/zoned-time';
import { and, desc, eq, ilike, inArray, isNull, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { AuthError } from '../error';
import { encodeListCursor, seekAfter } from '../lib/list-cursor';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zQuery } from '../lib/validate';
import {
  activeCallerActors,
  buildHubTaskViewFilters,
  filterViewableHubTasks,
  taskCategoriesFor,
  type HubTaskViewFilters,
} from './hub-helpers';
import { visibleProjectNames } from './daily-plan-day-read';

const workQuery = CursorQuery.extend({
  date: z.iso.date(),
  q: z.string().trim().max(200).optional(),
  scope: z.enum(['mine', 'assigned', 'created', 'all']).default('mine'),
  orgId: z.string().optional(),
  due: z.enum(['true', 'false']).default('false'),
});
const workItem = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  title: z.string(),
  projectName: z.string().nullable(),
  priority: z.string(),
  state: z.string(),
  dueAt: z.iso.datetime().nullable(),
  estimateMinutes: z.number().nullable(),
});
const workOut = pageOf(workItem).extend({
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
});
type WorkQuery = z.infer<typeof workQuery>;
type TaskRow = typeof task.$inferSelect;

function responsibility(query: WorkQuery, actorIds: string[]) {
  if (query.scope === 'all') return undefined;
  if (query.scope === 'assigned') return inArray(task.assigneeId, actorIds);
  if (query.scope === 'created') return inArray(task.createdBy, actorIds);
  return or(inArray(task.assigneeId, actorIds), inArray(task.createdBy, actorIds));
}

interface WorkScope {
  readonly orgIds: string[];
  readonly actorIds: string[];
  readonly dueEnd: Date;
  readonly filters: HubTaskViewFilters;
}

async function loadWorkChunk(
  query: WorkQuery,
  scope: WorkScope,
  cursor: string | undefined,
): Promise<TaskRow[]> {
  return db
    .select()
    .from(task)
    .where(
      and(
        inArray(task.organizationId, scope.orgIds),
        isNull(task.archivedAt),
        isNull(task.completedAt),
        isNull(task.canceledAt),
        responsibility(query, scope.actorIds),
        query.q ? ilike(task.title, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
        query.due === 'true' ? lt(task.dueDate, scope.dueEnd) : undefined,
        seekAfter(task.updatedAt, task.id, cursor),
      ),
    )
    .orderBy(desc(task.updatedAt), desc(task.id))
    .limit(100);
}

async function scanWorkPage(query: WorkQuery, scope: WorkScope) {
  const rows: TaskRow[] = [];
  let cursor = query.cursor;
  let exhausted = false;
  // Visibility can remove an entire database page. Continue scanning without presenting a false
  // empty state; a bounded partial page carries the last scanned cursor so no work is skipped.
  for (let round = 0; round < 6 && rows.length <= query.limit; round += 1) {
    const chunk = await loadWorkChunk(query, scope, cursor);
    const categories = await taskCategoriesFor(chunk);
    rows.push(
      ...filterViewableHubTasks(chunk, scope.filters).filter(
        (row) => !['completed', 'canceled'].includes(categories.get(row.id) ?? ''),
      ),
    );
    const last = chunk.at(-1);
    if (last) cursor = encodeListCursor(last.updatedAt, last.id);
    if (chunk.length < 100) {
      exhausted = true;
      break;
    }
  }
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > query.limit && last
      ? encodeListCursor(last.updatedAt, last.id)
      : !exhausted
        ? cursor
        : undefined;
  return { page, nextCursor };
}

async function readWork(userId: string, query: WorkQuery): Promise<z.input<typeof workOut>> {
  const actors = await activeCallerActors(userId);
  const orgIds = actors.map((value) => value.organizationId);
  if (orgIds.length === 0) return { items: [], workspaces: [] };
  const [workspaces, filters, owner] = await Promise.all([
    db
      .select({ id: organization.id, name: organization.name })
      .from(organization)
      .where(inArray(organization.id, orgIds)),
    buildHubTaskViewFilters(actors),
    db.select({ preferences: hub.preferences }).from(hub).where(eq(hub.userId, userId)).limit(1),
  ]);
  if (query.orgId && !orgIds.includes(query.orgId)) return { items: [], workspaces };
  const dueEnd = instantAt(addDays(query.date, 1), 0, owner[0]?.preferences.timezone ?? 'UTC');
  const { page, nextCursor } = await scanWorkPage(query, {
    orgIds: query.orgId ? [query.orgId] : orgIds,
    actorIds: actors.map((value) => value.id),
    filters,
    dueEnd,
  });
  const projectNames = await visibleProjectNames(userId, page);
  const names = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  return {
    workspaces,
    items: page.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      organizationName: names.get(row.organizationId) ?? '',
      title: row.title,
      projectName: row.projectId ? (projectNames.get(row.projectId) ?? null) : null,
      state: row.state,
      priority: row.priority,
      dueAt: row.dueDate?.toISOString() ?? null,
      estimateMinutes: row.estimateMinutes,
    })),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

/** Browse current tasks across active memberships without depending on search-index freshness. */
export const dailyPlanningWorkRoutes = new Hono<AppEnv>().get(
  '/work',
  apiDoc({
    tag: 'DailyPlan',
    summary: 'Browse existing work for a daily plan',
    response: workOut,
    description:
      'Read live unfinished tasks, newest first, across active memberships. Defaults to tasks assigned to or created by the caller. Supports literal title search, workspace, due and responsibility filters, and keyset pagination. Every task and project name is filtered by canonical resource visibility.',
  }),
  zQuery(workQuery),
  async (c) => {
    const session = c.get('session');
    if (!session?.user) throw new AuthError();
    return ok(c, workOut, await readWork(session.user.id, c.req.valid('query')));
  },
);
