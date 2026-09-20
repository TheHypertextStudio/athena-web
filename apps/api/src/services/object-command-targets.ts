import { project, task } from '@docket/db';
import type { db } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

import { NotFoundError, ValidationError } from '../error';

/** Database transaction used while applying an object command. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Read one optional id from an object-command receipt. */
export function receiptId(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw new ValidationError([{ message: `Receipt contains an invalid ${field}`, path: [] }]);
}

/** Lock and return every requested Canvas command target. */
export async function lockTargets(
  database: Tx,
  organizationId: string,
  objectKind: 'task' | 'project',
  objectIds: readonly string[],
  operationType: string,
): Promise<(typeof task.$inferSelect)[] | (typeof project.$inferSelect)[]> {
  const label = objectKind === 'task' ? 'Task' : 'Project';
  const rows =
    objectKind === 'task'
      ? await database
          .select()
          .from(task)
          .where(and(eq(task.organizationId, organizationId), inArray(task.id, objectIds)))
          .for('update')
      : await database
          .select()
          .from(project)
          .where(and(eq(project.organizationId, organizationId), inArray(project.id, objectIds)))
          .for('update');
  if (rows.length !== objectIds.length) throw new NotFoundError(`${label} not found`);
  if (operationType !== 'restore' && rows.some((row) => row.archivedAt !== null)) {
    throw new NotFoundError(`${label} not found`);
  }
  return rows;
}
