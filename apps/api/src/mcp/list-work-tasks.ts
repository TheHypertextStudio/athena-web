/**
 * `@docket/api` — the task branch of the `list_work` query.
 *
 * @remarks
 * Task rows are additionally filtered through the canonical task-view predicate. The MCP surface
 * must never disclose a private task merely because its caller can open the org, so the keyset
 * scan continues past a run of hidden rows rather than letting them shorten the page.
 */
import { actor, cycle, db, project, task, taskDependency, taskLabel, team } from '@docket/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, exists, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { defaultCycleName } from '@docket/work/cycle-contract';
import { buildTaskViewFilter, type ViewableTaskParts } from '../routes/task-helpers';
import { resolveDescriptor, resolveOptional } from './descriptors';
import { entityHref } from './entity-href';
import { seekAfter } from './list-work-seek';
import { anyValue, isoDay, type ListWorkQuery, type WorkPageRow } from './list-work-contract';
import type { WorkCursor } from './tools-shared-queries';
import { stateTypeOf, teamWorkflows } from './workflow-states';

/**
 * Check a raw task row before a bulk MCP helper serializes its id or title.
 *
 * @remarks
 * `update` and `archive` fetch polymorphic work rows after a direct-id scope. Their task branch
 * must apply the same predicate as `list_work` before building a report; otherwise a denied task
 * becomes an id/title oracle in `skipped`.
 *
 * @param row - A raw row selected from the task table.
 * @param canViewTask - The canonical task-view predicate for the authenticated caller.
 * @returns Whether this row is a well-formed, visible task.
 */
export function isTaskRowVisible(
  row: Record<string, unknown>,
  canViewTask: (task: ViewableTaskParts) => boolean,
): boolean {
  const id = row['id'];
  const teamId = row['teamId'];
  const projectId = row['projectId'];
  const programId = row['programId'];
  const visibility = row['visibility'];
  if (
    typeof id !== 'string' ||
    typeof teamId !== 'string' ||
    (projectId !== null && typeof projectId !== 'string') ||
    (programId !== null && typeof programId !== 'string') ||
    (visibility !== 'public' && visibility !== 'private')
  ) {
    return false;
  }
  return canViewTask({ id, teamId, projectId, programId, visibility });
}

/**
 * Map state display-names or keys onto storage keys, reading the team's workflow once.
 *
 * @param orgId - The organization the team belongs to.
 * @param teamId - The already-resolved team.
 * @param values - The state names or keys the caller supplied.
 * @returns the storage keys, unknown values passed through so the query simply matches nothing.
 */
async function resolveStateKeys(
  orgId: string,
  teamId: string,
  values: readonly string[],
): Promise<string[]> {
  const rows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const states = rows[0]?.workflowStates ?? [];
  return values.map((value) => {
    const needle = value.trim().toLowerCase();
    const match = states.find(
      (state) => state.key.toLowerCase() === needle || state.name.toLowerCase() === needle,
    );
    return match?.key ?? value;
  });
}

/**
 * A task is blocked when something that is not yet finished blocks it.
 *
 * @remarks
 * The blocking task is aliased because the subquery and the outer query both read `task`; without
 * it the correlation on `blocked_task_id` would bind to the wrong side and every task would look
 * blocked by itself.
 */
function blockedPredicate(): SQL {
  const blocker = alias(task, 'blocker');
  return exists(
    db
      .select({ one: sql`1` })
      .from(taskDependency)
      .innerJoin(blocker, eq(taskDependency.blockingTaskId, blocker.id))
      .where(and(eq(taskDependency.blockedTaskId, task.id), isNull(blocker.completedAt))),
  );
}

/** A task row's foreign keys, before they are resolved to anything a person can read. */
interface TaskRowRefs {
  readonly assigneeId: string | null;
  readonly projectId: string | null;
  readonly parentTaskId: string | null;
  readonly cycleId: string | null;
}

/** The names behind one page of task rows, keyed by id. */
interface TaskRowNames {
  readonly actors: Map<string, string>;
  readonly projects: Map<string, string>;
  readonly parents: Map<string, string>;
  readonly cycles: Map<string, string>;
}

/**
 * A cycle's display name.
 *
 * @remarks
 * `number` is an epoch-anchored idempotency key, not an ordinal, so an unnamed cycle is labelled by
 * its window. See `defaultCycleName` in `@docket/work/cycle-contract`.
 *
 * @param row - The cycle's name and window.
 * @returns the name a team would say.
 */
