/**
 * `@docket/api` — a workspace's status sets, and what a stored status key means inside one.
 *
 * @remarks
 * A workspace names its own statuses for Tasks, Projects, Programs, and Initiatives, so the key a
 * row stores (`task.state`, `project.status`) is scoped to that workspace and means nothing
 * outside it: two workspaces can call the same stage `shipped` and `live`. The five-value
 * category is what carries meaning across that boundary, and it is what drives the status glyph,
 * board grouping, progress, capacity, and every connector mapping.
 *
 * **A team may keep its own Task statuses.** A team that has any `work_status` rows of its own
 * resolves to them; every other team follows the workspace set, and a change to the workspace set
 * reaches all of them. {@link loadStatusSets} does that resolution once for a whole page of
 * results rather than once per row.
 *
 * This module replaces the per-team `workflow_states` reader it grew out of, and is the single
 * implementation of "move this row to that status" for the HTTP routes, the MCP tools, and the
 * automation engine alike.
 */
import { db, workStatus } from '@docket/db';
import {
  type WorkStatusCategory,
  type WorkStatusEntityType,
  compareWorkStatusOrder,
  isTerminalCategory,
} from '@docket/work/work-status-contract';
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';

/** One status, as every reader in the API sees it. */
export interface ResolvedStatus {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: WorkStatusCategory;
  readonly position: number;
  readonly isDefault: boolean;
  /** The owning team when this came from a forked set; null when it came from the workspace set. */
  readonly teamId: string | null;
}

/** The terminal timestamps a category implies for the row entering it. */
export interface TerminalStamps {
  readonly completedAt: Date | null;
  readonly canceledAt: Date | null;
}

/**
 * Derive the terminal timestamps for a row entering a status of this category.
 *
 * @remarks
 * `completedAt` and `canceledAt` are authoritative for progress, capacity, throughput, and the
 * blocked-by graph, and they are always derived here rather than accepted from a caller. Entering
 * a terminal category stamps its timestamp and clears the other; entering any other category
 * clears both, which is what makes reopening work behave.
 *
 * @param category - The category of the status being entered.
 * @returns the timestamps to write.
 */
export function terminalStampsFor(category: WorkStatusCategory): TerminalStamps {
  return {
    completedAt: category === 'completed' ? new Date() : null,
    canceledAt: category === 'canceled' ? new Date() : null,
  };
}

/** The resolved status sets for one workspace, ready to answer without further queries. */
export interface StatusSets {
  /** One kind of work's set, in board order, resolved for a team when one is given. */
  for(entityType: WorkStatusEntityType, teamId?: string | null): readonly ResolvedStatus[];
  /** A status by id, wherever it sits. */
  byId(statusId: string): ResolvedStatus | undefined;
  /** The category of a status by id, or `undefined` when the id is outside the loaded sets. */
  categoryOf(statusId: string): WorkStatusCategory | undefined;
  /** Where new work of this kind starts. */
  defaultOf(entityType: WorkStatusEntityType, teamId?: string | null): ResolvedStatus | undefined;
  /** The first status of a category, falling back the way {@link firstOfCategory} describes. */
  firstOfCategory(
    entityType: WorkStatusEntityType,
    category: WorkStatusCategory,
    teamId?: string | null,
  ): ResolvedStatus | undefined;
  /** Whether this team keeps its own Task statuses. */
  isForked(teamId: string): boolean;
}

/** Which sets to load. Omitting a filter loads every set the workspace has. */
export interface StatusSetRequest {
  readonly entityTypes?: readonly WorkStatusEntityType[];
  readonly teamIds?: readonly (string | null)[];
}

/**
 * What issues the read: the client, or a transaction already open on it.
 *
 * @remarks
 * A caller inside a transaction MUST pass its handle. Reading through the module-level client from
 * inside an open transaction issues the query on a connection that transaction already holds,
 * which does not read stale data — it stalls, and the request never returns.
 */
export type StatusReader = Pick<typeof db, 'select'>;

/** The key a set is filed under inside {@link loadStatusSets}. */
function setKey(entityType: WorkStatusEntityType, teamId: string | null): string {
  return `${entityType}:${teamId ?? ''}`;
}

/**
 * Load a workspace's status sets in one query.
 *
 * @remarks
 * Batched deliberately. A list query returns rows across arbitrarily many teams, and resolving
 * per row would turn one page of results into one query per result. Every set the caller might
 * need comes back together, and the returned object answers from memory after that.
 *
 * The workspace's own rows are always loaded, because they are the fallback for every team that
 * has not forked.
 *
 * @param orgId - The workspace whose statuses to load.
 * @param want - Which sets are needed; omit a filter to take them all.
 * @returns the resolved sets.
 *
 * @example
 * ```typescript
 * const sets = await loadStatusSets(orgId, { entityTypes: ['task'], teamIds: teamIdsOnThisPage });
 * const category = sets.categoryOf(row.statusId);
 * ```
 */
