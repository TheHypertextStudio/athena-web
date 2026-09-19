/** Reachability probes that keep dependency and hierarchy edges acyclic. */
import type { db } from '@docket/db';
import { sql } from 'drizzle-orm';

import { rawResultRowCount } from '../raw-result';

type Executor = Pick<typeof db, 'execute'>;

/** Whether blocking a Task on another would close a dependency cycle. */
export async function taskCycleWouldClose(
  database: Executor,
  orgId: string,
  blockingId: string,
  blockedId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_task_id AS n FROM task_dependency
        WHERE blocking_task_id = ${blockedId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_task_id FROM task_dependency d
        JOIN reach r ON d.blocking_task_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}

/** Whether blocking a Project on another would close a dependency cycle. */
export async function projectCycleWouldClose(
  database: Executor,
  orgId: string,
  blockingId: string,
  blockedId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_project_id AS n FROM project_dependency
        WHERE blocking_project_id = ${blockedId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_project_id FROM project_dependency d
        JOIN reach r ON d.blocking_project_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}

/** Whether reparenting a Task under a candidate parent would make the parent its own descendant. */
export async function taskParentWouldCycle(
  database: Executor,
  orgId: string,
  taskId: string,
  parentId: string,
): Promise<boolean> {
  const result = await database.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM task WHERE parent_task_id = ${taskId} AND organization_id = ${orgId}
      UNION
      SELECT t.id FROM task t JOIN descendants d ON t.parent_task_id = d.id
        WHERE t.organization_id = ${orgId}
    ) SELECT 1 AS hit FROM descendants WHERE id = ${parentId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}

/** Whether reparenting any Task in a selection under one parent would close a hierarchy cycle. */
export async function taskParentWouldCycleAny(
  database: Executor,
  orgId: string,
  taskIds: readonly string[],
  parentId: string,
): Promise<boolean> {
  const ids = sql.join(
    taskIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await database.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM task WHERE organization_id = ${orgId} AND id IN (${ids})
      UNION
      SELECT child.id FROM task child
        JOIN descendants parent ON child.parent_task_id = parent.id
        WHERE child.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM descendants WHERE id = ${parentId} LIMIT 1
  `);
  return rawResultRowCount(result) > 0;
}
