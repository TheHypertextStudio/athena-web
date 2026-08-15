/**
 * `@docket/api` — the two derived reads a team page asks for: who is on the team, and what the
 * team is holding.
 *
 * @remarks
 * Both are projections over work the team already owns, so neither adds a table. They live apart
 * from `teams.ts` because that router is CRUD over one row and these are aggregations over many —
 * mixing them would make a 240-line router a 600-line one with two unrelated reasons to change.
 *
 * **Capacity is counted, not declared.** There is deliberately no per-membership allocation
 * percentage: a maintained number goes stale silently while continuing to look authoritative, and
 * "how much of this person is already committed" is answerable from task state today. `openTaskCount`
 * is that observed signal.
 */
import { actor, db, task, team, teamMember } from '@docket/db';
import type {
  TeamActivityOut,
  TeamMemberOut,
  TeamRosterEntry,
  WorkflowStateType,
} from '@docket/types';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { buildTaskViewFilter } from './task-helpers';

/** How many days of history the throughput series covers. */
export const THROUGHPUT_WINDOW_DAYS = 30;

/** The state types whose tasks count as still open. */
const OPEN_STATE_TYPES: readonly WorkflowStateType[] = ['backlog', 'unstarted', 'started'];

/**
 * Map a team's per-team state keys onto their canonical types.
 *
 * @remarks
 * `task.state` stores a per-team key with no global foreign key, so the only way to learn what a
 * task's state *means* is to read the owning team's `workflowStates`. Bucketing by type rather than
 * by key is what keeps two teams comparable when they both have three in-progress columns under
 * different names.
 *
 * @param states - The team's ordered workflow states.
 * @returns A lookup from state key to its canonical type.
 */
export function stateTypeByKey(
  states: readonly { key: string; type: WorkflowStateType }[],
): Map<string, WorkflowStateType> {
  return new Map(states.map((s) => [s.key, s.type]));
}

/**
 * Read a team's roster: who is on it, what they are called, and how much they are already holding.
 *
 * @remarks
 * Returns no field indicating whether a member holds a Docket account, because the roster is the
 * exact surface where that distinction would leak. A volunteer with no login and a staff engineer
 * come back as the same shape. See `docs/engineering/specs/people.md`.
 *
 * @param orgId - The tenant.
 * @param teamId - The team whose roster is wanted.
 * @param viewerActorId - The current actor, whose task visibility gates load counts.
 * @returns The members, ordered by name.
 */
export async function loadTeamMembers(
  orgId: string,
  teamId: string,
  viewerActorId: string,
): Promise<TeamMemberOut[]> {
  const rows = await db
    .select({
      actorId: actor.id,
      displayName: actor.displayName,
      title: actor.title,
      avatar: actor.avatar,
      role: teamMember.role,
    })
    .from(teamMember)
    .innerJoin(actor, eq(actor.id, teamMember.actorId))
    .where(
      and(
        eq(teamMember.teamId, teamId),
        eq(teamMember.organizationId, orgId),
        isNull(actor.archivedAt),
      ),
    )
    .orderBy(sql`lower(${actor.displayName})`);

  if (rows.length === 0) return [];

  const openStates = await openStateKeys(orgId, teamId);
  // A team with no open states has no open work by definition; skipping the query also avoids an
  // `inArray` over an empty list, which Postgres reads as "match nothing" only by accident.
  const loadByActor =
    openStates.length === 0
      ? new Map<string, number>()
      : await openTaskCountsByAssignee(orgId, teamId, viewerActorId, openStates);

  return rows.map((row) => ({
    actorId: row.actorId,
    displayName: row.displayName,
    title: row.title,
    avatar: row.avatar,
    role: row.role,
    openTaskCount: loadByActor.get(row.actorId) ?? 0,
  }));
}

/**
 * Read every team membership in the org, identity only.
 *
 * @remarks
 * One query for the whole workspace, because the Teams hub draws a face stack on every card and
 * asking per team would be one request per card. Deliberately omits `openTaskCount`: the hub never
 * shows it, and computing it for every member of every team would be work thrown away.
 *
 * @param orgId - The tenant.
 * @returns Every (team, member) pair, ordered by team then name.
 */
export async function loadOrgTeamRosters(orgId: string): Promise<TeamRosterEntry[]> {
  const rows = await db
    .select({
      teamId: teamMember.teamId,
      actorId: actor.id,
      displayName: actor.displayName,
      avatar: actor.avatar,
    })
    .from(teamMember)
    .innerJoin(actor, eq(actor.id, teamMember.actorId))
    .where(and(eq(teamMember.organizationId, orgId), isNull(actor.archivedAt)))
    .orderBy(teamMember.teamId, sql`lower(${actor.displayName})`);
  return rows.map((row) => ({
    teamId: row.teamId as TeamRosterEntry['teamId'],
    actorId: row.actorId,
    displayName: row.displayName,
    avatar: row.avatar,
  }));
}

/** The team's state keys that map onto an open canonical type. */
async function openStateKeys(orgId: string, teamId: string): Promise<string[]> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const states = teamRows[0]?.workflowStates ?? [];
  return states.filter((s) => OPEN_STATE_TYPES.includes(s.type)).map((s) => s.key);
}