export async function loadStatusSets(
  orgId: string,
  want: StatusSetRequest = {},
  reader: StatusReader = db,
): Promise<StatusSets> {
  const teamIds = [...new Set((want.teamIds ?? []).filter((id): id is string => id !== null))];
  const scope: SQL | undefined =
    teamIds.length > 0
      ? or(isNull(workStatus.teamId), inArray(workStatus.teamId, teamIds))
      : isNull(workStatus.teamId);

  const filters = [eq(workStatus.organizationId, orgId), scope];
  if (want.entityTypes !== undefined && want.entityTypes.length > 0) {
    filters.push(inArray(workStatus.entityType, [...want.entityTypes]));
  }

  const rows = await reader
    .select({
      id: workStatus.id,
      key: workStatus.key,
      name: workStatus.name,
      description: workStatus.description,
      category: workStatus.category,
      position: workStatus.position,
      isDefault: workStatus.isDefault,
      teamId: workStatus.teamId,
      entityType: workStatus.entityType,
    })
    .from(workStatus)
    .where(and(...filters));

  const bySet = new Map<string, ResolvedStatus[]>();
  const byId = new Map<string, ResolvedStatus>();
  const forkedTeams = new Set<string>();
  // Only the teams this call actually loaded can be answered for. Asking about any other team
  // would otherwise get the workspace set back and look like a correct answer — see `resolve`.
  const askable = new Set(teamIds);

  for (const row of rows) {
    const status: ResolvedStatus = {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      position: row.position,
      isDefault: row.isDefault,
      teamId: row.teamId,
    };
    byId.set(status.id, status);
    const key = setKey(row.entityType, row.teamId);
    const bucket = bySet.get(key);
    if (bucket === undefined) bySet.set(key, [status]);
    else bucket.push(status);
    if (row.teamId !== null) forkedTeams.add(row.teamId);
  }
  for (const bucket of bySet.values()) bucket.sort(compareWorkStatusOrder);

  const resolve = (
    entityType: WorkStatusEntityType,
    teamId?: string | null,
  ): readonly ResolvedStatus[] => {
    if (typeof teamId === 'string' && entityType === 'task' && !askable.has(teamId)) {
      // A team whose rows were never loaded cannot be distinguished from one that has not forked,
      // so answering at all would mean handing back the workspace set as though it were the
      // team's. Callers name the teams they will ask about; this is a mistake in the call, not a
      // condition to recover from.
      throw new Error(`loadStatusSets was not asked to load team ${teamId}`);
    }
    if (entityType === 'task' && typeof teamId === 'string' && forkedTeams.has(teamId)) {
      return bySet.get(setKey(entityType, teamId)) ?? [];
    }
    return bySet.get(setKey(entityType, null)) ?? [];
  };

  return {
    for: resolve,
    byId: (statusId) => byId.get(statusId),
    categoryOf: (statusId) => byId.get(statusId)?.category,
    defaultOf: (entityType, teamId) => {
      const set = resolve(entityType, teamId);
      return set.find((status) => status.isDefault) ?? set[0];
    },
    firstOfCategory: (entityType, category, teamId) =>
      pickCategory(resolve(entityType, teamId), category),
    isForked: (teamId) => forkedTeams.has(teamId),
  };
}

/**
 * The best status of a category in a set, with a documented fallback.
 *
 * @remarks
 * Connectors mapping work in from another tool need a status of a particular category and cannot
 * give up when the workspace has none of exactly that shape. The fallback walks outward through
 * the taxonomy — the nearest category by rank in the same terminal/non-terminal half — and
 * settles on the set's default. It never fabricates a key, so a caller that receives `undefined`
 * knows the set is genuinely empty.
 *
 * @param set - The resolved set, in board order.
 * @param category - The category wanted.
 * @returns the status to use.
 */
function pickCategory(
  set: readonly ResolvedStatus[],
  category: WorkStatusCategory,
): ResolvedStatus | undefined {
  const exact = set.find((status) => status.category === category);
  if (exact !== undefined) return exact;
  const wantTerminal = isTerminalCategory(category);
  const sameHalf = set.filter((status) => isTerminalCategory(status.category) === wantTerminal);
  return sameHalf[0] ?? set.find((status) => status.isDefault) ?? set[0];
}

/** Reject a value that names no status in a set, listing the ones that would work. */
function unknownStatus(value: string, set: readonly ResolvedStatus[], field: string): never {
  throw new ValidationError(
    new z.ZodError([
      {
        code: 'invalid_value',
        path: [field],
        message: `"${value}" is not a status in this workspace.`,
        values: set.map((status) => status.key),
        input: value,
      },
    ]),
  );
}

