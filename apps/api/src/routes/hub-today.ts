import {
  agentSession,
  dailyPlanItem,
  db,
  hub,
  initiative,
  initiativeProject,
  milestone,
  notification,
  project,
  task,
  taskDependency,
  timeInterval,
  update as statusUpdate,
} from '@docket/db';
import type {
  AvailabilityWindow,
  HubTodayOut,
  HubTodayStatusCard,
  HubTodaySuggestion,
} from '@docket/types';
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { z } from 'zod';

import {
  resolveResourceAccess,
  resourceAccessKey,
  type ResourceAccessRef,
} from '../permissions/resource-access';
import { expandAvailability } from '../services/scheduling/availability';
import { loadDayContext, type DayContext } from '../services/scheduling/directive-service';
import { spanMinutes } from '../services/scheduling/intervals';
import { loadSchedulingPreferences } from '../services/scheduling/repository';
import {
  derivePlanState,
  selectFocus,
  selectMomentum,
  selectStatusCards,
  type TodayPlanCandidate,
  type TodayStatusCandidate,
} from '../services/hub/today-projection';
import { addDays, instantAt, weekStartOf } from '../services/scheduling/zoned-time';
import {
  callerActorIds,
  callerOrgIds,
  sameDay,
  taskCategoriesFor,
  toTaskItem,
  type TaskRow,
} from './hub-helpers';
import type { WorkStatusCategory } from '@docket/types';

/**
 * Select the caller's live tasks blocked by at least one blocker that is still open.
 *
 * @remarks
 * Both sides are filtered to live work, which the surrounding queries have always done and this one
 * did not. Without it an archived, completed, or canceled task stayed in "Blocked" forever, and a
 * blocker that was itself canceled or archived went on blocking something it could no longer
 * affect. Neither was visible while Today rendered this list as a number.
 */
async function selectBlockedTasks(orgIds: string[], actorIds: string[]): Promise<TaskRow[]> {
  const mine = await db
    .select()
    .from(task)
    .where(
      and(
        inArray(task.organizationId, orgIds),
        inArray(task.assigneeId, actorIds),
        isNull(task.archivedAt),
        isNull(task.completedAt),
        isNull(task.canceledAt),
      ),
    );
  if (mine.length === 0) return [];

  const edges = await db
    .select({
      blockedTaskId: taskDependency.blockedTaskId,
      blockingCompletedAt: task.completedAt,
      blockingCanceledAt: task.canceledAt,
      blockingArchivedAt: task.archivedAt,
    })
    .from(taskDependency)
    .innerJoin(task, eq(task.id, taskDependency.blockingTaskId))
    .where(
      inArray(
        taskDependency.blockedTaskId,
        mine.map((row) => row.id),
      ),
    );
  const blockedIds = new Set(
    edges
      .filter(
        (edge) =>
          edge.blockingCompletedAt === null &&
          edge.blockingCanceledAt === null &&
          edge.blockingArchivedAt === null,
      )
      .map((edge) => edge.blockedTaskId),
  );
  return mine.filter((row) => blockedIds.has(row.id));
}