function cycleLabel(row: { name: string | null; startsAt: Date; endsAt: Date }): string {
  return row.name ?? defaultCycleName(row.startsAt, row.endsAt);
}

/**
 * Resolve one page's assignee, project, parent, and cycle ids to names.
 *
 * @remarks
 * Ids are what the model needs to act; names are what a person needs to recognise a row. The row
 * contract carries both because the same payload feeds a tool call and a card, and a card that
 * renders `act_01H...` where a name belongs is why the work-list widget could only ever show a
 * title and the word "Backlog".
 *
 * Four queries per page, not four per row, on the same reasoning as {@link teamWorkflows} above: a
 * 50-row page spanning every project in the org still costs four round trips.
 *
 * Every lookup is scoped to the organization, and the parent lookup also excludes archived rows.
 * `task.parentTaskId` carries no foreign key, so nothing below this constrains it to a row the
 * caller may see.
 *
 * @param orgId - The organization the page was read from.
 * @param rows - The visible rows for one page.
 * @returns Each id space resolved to display names; ids with no row are simply absent.
 */
async function taskRowNames(orgId: string, rows: readonly TaskRowRefs[]): Promise<TaskRowNames> {
  /**
   * Resolve one id space to a name map, skipping the query when the page references none.
   *
   * @param pick - The foreign key to collect off each row.
   * @param fetch - Runs the lookup for the distinct ids.
   * @param name - Reduces a fetched row to its display name.
   * @returns id-to-name, empty when the page referenced nothing.
   */
  async function lookup<T extends { id: string }>(
    pick: (row: TaskRowRefs) => string | null,
    fetch: (ids: string[]) => Promise<T[]>,
    name: (row: T) => string,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map(pick).filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    return new Map((await fetch(ids)).map((row) => [row.id, name(row)]));
  }

  const [actors, projects, parents, cycles] = await Promise.all([
    lookup(
      (row) => row.assigneeId,
      (ids) =>
        db
          .select({ id: actor.id, name: actor.displayName })
          .from(actor)
          .where(and(eq(actor.organizationId, orgId), inArray(actor.id, ids))),
      (row) => row.name,
    ),
    lookup(
      (row) => row.projectId,
      (ids) =>
        db
          .select({ id: project.id, name: project.name })
          .from(project)
          .where(and(eq(project.organizationId, orgId), inArray(project.id, ids))),
      (row) => row.name,
    ),
    lookup(
      (row) => row.parentTaskId,
      (ids) =>
        db
          .select({ id: task.id, name: task.title })
          .from(task)
          .where(
            and(eq(task.organizationId, orgId), isNull(task.archivedAt), inArray(task.id, ids)),
          ),
      (row) => row.name,
    ),
    lookup(
      (row) => row.cycleId,
      (ids) =>
        db
          .select({
            id: cycle.id,
            name: cycle.name,
            startsAt: cycle.startsAt,
            endsAt: cycle.endsAt,
          })
          .from(cycle)
          .where(and(eq(cycle.organizationId, orgId), inArray(cycle.id, ids))),
      (row) => cycleLabel(row),
    ),
  ]);

  return { actors, projects, parents, cycles };
}

/** One page of raw task columns, before names and state types are resolved onto them. */
interface TaskPageRow {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly teamId: string;
  readonly assigneeId: string | null;
  readonly projectId: string | null;
  readonly programId: string | null;
  readonly parentTaskId: string | null;
  readonly cycleId: string | null;
  readonly dueDate: Date | null;
  readonly visibility: 'public' | 'private';
  readonly createdAt: Date;
}

/** The columns one page of tasks is read with. */
const TASK_PAGE_COLUMNS = {
  id: task.id,
  title: task.title,
  state: task.state,
  teamId: task.teamId,
  assigneeId: task.assigneeId,
  projectId: task.projectId,
  programId: task.programId,
  parentTaskId: task.parentTaskId,
  cycleId: task.cycleId,
  dueDate: task.dueDate,
  visibility: task.visibility,
  createdAt: task.createdAt,
};

/**
 * Resolve every descriptor-shaped task filter at once.
 *
 * @remarks
 * Each descriptor is independent of the others, so they resolve concurrently: a fully-specified
 * query used to pay six serialized round trips before the list query started.
 *
 * @param orgId - The organization to resolve within.
 * @param input - The caller's filters.
 * @returns the equality predicates, and the resolved team the state filter needs.
 */
