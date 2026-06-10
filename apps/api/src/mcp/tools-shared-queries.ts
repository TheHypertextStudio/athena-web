import type { actor } from '@docket/db';
import { db, initiative, program, project, task, team } from '@docket/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '../error';

/** The subject table whose `health` an update of each subject type also writes to. */
export const subjectTable = { project, program, initiative } as const;

/**
 * Validate a workflow-state transition for a task against its team's `workflow_states`.
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
    .select({ workflowStates: team.workflowStates })
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
          message: `Unknown workflow state '${state}'`,
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

/** Load an active, org-scoped task row, or throw {@link NotFoundError}. */
export async function loadTask(orgId: string, id: string): Promise<typeof task.$inferSelect> {
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
 * Assert a directly org-scoped referenced row belongs to the caller's org, or 404.
 *
 * @remarks
 * Tenant isolation for FKs that target global PKs with no `organization_id` constraint.
 * A `null`/`undefined` id is a no-op.
 */
export async function assertRefInOrg(
  table: typeof actor | typeof project | typeof program,
  orgId: string,
  refId: string | null | undefined,
  message: string,
): Promise<void> {
  if (refId === null || refId === undefined) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, refId), eq(table.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(message);
}

/**
 * Whether adding `blocking → blocked` would create a dependency cycle.
 *
 * @remarks
 * The edge closes a cycle when `blocked` can already reach `blocking` along existing
 * `blocks` edges. Org-scoped.
 */
export async function wouldCreateCycle(
  orgId: string,
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<boolean> {
  const reach = (await db.execute(sql`
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

/** A lightweight projection for `run_view` rows. */
export interface ViewItem {
  readonly id: string;
  readonly title: string;
  readonly state?: string;
  readonly status?: string;
}

/** Run an org-scoped, ad-hoc entity query for `run_view`. */
export async function runEntityQuery(
  orgId: string,
  entity: 'task' | 'project' | 'program' | 'initiative',
  limit: number,
): Promise<ViewItem[]> {
  if (entity === 'task') {
    const rows = await db
      .select({ id: task.id, title: task.title, state: task.state })
      .from(task)
      .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .orderBy(desc(task.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, title: r.title, state: r.state }));
  }
  if (entity === 'project') {
    const rows = await db
      .select({ id: project.id, name: project.name, status: project.status })
      .from(project)
      .where(eq(project.organizationId, orgId))
      .orderBy(desc(project.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, title: r.name, status: r.status }));
  }
  if (entity === 'program') {
    const rows = await db
      .select({ id: program.id, name: program.name, status: program.status })
      .from(program)
      .where(eq(program.organizationId, orgId))
      .orderBy(desc(program.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, title: r.name, status: r.status }));
  }
  const rows = await db
    .select({ id: initiative.id, name: initiative.name, status: initiative.status })
    .from(initiative)
    .where(eq(initiative.organizationId, orgId))
    .orderBy(desc(initiative.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.name, status: r.status }));
}
