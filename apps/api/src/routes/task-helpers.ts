import type { actor, cycle, program } from '@docket/db';
import { db, milestone, project, task, team } from '@docket/db';
import type { TaskRef } from '@docket/types';
import type { TaskOut } from '@docket/types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';

/** TaskRow is the selected database row shape consumed by these API route serializers. */
export type TaskRow = typeof task.$inferSelect;

/** toOut converts internal API route data into the public API response shape. */
export function toOut(t: TaskRow): z.input<typeof TaskOut> {
  return {
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
    estimateMinutes: t.estimateMinutes,
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
  const reach = (await tx.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_task_id AS n FROM task_dependency
        WHERE blocking_task_id = ${blockedTaskId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_task_id FROM task_dependency d
        JOIN reach r ON d.blocking_task_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingTaskId} LIMIT 1
  `)) as unknown as { rows: unknown[] };
  return reach.rows.length > 0;
}