async function taskDescriptorFilters(
  orgId: string,
  input: ListWorkQuery['input'],
): Promise<{ teamId: string | undefined; filters: (SQL | undefined)[] }> {
  const [teamId, projectId, programId, assigneeId, delegateId, cycleId] = await Promise.all([
    resolveOptional(orgId, 'team', input.team, 'team'),
    resolveOptional(orgId, 'project', input.project, 'project'),
    resolveOptional(orgId, 'program', input.program, 'program'),
    resolveOptional(orgId, 'actor', input.assignee, 'assignee'),
    resolveOptional(orgId, 'actor', input.delegate, 'delegate'),
    resolveOptional(orgId, 'cycle', input.cycle, 'cycle'),
  ]);
  const filters: (SQL | undefined)[] = [];
  if (teamId !== undefined) filters.push(eq(task.teamId, teamId));
  if (projectId !== undefined) filters.push(eq(task.projectId, projectId));
  if (programId !== undefined) filters.push(eq(task.programId, programId));
  if (assigneeId !== undefined) filters.push(eq(task.assigneeId, assigneeId));
  if (delegateId !== undefined) filters.push(eq(task.delegateId, delegateId));
  if (cycleId !== undefined) filters.push(eq(task.cycleId, cycleId));
  if (input.parent !== undefined) filters.push(eq(task.parentTaskId, input.parent));
  return { teamId, filters };
}

/**
 * Match a task's workflow state against the supplied names or keys.
 *
 * @remarks
 * States are per-team, so a display name is only resolvable when the query is scoped to one team;
 * otherwise the value is taken as a key. The team is the one already resolved for the equality
 * filters — an earlier version re-resolved it once per state value, paying seven lookups to filter
 * on one.
 *
 * @param orgId - The organization to resolve within.
 * @param teamId - The already-resolved team, when the query is scoped to one.
 * @param values - The state names or keys the caller supplied.
 * @returns the predicate, or undefined when no state was asked for.
 */
async function taskStateFilter(
  orgId: string,
  teamId: string | undefined,
  values: readonly string[] | undefined,
): Promise<SQL | undefined> {
  if (values === undefined || values.length === 0) return undefined;
  const keys = teamId ? await resolveStateKeys(orgId, teamId, values) : values;
  return anyValue(task.state, keys);
}

/** Match tasks carrying one label. */
async function taskLabelFilter(orgId: string, label: string): Promise<SQL> {
  const labelId = await resolveDescriptor(orgId, 'label', label, 'label');
  return exists(
    db
      .select({ one: sql`1` })
      .from(taskLabel)
      .where(and(eq(taskLabel.taskId, task.id), eq(taskLabel.labelId, labelId))),
  );
}

/** The predicates behind the boolean task filters, which need no resolution. */
function taskFlagFilters(input: ListWorkQuery['input']): (SQL | undefined)[] {
  const filters: (SQL | undefined)[] = [];
  if (input.unfiled === true) filters.push(and(isNull(task.projectId), isNull(task.programId)));
  if (input.blocked === true) filters.push(blockedPredicate());
  if (input.blocking === true) {
    filters.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(taskDependency)
          .where(eq(taskDependency.blockingTaskId, task.id)),
      ),
    );
  }
  return filters;
}

/** The predicates behind the date-window task filters. */
function taskDateFilters(input: ListWorkQuery['input']): (SQL | undefined)[] {
  const filters: (SQL | undefined)[] = [];
  if (input.dueBefore !== undefined) filters.push(lte(task.dueDate, new Date(input.dueBefore)));
  if (input.dueAfter !== undefined) filters.push(gte(task.dueDate, new Date(input.dueAfter)));
  if (input.updatedAfter !== undefined) {
    filters.push(gte(task.updatedAt, new Date(input.updatedAfter)));
  }
  return filters;
}

/**
 * Assemble every predicate a task query runs under, apart from the keyset position.
 *
 * @param orgId - The organization to list within.
 * @param input - The caller's filters, already checked for applicability.
 * @returns the predicates, in no significant order.
 */
async function taskWhere(
  orgId: string,
  input: ListWorkQuery['input'],
): Promise<(SQL | undefined)[]> {
  const { teamId, filters } = await taskDescriptorFilters(orgId, input);
  return [
    eq(task.organizationId, orgId),
    input.archived === true ? isNotNull(task.archivedAt) : isNull(task.archivedAt),
    ...filters,
    await taskStateFilter(orgId, teamId, input.state),
    Array.isArray(input.priority) && input.priority.length > 0
      ? anyValue(task.priority, input.priority)
      : undefined,
    input.label === undefined ? undefined : await taskLabelFilter(orgId, input.label),
    ...taskFlagFilters(input),
    ...taskDateFilters(input),
  ];
}

