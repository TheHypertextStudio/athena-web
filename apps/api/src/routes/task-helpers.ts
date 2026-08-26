import { canActor, type Capability } from '@docket/authz';
import type { cycle, program } from '@docket/db';
import { actor, db, grant, milestone, project, role, task, type Database } from '@docket/db';
import type { GrantResourceKind } from '@docket/identity-access/grants';
import type { TaskOut, TaskRef } from '@docket/types';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { CapabilityError, NotFoundError, ValidationError } from '../error';
import type { LabelRefRow } from '../lib/labels';
import { rawResultRowCount, rawResultRows } from '../lib/raw-result';
import { resolveTaskStatus, type TaskStatusTransition } from '../lib/work-status';

/** TaskRow is the selected database row shape consumed by these API route serializers. */
export type TaskRow = typeof task.$inferSelect;

/**
 * Convert a task row into the public API response shape.
 *
 * @remarks
 * `labels` is required rather than defaulting to `[]` on purpose: a task's labels live in a join
 * table, so every caller has to decide whether to hydrate them, and a default would let a caller
 * quietly ship a permanently unlabeled response. Making it required turns that decision into a
 * compile error at each call site. Pass `[]` where labels genuinely do not apply.
 *
 * @param t - The task row.
 * @param labels - The task's labels, from `labelsForSubject(s)`.
 * @returns The serialized task.
 */
