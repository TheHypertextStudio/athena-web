/**
 * `time/anchor-suggestion` — what Docket believes the caller should be tracking right now.
 *
 * @remarks
 * The app already knows the answer most of the time. It scheduled the block, it linked the task to
 * it, and the day loop already computes which block covers the present instant. Asking a person to
 * type that name back into a dialog before the timer will run is the app refusing to use what it
 * knows. This module is the read that closes that gap.
 *
 * It is a **suggestion and never an instruction**. Nothing here starts tracking, and no caller may
 * treat a hit as consent: the ledger has to record what a person did, not what was planned for
 * them, so the gesture that accepts a suggestion is always theirs. That is also why every
 * suggestion carries its own provenance — an unexplained guess is worse than none, because the
 * person cannot tell a fresh one from a stale one without being told where it came from.
 *
 * The four sources are ordered by how strongly each one commits the caller to a task at this
 * instant, not by how easy it is to query. A calendar block covering *now* is the strongest claim
 * anyone has made about the present minute; a task worked on an hour ago is the weakest.
 *
 * @see {@link ./read-models.getActiveTime} — the only caller, which folds this into the tracker read.
 */
import {
  actor,
  calendarItem,
  calendarItemTaskLink,
  dailyPlanItem,
  db,
  dayDirective,
  task,
  team,
  timeRecord,
} from '@docket/db';
import type { TimeAnchorSuggestion } from '../contracts/time';
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { z } from 'zod';

import { buildTaskViewFilter, type ViewableTaskParts } from '../routes/task-helpers';

/**
 * The suggestion as this module produces it.
 *
 * @remarks
 * `z.input`, not `z.infer`: the DTO brands `organizationId`, and a branded id is a guarantee the
 * *parser* makes about a value it has checked. A raw column read has not been through it, so
 * claiming the brand here would be asserting the guarantee rather than earning it.
 */
type AnchorSuggestionInput = z.input<typeof TimeAnchorSuggestion>;

/**
 * Calendar kinds that can commit the caller to a task.
 *
 * @remarks
 * `availability_block` is excluded deliberately: it describes when someone *could* be booked, not
 * what they are doing, so treating it as a commitment would suggest work during every free hour.
 */
const COMMITTING_CALENDAR_KINDS = ['timebox', 'task_timebox', 'block', 'native_event'] as const;

/**
 * How stale a `day_directive` may be before its recommendation is ignored.
 *
 * @remarks
 * The row is keyed by a local calendar date in the Hub's own timezone, so comparing it against a
 * UTC "today" would be wrong at either end of the day. Bounding on `computedAt` instead sidesteps
 * the timezone question entirely and fails in the safe direction — a directive nobody has
 * recomputed since yesterday morning stops speaking for the present minute.
 */
const DIRECTIVE_FRESHNESS_MS = 12 * 60 * 60 * 1_000;

/** How far back a finished session still counts as "what I was in the middle of". */
const RECENT_WINDOW_MS = 2 * 60 * 60 * 1_000;

/**
 * The selected task columns needed for visibility and suggestion serialization.
 *
 * @remarks
 * Keep this projection deliberately small: the tracker polls this resolver, and a candidate only
 * needs its identity, containment parents, visibility, and title. The parents are the exact
 * columns {@link buildTaskViewFilter} needs to reproduce the task containment cascade.
 */
const TASK_SUGGESTION_COLUMNS = {
  taskId: task.id,
  organizationId: task.organizationId,
  title: task.title,
  teamId: task.teamId,
  projectId: task.projectId,
  programId: task.programId,
  visibility: task.visibility,
} as const;

/** One candidate task with the columns necessary for canonical visibility resolution. */
interface TaskSuggestionCandidate {
  readonly taskId: string;
  readonly organizationId: string;
  readonly teamId: string;
  readonly projectId: string | null;
  readonly programId: string | null;
  readonly visibility: ViewableTaskParts['visibility'];
}

/** The canonical per-task visibility predicate for one active organization membership. */
type TaskViewFilter = (candidate: ViewableTaskParts) => boolean;

/**
 * Build task-visibility predicates for every active, unarchived human membership of `userId`.
 *
 * @remarks
 * A task title is content, so a user-level calendar or Hub pointer is never enough authority to
 * return it. Each predicate comes from {@link buildTaskViewFilter}, the current canonical task
 * visibility resolver for public baselines and direct/role grants. Keeping these filters keyed by
 * organization lets one Hub safely contain plans for several workspaces without treating a
 * membership in one as access to another.
 */