/**
 * Keyset-scan the task table until one visible row past the requested page is in hand.
 *
 * @remarks
 * The shared task predicate is intentionally data-backed rather than restated as SQL here.
 * Scanning continues past a run of hidden rows so they cannot make a later visible row disappear
 * from pagination.
 *
 * @param where - The predicates the query runs under.
 * @param limit - Page size.
 * @param after - The keyset position from the cursor, when paging.
 * @param canView - The canonical task-view predicate for the authenticated caller.
 * @returns the visible rows, one over `limit` when more remain.
 */
async function scanVisibleTasks(
  where: (SQL | undefined)[],
  limit: number,
  after: WorkCursor | undefined,
  canView: (row: ViewableTaskParts) => boolean,
): Promise<TaskPageRow[]> {
  const visibleRows: TaskPageRow[] = [];
  let pageAfter = after;
  while (visibleRows.length <= limit) {
    const rows = await db
      .select(TASK_PAGE_COLUMNS)
      .from(task)
      .where(and(...where, seekAfter(task.createdAt, task.id, pageAfter)))
      .orderBy(desc(task.createdAt), desc(task.id))
      .limit(limit + 1);

    for (const row of rows) {
      if (!canView(row)) continue;
      visibleRows.push(row);
      if (visibleRows.length > limit) break;
    }

    if (visibleRows.length > limit || rows.length <= limit) break;
    const last = rows[rows.length - 1];
    if (!last) break;
    pageAfter = { createdAt: last.createdAt, id: last.id };
  }
  return visibleRows;
}

/** The display names one row carries, each present only when the id resolved to one. */

/**
 * Present one raw task row on the wire contract.
 *
 * @remarks
 * `teamId` is read to resolve the state type and then dropped. It is not part of the row contract,
 * and adding it here would widen the wire on the way past rather than on purpose.
 *
 * @param orgId - The organization the page was read from.
 * @param row - The raw row.
 * @param workflows - The team workflows behind the whole page.
 * @param names - The display names behind the whole page.
 * @returns the row as `list_work` reports it.
 */
function taskRowLabels(row: TaskPageRow, names: TaskRowNames): Record<string, string> {
  const assignee = row.assigneeId ? names.actors.get(row.assigneeId) : undefined;
  const projectName = row.projectId ? names.projects.get(row.projectId) : undefined;
  const parent = row.parentTaskId ? names.parents.get(row.parentTaskId) : undefined;
  const cycleName = row.cycleId ? names.cycles.get(row.cycleId) : undefined;
  return {
    ...(assignee ? { assignee } : {}),
    ...(projectName ? { project: projectName } : {}),
    ...(parent ? { parent } : {}),
    ...(cycleName ? { cycle: cycleName } : {}),
  };
}

function presentTaskRow(
  orgId: string,
  row: TaskPageRow,
  workflows: Awaited<ReturnType<typeof teamWorkflows>>,
  names: TaskRowNames,
): WorkPageRow {
  const stateType = stateTypeOf(workflows, row.teamId, row.state);
  return {
    id: row.id,
    title: row.title,
    href: entityHref(orgId, 'task', row.id),
    state: row.state,
    ...(stateType ? { stateType } : {}),
    ...(row.assigneeId ? { assigneeId: row.assigneeId } : {}),
    ...(row.projectId ? { projectId: row.projectId } : {}),
    ...taskRowLabels(row, names),
    ...(row.dueDate ? { dueDate: isoDay(row.dueDate) } : {}),
    createdAt: row.createdAt,
  };
}

/**
 * Build and run the task query.
 *
 * @param query - The call being served.
 * @returns the matching rows, one over `limit` when more remain.
 */
export async function listTasks(query: ListWorkQuery): Promise<WorkPageRow[]> {
  const { orgId, actorId, input, limit, after } = query;
  const where = await taskWhere(orgId, input);
  const canView = await buildTaskViewFilter(orgId, actorId);
  const visibleRows = await scanVisibleTasks(where, limit, after, canView);

  // One lookup for the whole page, not one per row: a page can span every team in the org, and
  // resolving each row separately would make a 50-row read cost 51 queries. Both depend only on
  // the page, so they go out together rather than in two round-trip phases.
  const [workflows, names] = await Promise.all([
    teamWorkflows(
      orgId,
      visibleRows.map((row) => row.teamId),
    ),
    taskRowNames(orgId, visibleRows),
  ]);

  return visibleRows.map((row) => presentTaskRow(orgId, row, workflows, names));
}