/** Build the Hub Today payload without its HTTP envelope. */
export async function buildHubTodayPayload(
  userId: string,
  date: string,
): Promise<z.input<typeof HubTodayOut>> {
  const [orgIds, hubRows, actorIds] = await Promise.all([
    callerOrgIds(userId),
    db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1),
    callerActorIds(userId),
  ]);
  const hubId = hubRows[0]?.id;
  if (orgIds.length === 0 || !hubId) return emptyToday(date);

  const [context, preferences, planRows, activeIntervals] = await Promise.all([
    loadDayContext(db, { hubId, userId, date }),
    loadSchedulingPreferences(db, hubId),
    db
      .select()
      .from(dailyPlanItem)
      .where(and(eq(dailyPlanItem.hubId, hubId), eq(dailyPlanItem.date, date))),
    db
      .select({ taskId: timeInterval.taskId })
      .from(timeInterval)
      .where(
        and(
          eq(timeInterval.hubId, hubId),
          eq(timeInterval.mode, 'human_active'),
          isNull(timeInterval.endedAt),
          isNull(timeInterval.supersededById),
        ),
      )
      .limit(1),
  ]);
  const scopedPlanRows = planRows
    .filter((row) => orgIds.includes(row.refOrganizationId))
    .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id));
  const plannedTaskIds = [...new Set(scopedPlanRows.map((row) => row.refTaskId))];

  const dayStart = instantAt(date, 0, context.timezone);
  const dayEnd = instantAt(addDays(date, 1), 0, context.timezone);
  const duePredicate = and(
    inArray(task.organizationId, orgIds),
    isNull(task.archivedAt),
    isNull(task.completedAt),
    isNull(task.canceledAt),
    gte(task.dueDate, dayStart),
    lt(task.dueDate, dayEnd),
  );
  const [plannedRows, dueRows, awaitingSessions, blockedRows, momentumRows, inboxRows] =
    await Promise.all([
      plannedTaskIds.length > 0
        ? db
            .select()
            .from(task)
            .where(and(inArray(task.organizationId, orgIds), inArray(task.id, plannedTaskIds)))
        : Promise.resolve([]),
      db.select().from(task).where(duePredicate).limit(60),
      db
        .select({ taskId: agentSession.taskId })
        .from(agentSession)
        .where(
          and(
            inArray(agentSession.organizationId, orgIds),
            eq(agentSession.status, 'awaiting_approval'),
          ),
        ),
      actorIds.length > 0 ? selectBlockedTasks(orgIds, actorIds) : Promise.resolve([]),
      actorIds.length > 0
        ? db
            .select()
            .from(task)
            .where(
              and(
                inArray(task.organizationId, orgIds),
                inArray(task.assigneeId, actorIds),
                isNull(task.archivedAt),
                isNull(task.completedAt),
                isNull(task.canceledAt),
                gt(task.estimateMinutes, 0),
              ),
            )
            .orderBy(desc(task.updatedAt))
            .limit(60)
        : Promise.resolve([]),
      db
        .select({ n: count() })
        .from(notification)
        .where(and(eq(notification.userId, userId), isNull(notification.readAt))),
    ]);

  const approvalTaskIds = [
    ...new Set(
      awaitingSessions.map((session) => session.taskId).filter((id): id is string => id !== null),
    ),
  ];
  const approvalRows =
    approvalTaskIds.length > 0
      ? await db
          .select()
          .from(task)
          .where(and(inArray(task.organizationId, orgIds), inArray(task.id, approvalTaskIds)))
      : [];

  const candidateTasks = uniqueTasks([
    ...plannedRows,
    ...dueRows,
    ...approvalRows,
    ...blockedRows,
    ...momentumRows,
  ]);
  const dependencyFacts = await loadDependencyFacts(orgIds, candidateTasks);
  const candidateProjectIds = [
    ...new Set(
      candidateTasks.map((row) => row.projectId).filter((id): id is string => id !== null),
    ),
  ].slice(0, 40);
  const [candidateProjectRows, recentProjectRows] = await Promise.all([
    candidateProjectIds.length > 0
      ? db
          .select()
          .from(project)
          .where(
            and(
              inArray(project.organizationId, orgIds),
              inArray(project.id, candidateProjectIds),
              isNull(project.archivedAt),
            ),
          )
      : Promise.resolve([]),
    db
      .select()
      .from(project)
      .where(
        and(
          inArray(project.organizationId, orgIds),
          inArray(project.status, ['planned', 'active']),
          isNull(project.archivedAt),
        ),
      )
      .orderBy(desc(project.updatedAt), project.id)
      .limit(40),
  ]);
  const projectRows = [
    ...new Map(
      [...candidateProjectRows, ...recentProjectRows].map((row) => [row.id, row]),
    ).values(),
  ].slice(0, 40);
  const projectIds = projectRows.map((row) => row.id);
  const [
    projectProgressRows,
    projectUpdates,
    milestones,
    projectInitiativeLinks,
    recentInitiatives,
  ] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({
            projectId: task.projectId,
            total: count(task.id),
            completed: count(task.completedAt),
          })
          .from(task)
          .where(and(inArray(task.projectId, projectIds), isNull(task.archivedAt)))
          .groupBy(task.projectId)
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .selectDistinctOn([statusUpdate.subjectId])
          .from(statusUpdate)
          .where(
            and(
              inArray(statusUpdate.organizationId, orgIds),
              eq(statusUpdate.subjectType, 'project'),
              inArray(statusUpdate.subjectId, projectIds),
            ),
          )
          .orderBy(statusUpdate.subjectId, desc(statusUpdate.createdAt), desc(statusUpdate.id))
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .selectDistinctOn([milestone.projectId])
          .from(milestone)
          .where(
            and(
              inArray(milestone.projectId, projectIds),
              gte(milestone.targetDate, dayStart),
              isNull(milestone.archivedAt),
            ),
          )
          .orderBy(milestone.projectId, asc(milestone.targetDate), milestone.id)
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .select()
          .from(initiativeProject)
          .where(inArray(initiativeProject.projectId, projectIds))
          .limit(200)
      : Promise.resolve([]),
    db
      .select()
      .from(initiative)
      .where(
        and(
          inArray(initiative.organizationId, orgIds),
          inArray(initiative.status, ['proposed', 'active']),
          isNull(initiative.archivedAt),
        ),
      )
      .orderBy(desc(initiative.updatedAt), initiative.id)
      .limit(20),
  ]);
  const linkedInitiativeIds = [...new Set(projectInitiativeLinks.map((link) => link.initiativeId))];
  const linkedInitiatives =
    linkedInitiativeIds.length > 0
      ? await db
          .select()
          .from(initiative)
          .where(
            and(
              inArray(initiative.organizationId, orgIds),
              inArray(initiative.id, linkedInitiativeIds),
              isNull(initiative.archivedAt),
            ),
          )
      : [];
  const initiativeRows = [
    ...new Map([...linkedInitiatives, ...recentInitiatives].map((row) => [row.id, row])).values(),
  ].slice(0, 20);
  const initiativeIds = initiativeRows.map((row) => row.id);
  const [directInitiativeLinks, initiativeUpdates, initiativeProgressRows] = await Promise.all([
    initiativeIds.length > 0
      ? db
          .select()
          .from(initiativeProject)
          .where(inArray(initiativeProject.initiativeId, initiativeIds))
          .limit(200)
      : Promise.resolve([]),
    initiativeIds.length > 0
      ? db
          .selectDistinctOn([statusUpdate.subjectId])
          .from(statusUpdate)
          .where(
            and(
              inArray(statusUpdate.organizationId, orgIds),
              eq(statusUpdate.subjectType, 'initiative'),
              inArray(statusUpdate.subjectId, initiativeIds),
            ),
          )
          .orderBy(statusUpdate.subjectId, desc(statusUpdate.createdAt), desc(statusUpdate.id))
      : Promise.resolve([]),
    initiativeIds.length > 0
      ? db
          .select({
            initiativeId: initiativeProject.initiativeId,
            total: count(project.id),
            onTrack: sql<number>`count(*) filter (where ${project.health} = 'on_track')`.mapWith(
              Number,
            ),
            atRisk: sql<number>`count(*) filter (where ${project.health} = 'at_risk')`.mapWith(
              Number,
            ),
            offTrack: sql<number>`count(*) filter (where ${project.health} = 'off_track')`.mapWith(
              Number,
            ),
          })
          .from(initiativeProject)
          .innerJoin(project, eq(project.id, initiativeProject.projectId))
          .where(
            and(inArray(initiativeProject.initiativeId, initiativeIds), isNull(project.archivedAt)),
          )
          .groupBy(initiativeProject.initiativeId)
      : Promise.resolve([]),
  ]);
  const initiativeLinks = [
    ...new Map(
      [...projectInitiativeLinks, ...directInitiativeLinks].map((row) => [
        `${row.initiativeId}:${row.projectId}`,
        row,
      ]),
    ).values(),
  ];

  const refs: ResourceAccessRef[] = [
    ...candidateTasks.map((row) => resourceRef(row, 'task')),
    ...projectRows.map((row) => resourceRef(row, 'project')),
    ...initiativeRows.map((row) => resourceRef(row, 'initiative')),
  ];
  const access = await resolveResourceAccess(userId, refs);
  const canView = (ref: ResourceAccessRef): boolean =>
    access.get(resourceAccessKey(ref))?.canView === true;
  const visibleTask = (row: TaskRow): boolean => canView(resourceRef(row, 'task'));
  const visiblePlanned = plannedRows.filter(visibleTask);
  const planByTaskId = new Map(visiblePlanned.map((row) => [row.id, row]));
  const activeTaskId = activeIntervals[0]?.taskId ?? null;
  const now = new Date();
  const planCategories = await taskCategoriesFor(visiblePlanned);
  const planCategoryOf = (row: TaskRow): WorkStatusCategory =>
    planCategories.get(row.id) ?? 'backlog';
  const planCandidates: TodayPlanCandidate[] = scopedPlanRows
    .filter((planRow) => planByTaskId.has(planRow.refTaskId))
    .map((planRow, position) => {
      const row = planByTaskId.get(planRow.refTaskId);
      /* v8 ignore next -- @preserve filtered by the same map immediately above */
      if (!row) throw new Error('visible plan task disappeared');
      const impact = dependencyFacts.impactByTaskId.get(row.id) ?? 0;
      return {
        ...toTaskItem(row, planCategoryOf(row)),
        planItemId: planRow.id,
        planStatus:
          planRow.status === 'done' ||
          row.completedAt !== null ||
          row.canceledAt !== null ||
          row.archivedAt !== null
            ? 'done'
            : 'planned',
        sort: planRow.sort,
        position,
        estimateMinutes:
          row.estimateMinutes !== null && row.estimateMinutes > 0 ? row.estimateMinutes : null,
        timeboxStartsAt: planRow.timeboxStartsAt?.toISOString() ?? null,
        timeboxEndsAt: planRow.timeboxEndsAt?.toISOString() ?? null,
        blocked: dependencyFacts.blockedTaskIds.has(row.id),
        dependencyImpact: impact,
        reason: planReason(row, planRow, activeTaskId, now, impact),
      };
    });
  const planState = derivePlanState({ readiness: context.readiness, items: planCandidates });
  const focus = selectFocus({ items: planCandidates, now, activeTaskId });

  const visibleProjects = projectRows.filter((row) => canView(resourceRef(row, 'project')));
  const visibleInitiatives = initiativeRows.filter((row) =>
    canView(resourceRef(row, 'initiative')),
  );
  const latestUpdate = latestUpdates([...projectUpdates, ...initiativeUpdates]);
  const statusCards = buildStatusCards({
    projects: visibleProjects,
    initiatives: visibleInitiatives,
    links: initiativeLinks,
    projectProgress: new Map(
      projectProgressRows.flatMap((row) =>
        row.projectId === null
          ? []
          : [[row.projectId, { completed: row.completed, total: row.total }] as const],
      ),
    ),
    initiativeProgress: new Map(
      initiativeProgressRows.map((row) => [
        row.initiativeId,
        {
          onTrack: row.onTrack,
          atRisk: row.atRisk,
          offTrack: row.offTrack,
          total: row.total,
        },
      ]),
    ),
    updates: latestUpdate,
    milestones,
    focus,
    plan: planCandidates,
    date: dayStart,
  });

  const capacity = availableCapacity(context, preferences.windows, now);
  const plannedIds = new Set(planCandidates.map((item) => item.id));
  const visibleMomentum = momentumRows.filter(visibleTask);
  const selectedMomentum = selectMomentum({
    candidates: visibleMomentum.map((row) => ({
      id: row.id,
      visible: true,
      alreadyPlanned: plannedIds.has(row.id),
      blocked: dependencyFacts.blockedTaskIds.has(row.id),
      terminal: row.completedAt !== null || row.canceledAt !== null || row.archivedAt !== null,
      estimateMinutes: row.estimateMinutes ?? 0,
      dependencyImpact: dependencyFacts.impactByTaskId.get(row.id) ?? 0,
      priority: row.priority,
      dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
      startDate: row.startDate?.toISOString().slice(0, 10) ?? null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    date,
    remainingMinutes: capacity.totalMinutes,
    largestSpanMinutes: capacity.largestSpanMinutes,
  });
  const categories = await taskCategoriesFor([
    ...visiblePlanned,
    ...visibleMomentum,
    ...dueRows.filter(visibleTask),
    ...approvalRows.filter(visibleTask),
    ...blockedRows.filter(visibleTask),
  ]);
  const categoryOf = (row: TaskRow): WorkStatusCategory => categories.get(row.id) ?? 'backlog';
  const momentumById = new Map(visibleMomentum.map((row) => [row.id, row]));
  const suggestions: z.input<typeof HubTodaySuggestion>[] = selectedMomentum.flatMap(
    (candidate) => {
      const row = momentumById.get(candidate.id);
      if (!row?.estimateMinutes || row.estimateMinutes <= 0) return [];
      const impact = dependencyFacts.impactByTaskId.get(row.id) ?? 0;
      return [
        {
          ...toTaskItem(row, categoryOf(row)),
          estimateMinutes: row.estimateMinutes,
          dependencyImpact: impact,
          reason: suggestionReason(row, date, impact),
        },
      ];
    },
  );

  const visibleDue = dueRows.filter(visibleTask);
  const visibleApprovals = approvalRows.filter(visibleTask);
  const visibleBlocked = blockedRows.filter(visibleTask);
  const dueToday = visibleDue.map((row) => toTaskItem(row, categoryOf(row)));
  const approvals = visibleApprovals.map((row) => toTaskItem(row, categoryOf(row)));
  const blocked = visibleBlocked.map((row) => toTaskItem(row, categoryOf(row)));
  const inbox = inboxRows[0]?.n ?? 0;
  const attentionCount = approvals.length + blocked.length + dueToday.length + inbox;
  const firstAttention = approvals[0] ?? blocked[0] ?? dueToday[0];

  return {
    date,
    planState,
    brief: {
      text: briefText(planState, attentionCount, focus.now !== null),
      href: firstAttention
        ? `/orgs/${firstAttention.organizationId}/tasks/${firstAttention.id}`
        : null,
      attentionCount,
    },
    plan: planCandidates,
    focus,
    statusCards,
    suggestions,
    calendar: planCandidates.flatMap((item) =>
      item.timeboxStartsAt && item.timeboxEndsAt
        ? [
            {
              taskId: item.id,
              organizationId: item.organizationId,
              startsAt: item.timeboxStartsAt,
              endsAt: item.timeboxEndsAt,
            },
          ]
        : [],
    ),
    needsAttention: { approvals, blocked, dueToday, inbox },
  };
}

function emptyToday(date: string): z.input<typeof HubTodayOut> {
  return {
    date,
    planState: 'unplanned',
    brief: { text: 'Athena can help shape the day.', href: null, attentionCount: 0 },
    plan: [],
    focus: { now: null, after: null },
    statusCards: [],
    suggestions: [],
    calendar: [],
    needsAttention: { approvals: [], blocked: [], dueToday: [], inbox: 0 },
  };
}

function resourceRef(
  row: { readonly id: string; readonly organizationId: string },
  kind: 'task' | 'project' | 'initiative',
): ResourceAccessRef {
  return { id: row.id, organizationId: row.organizationId, kind };
}

function uniqueTasks(rows: readonly TaskRow[]): TaskRow[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

async function loadDependencyFacts(
  orgIds: readonly string[],
  candidates: readonly TaskRow[],
): Promise<{ blockedTaskIds: Set<string>; impactByTaskId: Map<string, number> }> {
  if (candidates.length === 0) return { blockedTaskIds: new Set(), impactByTaskId: new Map() };
  const ids = candidates.map((row) => row.id);
  const edges = await db
    .select()
    .from(taskDependency)
    .where(
      and(
        inArray(taskDependency.organizationId, orgIds),
        or(inArray(taskDependency.blockingTaskId, ids), inArray(taskDependency.blockedTaskId, ids)),
      ),
    );
  const relatedIds = [
    ...new Set(edges.flatMap((edge) => [edge.blockingTaskId, edge.blockedTaskId])),
  ];
  const related = relatedIds.length
    ? await db
        .select({ id: task.id, completedAt: task.completedAt })
        .from(task)
        .where(inArray(task.id, relatedIds))
    : [];
  const completedById = new Map(related.map((row) => [row.id, row.completedAt !== null]));
  const blockedTaskIds = new Set<string>();
  const impactByTaskId = new Map<string, number>();
  for (const edge of edges) {
    if (!completedById.get(edge.blockingTaskId)) blockedTaskIds.add(edge.blockedTaskId);
    if (!completedById.get(edge.blockedTaskId)) {
      impactByTaskId.set(edge.blockingTaskId, (impactByTaskId.get(edge.blockingTaskId) ?? 0) + 1);
    }
  }
  return { blockedTaskIds, impactByTaskId };
}

function planReason(
  row: TaskRow,
  planRow: typeof dailyPlanItem.$inferSelect,
  activeTaskId: string | null,
  now: Date,
  dependencyImpact: number,
): string | null {
  if (row.id === activeTaskId) return 'Timer running';
  if (
    planRow.timeboxStartsAt &&
    planRow.timeboxEndsAt &&
    planRow.timeboxStartsAt <= now &&
    now < planRow.timeboxEndsAt
  ) {
    return 'Scheduled now';
  }
  if (sameDay(row.dueDate?.toISOString(), planRow.date)) return 'Due today';
  if (dependencyImpact > 0) {
    return `Unblocks ${String(dependencyImpact)} ${dependencyImpact === 1 ? 'task' : 'tasks'}`;
  }
  // No reason. Position 0 is where the caller put it, and "You chose this first" restated the
  // person's own action back at them under a card already labelled "Now".
  return null;
}

function suggestionReason(row: TaskRow, date: string, dependencyImpact: number): string {
  if (dependencyImpact > 0) {
    return `Unblocks ${String(dependencyImpact)} ${dependencyImpact === 1 ? 'task' : 'tasks'}`;
  }
  if (row.dueDate && row.dueDate.toISOString().slice(0, 10) <= date) return 'Due today';
  if (row.priority === 'urgent' || row.priority === 'high')
    return `${capitalize(row.priority)} priority`;
  return 'Fits the time left today';
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function availableCapacity(
  context: DayContext,
  windows: readonly AvailabilityWindow[],
  now: Date,
): { readonly totalMinutes: number; readonly largestSpanMinutes: number } {
  const free = expandAvailability({
    weekStartDate: weekStartOf(context.date),
    timezone: context.timezone,
    windows,
    busy: context.blocks,
  }).free.flatMap((span) => {
    // A generic Task has no work-shape declaration, so a commute gap is not enough evidence that
    // it can genuinely be completed there. Desk and field windows are explicit work time; transit
    // remains reserved for the scheduler's interstitial shapes.
    if (span.kind === 'transit' || span.date !== context.date || span.end <= now.getTime())
      return [];
    const remaining = { ...span, start: Math.max(span.start, now.getTime()) };
    return remaining.end > remaining.start ? [remaining] : [];
  });
  const minutes = free.map(spanMinutes);
  return {
    totalMinutes: minutes.reduce((sum, value) => sum + value, 0),
    largestSpanMinutes: Math.max(0, ...minutes),
  };
}

function latestUpdates(
  rows: readonly (typeof statusUpdate.$inferSelect)[],
): Map<string, typeof statusUpdate.$inferSelect> {
  const result = new Map<string, typeof statusUpdate.$inferSelect>();
  for (const row of rows) {
    const key = `${row.subjectType}:${row.subjectId}`;
    if (!result.has(key)) result.set(key, row);
  }
  return result;
}

function buildStatusCards(input: {
  readonly projects: readonly (typeof project.$inferSelect)[];
  readonly initiatives: readonly (typeof initiative.$inferSelect)[];
  readonly links: readonly (typeof initiativeProject.$inferSelect)[];
  readonly projectProgress: ReadonlyMap<
    string,
    { readonly completed: number; readonly total: number }
  >;
  readonly initiativeProgress: ReadonlyMap<
    string,
    {
      readonly onTrack: number;
      readonly atRisk: number;
      readonly offTrack: number;
      readonly total: number;
    }
  >;
  readonly updates: ReadonlyMap<string, typeof statusUpdate.$inferSelect>;
  readonly milestones: readonly (typeof milestone.$inferSelect)[];
  readonly focus: {
    readonly now: TodayPlanCandidate | null;
    readonly after: TodayPlanCandidate | null;
  };
  readonly plan: readonly TodayPlanCandidate[];
  readonly date: Date;
}): z.input<typeof HubTodayStatusCard>[] {
  const repeatedStoryByProject = new Map<string, string>();
  const repeatedStoryByInitiative = new Map<string, string>();
  for (const link of [...input.links].sort((left, right) =>
    left.initiativeId.localeCompare(right.initiativeId),
  )) {
    const projectUpdate = input.updates.get(`project:${link.projectId}`);
    const initiativeUpdate = input.updates.get(`initiative:${link.initiativeId}`);
    if (!projectUpdate || !initiativeUpdate) continue;
    const projectStory = projectUpdate.body.replace(/\s+/g, ' ').trim();
    const initiativeStory = initiativeUpdate.body.replace(/\s+/g, ' ').trim();
    if (projectStory.length === 0 || projectStory !== initiativeStory) continue;
    const storyKey = `shared-update:${link.initiativeId}`;
    repeatedStoryByProject.set(link.projectId, storyKey);
    repeatedStoryByInitiative.set(link.initiativeId, storyKey);
  }
  const focusProjectIds = new Set(
    [input.focus.now?.projectId, input.focus.after?.projectId].filter((id): id is string =>
      Boolean(id),
    ),
  );
  const todayProjectIds = new Set(
    input.plan.map((item) => item.projectId).filter((id): id is string => Boolean(id)),
  );
  const linkedInitiativeIds = new Set(
    input.links
      .filter((link) => todayProjectIds.has(link.projectId))
      .map((link) => link.initiativeId),
  );
  const candidates: TodayStatusCandidate[] = [
    ...input.projects.map((row) =>
      statusCandidate(
        row,
        'project',
        focusProjectIds,
        todayProjectIds,
        input.updates,
        input.date,
        repeatedStoryByProject.get(row.id) ?? `project:${row.id}`,
      ),
    ),
    ...input.initiatives.map((row) => ({
      ...statusCandidate(
        row,
        'initiative',
        new Set<string>(),
        linkedInitiativeIds,
        input.updates,
        input.date,
        repeatedStoryByInitiative.get(row.id) ?? `initiative:${row.id}`,
      ),
      linkedToFocus: input.links.some(
        (link) => link.initiativeId === row.id && focusProjectIds.has(link.projectId),
      ),
    })),
  ];
  const selected = selectStatusCards(candidates);
  const projectById = new Map(input.projects.map((row) => [row.id, row]));
  const initiativeById = new Map(input.initiatives.map((row) => [row.id, row]));

  const cards: z.input<typeof HubTodayStatusCard>[] = [];
  for (const candidate of selected) {
    if (candidate.kind === 'project') {
      const row = projectById.get(candidate.id);
      if (!row) continue;
      const nextMilestone = input.milestones.find((item) => item.projectId === row.id);
      cards.push({
        kind: 'project',
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        status: row.status,
        health: row.health,
        latestUpdate: serializeUpdate(input.updates.get(`project:${row.id}`)),
        nextMilestone: nextMilestone?.targetDate
          ? {
              id: nextMilestone.id,
              name: nextMilestone.name,
              targetDate: nextMilestone.targetDate.toISOString().slice(0, 10),
            }
          : null,
        progress: input.projectProgress.get(row.id) ?? { completed: 0, total: 0 },
      });
      continue;
    }
    const row = initiativeById.get(candidate.id);
    if (!row) continue;
    cards.push({
      kind: 'initiative',
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      status: row.status,
      health: row.health,
      latestUpdate: serializeUpdate(input.updates.get(`initiative:${row.id}`)),
      targetDate: row.targetDate?.toISOString().slice(0, 10) ?? null,
      connectedWork: input.initiativeProgress.get(row.id) ?? {
        onTrack: 0,
        atRisk: 0,
        offTrack: 0,
        total: 0,
      },
    });
  }
  return cards;
}

function statusCandidate(
  row: {
    readonly id: string;
    readonly organizationId: string;
    readonly health: 'on_track' | 'at_risk' | 'off_track' | null;
    readonly targetDate: Date | null;
  },
  kind: 'project' | 'initiative',
  focusIds: ReadonlySet<string>,
  todayIds: ReadonlySet<string>,
  updates: ReadonlyMap<string, typeof statusUpdate.$inferSelect>,
  date: Date,
  storyKey: string,
): TodayStatusCandidate {
  const latest = updates.get(`${kind}:${row.id}`);
  const staleBefore = new Date(date.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const targetSoonAfter = new Date(date.getTime() + 14 * 24 * 60 * 60 * 1_000);
  return {
    id: row.id,
    kind,
    organizationId: row.organizationId,
    storyKey,
    linkedToFocus: focusIds.has(row.id),
    linkedToToday: todayIds.has(row.id),
    risk: row.health === 'off_track' ? 2 : row.health === 'at_risk' ? 1 : 0,
    stale: !latest || latest.createdAt < staleBefore,
    targetSoon: Boolean(row.targetDate && row.targetDate <= targetSoonAfter),
    updatedAt: latest?.createdAt.toISOString() ?? null,
  };
}

function serializeUpdate(
  row: typeof statusUpdate.$inferSelect | undefined,
): { excerpt: string; createdAt: string } | null {
  if (!row) return null;
  return {
    excerpt: row.body.replace(/\s+/g, ' ').trim().slice(0, 180),
    createdAt: row.createdAt.toISOString(),
  };
}

function briefText(
  planState: 'unplanned' | 'active' | 'cleared',
  attentionCount: number,
  hasActionableFocus: boolean,
): string {
  if (attentionCount > 0) {
    return `${String(attentionCount)} ${attentionCount === 1 ? 'item needs' : 'items need'} your attention today.`;
  }
  if (planState === 'unplanned') return 'Athena can fit priorities around the time you have.';
  if (planState === 'cleared')
    return 'Your accepted plan is clear. Athena found a few feasible next moves.';
  if (!hasActionableFocus)
    return 'Your remaining plan is blocked. Athena found feasible work you can move meanwhile.';
  return 'Your next two moves are ready.';
}
