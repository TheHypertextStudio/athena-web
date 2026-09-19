/** Set-based writes that apply one command's patches to many rows in a single statement. */
import { project, task } from '@docket/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Tx } from './types';

/** One row's pending column patch. */
export interface ObjectPatch {
  readonly id: string;
  readonly patch: Record<string, unknown>;
}

/** Move a batch of Tasks onto their new status tuples, each row taking its own values. */
export async function updateTaskStatuses(
  tx: Tx,
  orgId: string,
  writes: readonly ObjectPatch[],
): Promise<(typeof task.$inferSelect)[]> {
  if (writes.length === 0) return [];
  const payload = JSON.stringify(
    writes.map((write) => ({
      id: write.id,
      state: write.patch['state'],
      status_id: write.patch['statusId'],
      completed_at: write.patch['completedAt'],
      canceled_at: write.patch['canceledAt'],
    })),
  );
  const patches = sql`jsonb_to_recordset(${payload}::jsonb)
    AS status_patch(id text, state text, status_id text, completed_at timestamp, canceled_at timestamp)`;
  return tx
    .update(task)
    .set({
      state: sql`status_patch.state`,
      statusId: sql`status_patch.status_id`,
      completedAt: sql`status_patch.completed_at`,
      canceledAt: sql`status_patch.canceled_at`,
    })
    .from(patches)
    .where(
      and(
        eq(task.organizationId, orgId),
        isNull(task.archivedAt),
        sql`${task.id} = status_patch.id`,
      ),
    )
    .returning();
}

const REPLAY_INTEGER_PROPERTIES = new Set([
  'estimate',
  'startDateFiscalYearStartMonth',
  'targetDateFiscalYearStartMonth',
]);
const REPLAY_TIMESTAMP_PROPERTIES = new Set([
  'startDate',
  'dueDate',
  'targetDate',
  'archivedAt',
  'completedAt',
  'canceledAt',
]);

/** The Postgres column type a replayed property must be cast to inside the patch recordset. */
function replayColumnType(property: string): ReturnType<typeof sql.raw> {
  if (property === 'priority') return sql.raw('task_priority');
  if (property === 'health') return sql.raw('health');
  if (['startDateResolution', 'targetDateResolution'].includes(property)) {
    return sql.raw('planning_date_resolution');
  }
  if (REPLAY_INTEGER_PROPERTIES.has(property)) return sql.raw('integer');
  if (REPLAY_TIMESTAMP_PROPERTIES.has(property)) return sql.raw('timestamp');
  return sql.raw('text');
}

function replayPatchSource(
  updates: readonly ObjectPatch[],
  properties: readonly string[],
): ReturnType<typeof sql> {
  const definitions = sql.join(
    [
      sql`${sql.identifier('id')} text`,
      ...properties.map(
        (property) => sql`${sql.identifier(property)} ${replayColumnType(property)}`,
      ),
    ],
    sql`, `,
  );
  return sql`jsonb_to_recordset(${JSON.stringify(
    updates.map((update) => ({ id: update.id, ...update.patch })),
  )}::jsonb) AS replay_patch(${definitions})`;
}

/** Apply per-row replay patches to Tasks or Projects in one statement, returning the new rows. */
export async function updateReplayObjects(
  tx: Tx,
  orgId: string,
  kind: 'task' | 'project',
  updates: readonly ObjectPatch[],
): Promise<readonly (typeof task.$inferSelect | typeof project.$inferSelect)[]> {
  if (updates.length === 0) return [];
  const properties = [...new Set(updates.flatMap((update) => Object.keys(update.patch)))];
  const patch = Object.fromEntries(
    properties.map((property) => [property, sql`replay_patch.${sql.identifier(property)}`]),
  );
  const source = replayPatchSource(updates, properties);
  return kind === 'task'
    ? tx
        .update(task)
        .set(patch)
        .from(source)
        .where(and(eq(task.organizationId, orgId), sql`${task.id} = replay_patch.id`))
        .returning()
    : tx
        .update(project)
        .set(patch)
        .from(source)
        .where(and(eq(project.organizationId, orgId), sql`${project.id} = replay_patch.id`))
        .returning();
}