async function taskViewFiltersForCaller(userId: string): Promise<Map<string, TaskViewFilter>> {
  const memberships = await db
    .select({ actorId: actor.id, organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  return new Map(
    await Promise.all(
      memberships.map(
        async (membership) =>
          [
            membership.organizationId,
            await buildTaskViewFilter(membership.organizationId, membership.actorId),
          ] as const,
      ),
    ),
  );
}

/** Whether a candidate task is visible through the caller's active membership in its organization. */
function canViewSuggestionTask(
  candidate: TaskSuggestionCandidate,
  filtersByOrganization: ReadonlyMap<string, TaskViewFilter>,
): boolean {
  const canView = filtersByOrganization.get(candidate.organizationId);
  return (
    canView?.({
      id: candidate.taskId,
      teamId: candidate.teamId,
      projectId: candidate.projectId,
      programId: candidate.programId,
      visibility: candidate.visibility,
    }) ?? false
  );
}

/** Return the first ranked candidate whose task title the caller is allowed to see. */
function firstVisibleTask<T extends TaskSuggestionCandidate>(
  candidates: readonly T[],
  filtersByOrganization: ReadonlyMap<string, TaskViewFilter>,
): T | undefined {
  return candidates.find((candidate) => canViewSuggestionTask(candidate, filtersByOrganization));
}

/** The calendar block covering `now`, when one is linked to a task. */
async function fromCalendarTimebox(
  userId: string,
  now: Date,
  filtersByOrganization: ReadonlyMap<string, TaskViewFilter>,
): Promise<AnchorSuggestionInput | null> {
  const rows = await db
    .select({
      ...TASK_SUGGESTION_COLUMNS,
      calendarItemId: calendarItem.id,
      startsAt: calendarItem.startsAt,
      endsAt: calendarItem.endsAt,
    })
    .from(calendarItem)
    .innerJoin(calendarItemTaskLink, eq(calendarItemTaskLink.calendarItemId, calendarItem.id))
    .innerJoin(task, eq(task.id, calendarItemTaskLink.taskId))
    .where(
      and(
        eq(calendarItem.userId, userId),
        inArray(calendarItem.kind, [...COMMITTING_CALENDAR_KINDS]),
        lte(calendarItem.startsAt, now),
        gt(calendarItem.endsAt, now),
        isNull(task.archivedAt),
      ),
    )
    // Blocks overlap. The one that began most recently is the one the caller just walked into.
    .orderBy(desc(calendarItem.startsAt));
  const row = firstVisibleTask(rows, filtersByOrganization);
  if (!row) return null;
  return {
    taskId: row.taskId,
    organizationId: row.organizationId,
    title: row.title,
    source: 'calendar_timebox',
    calendarItemId: row.calendarItemId,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
  };
}

/**
 * The daily-plan timebox covering `now`.
 *
 * @remarks
 * Checked separately from the calendar because `daily_plan_item` and `calendar_item` are two
 * disjoint stores of planned time with no foreign key between them, read today by different
 * consumers. Until they are unified, a resolver that reads only one of them is blind to half the
 * plans the app itself wrote. The join to `task` is on a plain text column for the same reason —
 * `daily_plan_item.ref_task_id` carries no FK.
 */
async function fromDailyPlanTimebox(
  hubId: string,
  now: Date,
  filtersByOrganization: ReadonlyMap<string, TaskViewFilter>,
): Promise<AnchorSuggestionInput | null> {
  const rows = await db
    .select({
      ...TASK_SUGGESTION_COLUMNS,
      startsAt: dailyPlanItem.timeboxStartsAt,
      endsAt: dailyPlanItem.timeboxEndsAt,
    })
    .from(dailyPlanItem)
    .innerJoin(task, eq(task.id, dailyPlanItem.refTaskId))
    .where(
      and(
        eq(dailyPlanItem.hubId, hubId),
        eq(dailyPlanItem.status, 'planned'),
        lte(dailyPlanItem.timeboxStartsAt, now),
        gt(dailyPlanItem.timeboxEndsAt, now),
        isNull(task.archivedAt),
      ),
    )
    .orderBy(desc(dailyPlanItem.timeboxStartsAt));
  const row = firstVisibleTask(rows, filtersByOrganization);
  if (!row) return null;
  return {
    taskId: row.taskId,
    organizationId: row.organizationId,
    title: row.title,
    source: 'daily_plan_timebox',
    calendarItemId: null,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
  };
}

/** The day loop's own recommendation, while it is still fresh enough to speak for now. */
async function fromDayDirective(
  hubId: string,
  now: Date,
  filtersByOrganization: ReadonlyMap<string, TaskViewFilter>,
): Promise<AnchorSuggestionInput | null> {
  const rows = await db
    .select({
      ...TASK_SUGGESTION_COLUMNS,
      calendarItemId: dayDirective.recommendedCalendarItemId,
    })
    .from(dayDirective)
    .innerJoin(task, eq(task.id, dayDirective.recommendedTaskId))
    .where(
      and(
        eq(dayDirective.hubId, hubId),
        isNotNull(dayDirective.recommendedTaskId),
        gte(dayDirective.computedAt, new Date(now.getTime() - DIRECTIVE_FRESHNESS_MS)),
        isNull(task.archivedAt),
      ),
    )
    .orderBy(desc(dayDirective.computedAt));
  const row = firstVisibleTask(rows, filtersByOrganization);
  if (!row) return null;
  return {
    taskId: row.taskId,
    organizationId: row.organizationId,
    title: row.title,
    source: 'day_directive',
    calendarItemId: row.calendarItemId,
    startsAt: null,
    endsAt: null,
  };
}

/**
 * The task the caller was tracking recently, if that work is still open.
 *
 * @remarks
 * This is the came-back-from-lunch case, and it is the weakest source on purpose: it is the only
 * one where nothing in the day says the caller *should* be on this task, only that they were. It
 * requires the task to still sit in a `started` workflow state, so finishing something and walking
 * away does not have the app suggesting it back an hour later.
 *
 * The state test happens in application code because a workflow state is a per-team key stored in
 * `team.workflow_states`, not a column with a comparable value.
 */
async function fromRecentTracking(
  hubId: string,
  now: Date,
  filtersByOrganization: ReadonlyMap<string, TaskViewFilter>,
): Promise<AnchorSuggestionInput | null> {
  const rows = await db
    .select({
      ...TASK_SUGGESTION_COLUMNS,
      state: task.state,
      workflowStates: team.workflowStates,
    })
    .from(timeRecord)
    .innerJoin(task, eq(task.id, timeRecord.taskId))
    .innerJoin(team, eq(team.id, task.teamId))
    .where(
      and(
        eq(timeRecord.hubId, hubId),
        eq(timeRecord.status, 'closed'),
        gte(timeRecord.endedAt, new Date(now.getTime() - RECENT_WINDOW_MS)),
        isNull(task.archivedAt),
      ),
    )
    .orderBy(desc(timeRecord.endedAt))
    // A handful, so that a just-completed task does not hide the one still in progress behind it.
    .limit(5);
  const row = rows.find(
    (candidate) =>
      canViewSuggestionTask(candidate, filtersByOrganization) &&
      candidate.workflowStates.find((state) => state.key === candidate.state)?.type === 'started',
  );
  if (!row) return null;
  return {
    taskId: row.taskId,
    organizationId: row.organizationId,
    title: row.title,
    source: 'recent',
    calendarItemId: null,
    startsAt: null,
    endsAt: null,
  };
}

/**
 * Resolve the task the caller is most likely meant to be working on, with the reason why.
 *
 * @remarks
 * Sources are tried in commitment order and the first hit wins; they are awaited in sequence
 * rather than raced because the common case hits the first source, and racing all four would run
 * three throwaway queries on every read of a tracker the shell already polls continuously.
 *
 * @param userId - The caller.
 * @param hubId - The caller's Hub, already resolved by {@link ./read-models.getActiveTime}.
 * @param now - The instant to resolve against, shared with the rest of the tracker read.
 * @returns the best {@link TimeAnchorSuggestion}, or null when nothing in the day names a task.
 */
export async function resolveAnchorSuggestion(
  userId: string,
  hubId: string,
  now: Date,
): Promise<AnchorSuggestionInput | null> {
  const filtersByOrganization = await taskViewFiltersForCaller(userId);
  if (filtersByOrganization.size === 0) return null;
  return (
    (await fromCalendarTimebox(userId, now, filtersByOrganization)) ??
    (await fromDailyPlanTimebox(hubId, now, filtersByOrganization)) ??
    (await fromDayDirective(hubId, now, filtersByOrganization)) ??
    (await fromRecentTracking(hubId, now, filtersByOrganization))
  );
}