/** How many open team tasks each assignee is holding. */
async function openTaskCountsByAssignee(
  orgId: string,
  teamId: string,
  viewerActorId: string,
  openStates: readonly string[],
): Promise<Map<string, number>> {
  const taskVisibility = await buildTaskViewFilter(orgId, viewerActorId);
  const rows = await db
    .select({
      id: task.id,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
      assigneeId: task.assigneeId,
    })
    .from(task)
    .where(
      and(
        eq(task.teamId, teamId),
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
        inArray(task.state, [...openStates]),
      ),
    );
  // Unassigned open work groups under a null assignee. It is real load on the team, but it is not
  // load on any person, so it is dropped here rather than attributed to someone.
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.assigneeId === null || !taskVisibility(row)) continue;
    counts.set(row.assigneeId, (counts.get(row.assigneeId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Build a team's activity report: what it is holding now, and how it has been moving.
 *
 * @remarks
 * Capacity buckets every open task by its canonical state type. Throughput walks the last
 * {@link THROUGHPUT_WINDOW_DAYS} days and, for each, counts the tasks open on that day and the
 * tasks completed by it — the two lines converging is the team keeping up.
 *
 * Estimates are summed alongside the counts rather than instead of them. `task.estimate` is off by
 * default in most workspaces, so a chart that silently switched units would mean two different
 * things on two different workspaces with no way for a reader to tell which.
 *
 * @param orgId - The tenant.
 * @param teamId - The team to report on.
 * @param viewerActorId - The current actor, whose task visibility gates report calculations.
 * @param now - The instant the rolling window ends at.
 * @returns The activity report.
 */
export async function loadTeamActivity(
  orgId: string,
  teamId: string,
  viewerActorId: string,
  now: Date,
): Promise<TeamActivityOut> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const typeByKey = stateTypeByKey(teamRows[0]?.workflowStates ?? []);

  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - (THROUGHPUT_WINDOW_DAYS - 1));
  windowStart.setUTCHours(0, 0, 0, 0);
  const taskVisibility = await buildTaskViewFilter(orgId, viewerActorId);

  const rows = await db
    .select({
      id: task.id,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
      state: task.state,
      estimate: task.estimate,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      canceledAt: task.canceledAt,
    })
    .from(task)
    .where(and(eq(task.teamId, teamId), eq(task.organizationId, orgId), isNull(task.archivedAt)));

  const visibleTasks = rows.filter(taskVisibility);
  const capacity = bucketCapacity(visibleTasks, typeByKey);
  const throughput = buildThroughput(visibleTasks, windowStart, now);

  return {
    teamId: teamId as TeamActivityOut['teamId'],
    capacity,
    throughput,
    windowDays: THROUGHPUT_WINDOW_DAYS,
  };
}

/** One task row as the report reads it. */
interface ReportTask {
  state: string;
  estimate: number | null;
  createdAt: Date;
  completedAt: Date | null;
  canceledAt: Date | null;
}

/** Bucket every still-open task by its canonical state type, in canonical order. */
function bucketCapacity(
  rows: readonly ReportTask[],
  typeByKey: ReadonlyMap<string, WorkflowStateType>,
): TeamActivityOut['capacity'] {
  const counts = new Map<WorkflowStateType, { taskCount: number; estimate: number }>();
  for (const type of OPEN_STATE_TYPES) counts.set(type, { taskCount: 0, estimate: 0 });

  for (const row of rows) {
    if (row.completedAt !== null || row.canceledAt !== null) continue;
    const type = typeByKey.get(row.state);
    // A task whose state key is no longer in the team's workflow (someone replaced the whole
    // array) is genuinely uncategorizable. Dropping it beats inventing a bucket for it.
    if (type === undefined) continue;
    const bucket = counts.get(type);
    if (!bucket) continue;
    bucket.taskCount += 1;
    bucket.estimate += row.estimate ?? 0;
  }

  return OPEN_STATE_TYPES.map((type) => ({
    type,
    taskCount: counts.get(type)?.taskCount ?? 0,
    estimate: counts.get(type)?.estimate ?? 0,
  }));
}

/** Walk the rolling window, counting what was open and what had been completed by each day. */
function buildThroughput(
  rows: readonly ReportTask[],
  windowStart: Date,
  now: Date,
): TeamActivityOut['throughput'] {
  const points: TeamActivityOut['throughput'] = [];
  for (let offset = 0; offset < THROUGHPUT_WINDOW_DAYS; offset++) {
    const dayEnd = new Date(windowStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + offset);
    dayEnd.setUTCHours(23, 59, 59, 999);
    if (dayEnd.getTime() - 86_399_999 > now.getTime()) break;

    // The current day's boundary is *now*, not midnight. Breaking out on a future midnight
    // instead dropped today's column entirely, so anything completed today was invisible until
    // tomorrow — the chart's most-watched point was the one it never drew.
    const boundary = dayEnd > now ? now : dayEnd;

    let pending = 0;
    let completed = 0;
    for (const row of rows) {
      if (row.createdAt > boundary) continue;
      const closedBy =
        (row.completedAt !== null && row.completedAt <= boundary) ||
        (row.canceledAt !== null && row.canceledAt <= boundary);
      if (row.completedAt !== null && row.completedAt <= boundary) completed += 1;
      if (!closedBy) pending += 1;
    }
    points.push({ date: dayEnd.toISOString().slice(0, 10), pending, completed });
  }
  return points;
}

/** Guard used by the routes: does this active team exist in this org? */
export async function teamExists(orgId: string, teamId: string): Promise<boolean> {
  const rows = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId), isNull(team.archivedAt)))
    .limit(1);
  return rows[0] !== undefined;
}