export function toOut(t: TaskRow, labels: readonly LabelRefRow[]): z.input<typeof TaskOut> {
  return {
    labels: [...labels],
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    parentTaskId: t.parentTaskId,
    templateId: t.templateId,
    autoCompletedBySubtasks: t.autoCompletedBySubtasks,
    estimateMinutes: t.estimateMinutes,
    startDate: t.startDate?.toISOString() ?? null,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      sourceIntegrationId: t.sourceIntegrationId,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Project a task row into a lightweight {@link TaskRef} (id/title/state/project). */
export function toRef(
  t: Pick<TaskRow, 'id' | 'title' | 'state' | 'projectId'>,
): z.input<typeof TaskRef> {
  return { id: t.id, title: t.title, state: t.state, projectId: t.projectId };
}

/** idParam is the reusable OpenAPI parameter schema for this API route route. */
export const idParam = z.object({ id: z.string() });
/** depParam is the reusable OpenAPI parameter schema for this API route route. */
export const depParam = z.object({ id: z.string(), depId: z.string() });

/**
 * Assert that an org-scoped referenced row belongs to the caller's org, or throw
 * {@link NotFoundError}.
 *
 * @remarks
 * Task FKs (`assigneeId`, `projectId`, `programId`, `cycleId`) target each table's
 * global PK with no `organization_id` baked into the FK, so a PATCH/create could
 * attach another tenant's entity. We re-read the target scoped by `orgId` and 404
 * (existence-hiding) when absent. A `null`/`undefined` `refId` is a no-op.
 */
export async function assertRefInOrg(
  table: typeof actor | typeof project | typeof program | typeof cycle,
  orgId: string,
  refId: string | null | undefined,
  notFoundMessage: string,
): Promise<void> {
  if (refId === null || refId === undefined) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.id, refId),
        eq(table.organizationId, orgId),
        ...(table === project ? [isNull(project.archivedAt)] : []),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError(notFoundMessage);
}

/**
 * Assert that a referenced Milestone belongs to the caller's org AND to the given
 * Project, or throw.
 *
 * @remarks
 * We join `milestone → project` and scope by the project's `organization_id` to hide
 * cross-tenant milestones behind a 404, same as {@link assertRefInOrg}. Beyond tenant
 * isolation, a milestone can only ever group tasks within its own Project, so once the
 * milestone is confirmed in-org we additionally check it belongs to `projectId` (the
 * task's own, current-or-incoming project) and reject the mismatch with a
 * {@link ValidationError} — the milestone exists and is in-org, it just isn't a valid
 * choice for this task, which is a validation failure rather than a hidden-existence one.
 * A `null`/`undefined` `milestoneId` is a no-op.
 */
export async function assertMilestoneInOrg(
  orgId: string,
  milestoneId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<void> {
  if (milestoneId === null || milestoneId === undefined) return;
  const rows = await db
    .select({ id: milestone.id, projectId: milestone.projectId })
    .from(milestone)
    .innerJoin(project, eq(milestone.projectId, project.id))
    .where(and(eq(milestone.id, milestoneId), eq(project.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Milestone not found');
  if (row.projectId !== projectId) {
    throw new ValidationError([
      { message: "Milestone must belong to the task's project", path: ['milestoneId'] },
    ]);
  }
}

/** The minimal task columns needed to decide view access. */
export type ViewableTaskParts = Pick<
  TaskRow,
  'id' | 'teamId' | 'projectId' | 'programId' | 'visibility'
>;

/** The normalized task-visibility grants shared by in-memory and SQL predicates. */
interface TaskViewScope {
  readonly isGuest: boolean;
  readonly orgRootView: boolean;
  readonly exactTaskGrants: ReadonlySet<string>;
  readonly cascadingGrants: Readonly<Record<GrantResourceKind, ReadonlySet<string>>>;
}

/** Load the one grant scope consumed by both in-memory and SQL task visibility predicates. */
async function loadTaskViewScope(
  orgId: string,
  actorId: string,
  database: Database = db,
): Promise<TaskViewScope | null> {
  const rows = await database
    .select({
      id: actor.id,
      roleId: role.id,
      roleKey: role.key,
      roleDefaultVisibility: role.defaultVisibility,
      grantSubjectKind: grant.subjectKind,
      grantSubjectId: grant.subjectId,
      grantResourceKind: grant.resourceKind,
      grantResourceId: grant.resourceId,
      grantCapabilities: grant.capabilities,
      grantEffect: grant.effect,
      grantCascades: grant.cascades,
      grantExpiresAt: grant.expiresAt,
    })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(actor.organizationId, role.organizationId)))
    .leftJoin(
      grant,
      and(
        eq(grant.organizationId, orgId),
        or(eq(grant.subjectId, actor.id), eq(grant.subjectId, actor.roleId)),
      ),
    )
    .where(
      and(
        eq(actor.id, actorId),
        eq(actor.organizationId, orgId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  const caller = rows[0];
  if (caller === undefined) return null;

  const now = Date.now();
  const cascadingGrants = {
    organization: new Set<string>(),
    team: new Set<string>(),
    initiative: new Set<string>(),
    project: new Set<string>(),
    program: new Set<string>(),
    cycle: new Set<string>(),
    task: new Set<string>(),
  } satisfies Record<GrantResourceKind, Set<string>>;
  const exactTaskGrants = new Set<string>();
  for (const g of rows) {
    if (
      g.grantSubjectKind === null ||
      g.grantSubjectId === null ||
      g.grantResourceKind === null ||
      g.grantResourceId === null ||
      g.grantCapabilities === null ||
      g.grantEffect === null ||
      g.grantCascades === null
    )
      continue;
    const matchesCaller =
      (g.grantSubjectKind === 'actor' && g.grantSubjectId === caller.id) ||
      (g.grantSubjectKind === 'role' &&
        caller.roleId !== null &&
        g.grantSubjectId === caller.roleId);
    if (!matchesCaller) continue;
    if (g.grantEffect !== 'allow') continue;
    if (g.grantCapabilities.length === 0) continue;
    if (g.grantExpiresAt && g.grantExpiresAt.getTime() < now) continue;
    if (g.grantResourceKind === 'task') {
      exactTaskGrants.add(g.grantResourceId);
    } else if (g.grantCascades) {
      cascadingGrants[g.grantResourceKind].add(g.grantResourceId);
    }
  }
  const orgRootView = cascadingGrants.organization.has(orgId);
  const isGuest = caller.roleKey === 'guest' || caller.roleDefaultVisibility === 'private';

  return {
    isGuest,
    orgRootView,
    exactTaskGrants,
    cascadingGrants,
  };
}

/**
 * Build an in-memory predicate deciding whether the caller may view a Task.
 *
 * `task.ancestor_path` is not materialized, so the scope follows the Task's team, Project,
 * Program, and organization grants. The same scope also drives {@link buildTaskViewCondition},
 * which keeps aggregate reads from drifting away from ordinary Task visibility.
 *
 * @param orgId - The caller's organization.
 * @param actorId - The caller's human actor id.
 * @param database - The database or active transaction that owns the visibility read.
 * @returns a predicate over the minimal task columns.
 */
export async function buildTaskViewFilter(
  orgId: string,
  actorId: string,
  database: Database = db,
): Promise<(t: ViewableTaskParts) => boolean> {
  const scope = await loadTaskViewScope(orgId, actorId, database);
  if (scope === null) return () => false;

  return (t) =>
    (t.visibility === 'public' && !scope.isGuest) ||
    scope.orgRootView ||
    scope.exactTaskGrants.has(t.id) ||
    scope.cascadingGrants.team.has(t.teamId) ||
    (t.projectId !== null && scope.cascadingGrants.project.has(t.projectId)) ||
    (t.programId !== null && scope.cascadingGrants.program.has(t.programId));
}

/**
 * Build the database predicate for the same task-view policy as
 * {@link buildTaskViewFilter}.
 *
 * Aggregate endpoints use this predicate instead of materializing every child Task in
 * application memory just to discard inaccessible rows or count the remainder.
 *
 * @param orgId - The caller's organization.
 * @param actorId - The caller's human actor id.
 * @returns a Drizzle condition scoped to the task table.
 */
export async function buildTaskViewCondition(orgId: string, actorId: string): Promise<SQL> {
  const scope = await loadTaskViewScope(orgId, actorId);
  if (scope === null) return sql`false`;

  const conditions: SQL[] = [];
  if (!scope.isGuest) conditions.push(eq(task.visibility, 'public'));
  if (scope.orgRootView) conditions.push(sql`true`);
  if (scope.exactTaskGrants.size > 0) conditions.push(inArray(task.id, [...scope.exactTaskGrants]));
  if (scope.cascadingGrants.team.size > 0)
    conditions.push(inArray(task.teamId, [...scope.cascadingGrants.team]));
  if (scope.cascadingGrants.project.size > 0)
    conditions.push(inArray(task.projectId, [...scope.cascadingGrants.project]));
  if (scope.cascadingGrants.program.size > 0)
    conditions.push(inArray(task.programId, [...scope.cascadingGrants.program]));
  return conditions.length > 0 ? (or(...conditions) ?? sql`false`) : sql`false`;
}

/**
 * Resolve the connected neighborhood of a task up to `depth` hops, following both
 * dependency edges (either direction) and parent/child subtask links.
 *
 * @remarks
 * The undirected edge set is assembled once as a non-recursive CTE, then a recursive CTE
 * walks it breadth-first to `depth`. The recursive term references only `nb` (once) joined
 * to the non-recursive `edges` CTE — Postgres forbids the recursive name inside a subquery,
 * which this avoids. Returns active, org-scoped rows (a non-existent/foreign root → `[]`).
 *
 * @param orgId - The caller's organization.
 * @param rootTaskId - The task at the center of the neighborhood.
 * @param depth - Maximum hop distance from the root.
 */
export async function loadNeighborhood(
  orgId: string,
  rootTaskId: string,
  depth: number,
): Promise<TaskRow[]> {
  const found = await db.execute(sql`
    WITH RECURSIVE edges AS (
      SELECT blocking_task_id AS a, blocked_task_id AS b
        FROM task_dependency WHERE organization_id = ${orgId}
      UNION ALL
      SELECT blocked_task_id AS a, blocking_task_id AS b
        FROM task_dependency WHERE organization_id = ${orgId}
      UNION ALL
      SELECT parent_task_id AS a, id AS b
        FROM task WHERE organization_id = ${orgId} AND parent_task_id IS NOT NULL
      UNION ALL
      SELECT id AS a, parent_task_id AS b
        FROM task WHERE organization_id = ${orgId} AND parent_task_id IS NOT NULL
    ),
    nb AS (
      SELECT ${rootTaskId}::text AS id, 0 AS d
      UNION
      SELECT e.b, nb.d + 1 FROM nb JOIN edges e ON e.a = nb.id WHERE nb.d < ${depth}
    )
    SELECT DISTINCT id FROM nb
  `);

  const ids = rawResultRows<{ id: string }>(found).map((r) => r.id);
  if (ids.length === 0) return [];
  return db
    .select()
    .from(task)
    .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt), inArray(task.id, ids)));
}

/** Load a single active task scoped to the org, or throw {@link NotFoundError}. */
export async function loadTask(orgId: string, id: string): Promise<TaskRow> {
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Task not found');
  return row;
}

/**
 * Require a canonical capability grant for an already-confirmed task.
 *
 * @remarks
 * Route handlers first call {@link loadTask} so an unknown, archived, or cross-org id stays a
 * plain 404. This function then delegates the authorization decision itself to
 * {@link canActor}; it does not recreate grant matching or cascade rules locally. A caller with
 * no effective capability cannot distinguish a private task from a missing task, while a caller
 * that can view it but lacks the requested write capability receives the normal 403.
 *
 * @param orgId - The task's owning organization.
 * @param actorId - The human actor attempting the operation.
 * @param target - The active in-org task previously loaded by the caller.
 * @param required - The capability required by the operation.
 * @throws {NotFoundError} When the caller has no effective access to the task.
 * @throws {CapabilityError} When the caller can view the task but cannot perform the operation.
 */
export async function assertTaskCapability(
  orgId: string,
  actorId: string,
  target: ViewableTaskParts,
  required: Capability,
  database: Database = db,
): Promise<void> {
  const result = await canActor(
    actorId,
    required,
    { kind: 'task', id: target.id, orgId },
    database,
  );
  if (result.allow) return;
  if (result.effectiveCapability === null) {
    // `canActor` intentionally resolves explicit grants only, while task reads also include the
    // documented public, non-guest view baseline. Preserve that distinction in the error shape:
    // a visible public task with no write grant is forbidden, not hidden; a private/unviewable
    // task remains indistinguishable from a missing one.
    const canView = await buildTaskViewFilter(orgId, actorId, database);
    if (!canView(target)) throw new NotFoundError('Task not found');
  }
  throw new CapabilityError();
}

/**
 * Resolve a workflow-state transition using the canonical status catalogue.
 *
 * @remarks
 * This preserves the legacy route helper while ensuring callers persist both
 * the human-readable state and its required status identifier.
 */
export async function resolveStateTransition(
  orgId: string,
  teamId: string,
  state: string,
): Promise<TaskStatusTransition> {
  return resolveTaskStatus(orgId, teamId, state);
}

/**
 * Whether adding `blocking → blocked` would create a cycle, by checking if `blocked`
 * can already reach `blocking` along existing `blocks` edges.
 *
 * @param tx - The active SERIALIZABLE transaction (read + insert must be atomic).
 */
export async function wouldCreateCycle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<boolean> {
  const reach = await tx.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_task_id AS n FROM task_dependency
        WHERE blocking_task_id = ${blockedTaskId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_task_id FROM task_dependency d
        JOIN reach r ON d.blocking_task_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingTaskId} LIMIT 1
  `);
  return rawResultRowCount(reach) > 0;
}

/**
 * Whether reparenting `taskId` under `newParentId` would create a subtask cycle — i.e. `taskId`
 * is already an ancestor of `newParentId` (making a task its own descendant).
 *
 * @remarks
 * Walks UP the `parent_task_id` chain from `newParentId`; a hit on `taskId` means the move would
 * close a loop. Runs inside the same SERIALIZABLE transaction as the write so two concurrent
 * reparents can't each pass and commit an A→B / B→A loop. Self (`taskId === newParentId`) is
 * rejected earlier as a validation error, not here.
 *
 * @param tx - The active SERIALIZABLE transaction (read + update must be atomic).
 */
export async function wouldCreateSubtaskCycle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  taskId: string,
  newParentId: string,
): Promise<boolean> {
  const reach = await tx.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT parent_task_id AS p FROM task
        WHERE id = ${newParentId} AND organization_id = ${orgId}
      UNION
      SELECT t.parent_task_id FROM task t
        JOIN ancestors a ON t.id = a.p WHERE t.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM ancestors WHERE p = ${taskId} LIMIT 1
  `);
  return rawResultRowCount(reach) > 0;
}