/** Find a status by key or by display name, case-insensitively. */
function matchStatus(set: readonly ResolvedStatus[], value: string): ResolvedStatus | undefined {
  const needle = value.trim().toLowerCase();
  return set.find(
    (status) => status.key.toLowerCase() === needle || status.name.toLowerCase() === needle,
  );
}

/** A resolved Task transition: what to write on the row. */
export interface TaskStatusTransition extends TerminalStamps {
  readonly statusId: string;
  readonly state: string;
}

/**
 * Resolve a Task's target status and the timestamps entering it implies.
 *
 * @remarks
 * The single implementation, shared by `POST /tasks/:id/state`, `PATCH /tasks/:id`, the MCP write
 * tools, and the `task.setStatus` automation action, so a transition means the same thing
 * whichever door it came through. Matching accepts the display name as well as the key, because a
 * model asked to move something to "In Review" should not have to know the stored key.
 *
 * @param orgId - The workspace.
 * @param teamId - The task's team, which decides whether a forked set applies.
 * @param state - The target status, by key or display name.
 * @param field - The request field the value came from, used in the error path.
 * @returns the status id, its key, and the terminal timestamps.
 * @throws {NotFoundError} When the team has no statuses to move to at all.
 * @throws {ValidationError} When the value names no status, listing the keys that would work.
 */
export async function resolveTaskStatus(
  orgId: string,
  teamId: string,
  state: string,
  field = 'state',
  reader: StatusReader = db,
): Promise<TaskStatusTransition> {
  const sets = await loadStatusSets(orgId, { entityTypes: ['task'], teamIds: [teamId] }, reader);
  const set = sets.for('task', teamId);
  /* v8 ignore next -- @preserve every workspace is seeded with a task set before any task exists */
  if (set.length === 0) throw new NotFoundError('This workspace has no task statuses');

  const target = matchStatus(set, state) ?? unknownStatus(state, set, field);
  return { statusId: target.id, state: target.key, ...terminalStampsFor(target.category) };
}

/** A resolved container transition: what to write on the row. */
export interface ContainerStatusTransition {
  readonly statusId: string;
  readonly status: string;
  readonly category: WorkStatusCategory;
}

/**
 * Resolve a Project, Program, or Initiative's target status.
 *
 * @remarks
 * The container counterpart to {@link resolveTaskStatus}. These rows carry no terminal
 * timestamps of their own — a container's progress is computed from the work inside it — so this
 * returns the category instead, for callers that branch on whether the container has ended.
 *
 * @param orgId - The workspace.
 * @param entityType - Which kind of container.
 * @param status - The target status, by key or display name.
 * @param field - The request field the value came from, used in the error path.
 * @returns the status id, its key, and its category.
 * @throws {NotFoundError} When the workspace has no statuses for this kind of work.
 * @throws {ValidationError} When the value names no status, listing the keys that would work.
 */
export async function resolveContainerStatus(
  orgId: string,
  entityType: Exclude<WorkStatusEntityType, 'task'>,
  status: string,
  field = 'status',
  reader: StatusReader = db,
): Promise<ContainerStatusTransition> {
  const sets = await loadStatusSets(orgId, { entityTypes: [entityType] }, reader);
  const set = sets.for(entityType);
  /* v8 ignore next -- @preserve every workspace is seeded with all four sets on creation */
  if (set.length === 0) throw new NotFoundError(`This workspace has no ${entityType} statuses`);

  const target = matchStatus(set, status) ?? unknownStatus(status, set, field);
  return { statusId: target.id, status: target.key, category: target.category };
}

/**
 * Where new work of a kind starts in a workspace.
 *
 * @remarks
 * Used by every path that creates work without being told a status: the create routes, the
 * landing target for captured and imported work, recurrence materialization, and the MCP content
 * tools. The set's declared default answers it, which is why reordering a set no longer moves
 * where new work lands.
 *
 * @param orgId - The workspace.
 * @param entityType - Which kind of work is being created.
 * @param teamId - The team, for Tasks, which decides whether a forked set applies.
 * @returns the status to start in.
 * @throws {NotFoundError} When the workspace has no statuses for this kind of work.
 */
export async function landingStatus(
  orgId: string,
  entityType: WorkStatusEntityType,
  teamId: string | null = null,
  reader: StatusReader = db,
): Promise<ResolvedStatus> {
  const sets = await loadStatusSets(
    orgId,
    { entityTypes: [entityType], teamIds: teamId === null ? [] : [teamId] },
    reader,
  );
  const status = sets.defaultOf(entityType, teamId);
  /* v8 ignore next -- @preserve every workspace is seeded with all four sets on creation */
  if (status === undefined) throw new NotFoundError(`This workspace has no ${entityType} statuses`);
  return status;
}
