import type { actor, cycle, program } from '@docket/db';
import { db, grant, milestone, project, task, team } from '@docket/db';
import type { GrantResourceKind, TaskOut, TaskRef } from '@docket/types';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';
import { rawResultRowCount, rawResultRows } from '../lib/raw-result';

/** TaskRow is the selected database row shape consumed by these API route serializers. */
export type TaskRow = typeof task.$inferSelect;

/** toOut converts internal API route data into the public API response shape. */
export function toOut(t: TaskRow): z.input<typeof TaskOut> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    summary: t.summary,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
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
    .where(and(eq(table.id, refId), eq(table.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(notFoundMessage);
}

/**
 * Assert that a referenced Milestone belongs to the caller's org, or throw
 * {@link NotFoundError}.
 *
 * @remarks
 * `milestone` has no `organization_id` column (its tenant is its parent project's),
 * so we join `milestone → project` and scope by the project's `organization_id`.
 */
export async function assertMilestoneInOrg(
  orgId: string,
  milestoneId: string | null | undefined,
): Promise<void> {
  if (milestoneId === null || milestoneId === undefined) return;
  const rows = await db
    .select({ id: milestone.id })
    .from(milestone)
    .innerJoin(project, eq(milestone.projectId, project.id))
    .where(and(eq(milestone.id, milestoneId), eq(project.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Milestone not found');
}

/** The minimal task columns needed to decide view access. */
export type ViewableTaskParts = Pick<
  TaskRow,
  'id' | 'teamId' | 'projectId' | 'programId' | 'visibility'
>;

/**
 * Build a predicate deciding whether `actorId` may *view* a task, mirroring the
 * `canActor('view', …)` grant cascade (task → team/project/program → organization) in
 * bulk so a whole task set is filtered with a single grant read instead of one query
 * per task.
 *
 * @remarks
 * `task.ancestor_path` is not materialized yet, so the containment chain is derived from
 * the task's own FK columns — the same chain {@link "@docket/authz"#ancestorChain} walks.
 * A task is viewable when it is `public`, or the actor (or its role) holds a non-expired
 * `allow` grant on the task, its team, its project, its program, or the organization root.
 * This is the first list-time use of the visibility cascade; `GET /tasks` can adopt it later.
 *
 * @param orgId - The caller's organization.
 * @param actorId - The caller's human actor id.
 * @param roleId - The actor's role id (a role-level grant also confers access), or null.
 * @returns a predicate over the minimal task columns.
 */
export async function buildTaskViewFilter(
  orgId: string,
  actorId: string,
  roleId: string | null,
): Promise<(t: ViewableTaskParts) => boolean> {
  const subjects = [actorId, roleId].filter((x): x is string => Boolean(x));
  const grants = await db
    .select({
      resourceKind: grant.resourceKind,
      resourceId: grant.resourceId,
      effect: grant.effect,
      expiresAt: grant.expiresAt,
    })
    .from(grant)
    .where(and(eq(grant.organizationId, orgId), inArray(grant.subjectId, subjects)));

  const now = Date.now();
  const granted = {
    organization: new Set<string>(),
    team: new Set<string>(),
    initiative: new Set<string>(),
    project: new Set<string>(),
    program: new Set<string>(),
    cycle: new Set<string>(),
    task: new Set<string>(),
  } satisfies Record<GrantResourceKind, Set<string>>;
  for (const g of grants) {
    if (g.effect !== 'allow') continue;
    if (g.expiresAt && g.expiresAt.getTime() < now) continue;
    granted[g.resourceKind].add(g.resourceId);
  }
  const orgRootView = granted.organization.has(orgId);

  return (t) =>
    t.visibility === 'public' ||
    orgRootView ||
    granted.task.has(t.id) ||
    granted.team.has(t.teamId) ||
    (t.projectId !== null && granted.project.has(t.projectId)) ||
    (t.programId !== null && granted.program.has(t.programId));
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
 * Resolve a workflow-state transition: validate `state` against the team's
 * `workflow_states` and derive `completedAt`/`canceledAt`.
 *
 * @remarks
 * Single source of truth for state mutation, shared by `POST /:id/state` and
 * `PATCH /:id`. Setting a `completed`/`canceled`-typed state stamps the matching
 * terminal timestamp and clears the other; any non-terminal state clears both.
 *
 * @throws {NotFoundError} When the team is missing.
 * @throws {ValidationError} When `state` is not one of the team's workflow states.
 */
export async function resolveStateTransition(
  orgId: string,
  teamId: string,
  state: string,
): Promise<{ state: string; completedAt: Date | null; canceledAt: Date | null }> {
  const teamRows = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const teamRow = teamRows[0];
  /* v8 ignore next -- @preserve defensive: a task always references an in-org team (FK + cascade) */
  if (!teamRow) throw new NotFoundError('Team not found');

  const target = teamRow.workflowStates.find((s) => s.key === state);
  if (!target) {
    throw new ValidationError(
      new z.ZodError([
        {
          code: 'custom',
          path: ['state'],
          message: `Unknown workflow state '${state}' for this team`,
          input: state,
        },
      ]),
    );
  }

  return {
    state,
    completedAt: target.type === 'completed' ? new Date() : null,
    canceledAt: target.type === 'canceled' ? new Date() : null,
  };
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
