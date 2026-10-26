import { program, recurrenceSeries, type Database } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '../error';
import { removeWorkResources } from '../content/resource-removal';

/**
 * Remove a Program only when no independently owned schedule history depends on it.
 * The row lock serializes deletion with the schedule's same-tenant foreign-key check.
 * @returns The removed Program for its existing change receipt and search cleanup.
 * @throws {ConflictError} When archiving is required to retain owned schedule history.
 * @throws {NotFoundError} When the Program does not belong to the workspace.
 */
export async function deleteProgramPreservingScheduleHistory(
  database: Database,
  organizationId: string,
  programId: string,
): Promise<typeof program.$inferSelect> {
  return database.transaction(async (tx) => {
    const predicate = and(eq(program.organizationId, organizationId), eq(program.id, programId));
    const [existing] = await tx.select().from(program).where(predicate).for('update').limit(1);
    if (!existing) throw new NotFoundError('Program not found');
    const [owned] = await tx
      .select({ id: recurrenceSeries.id })
      .from(recurrenceSeries)
      .where(
        and(
          eq(recurrenceSeries.organizationId, organizationId),
          eq(recurrenceSeries.ownerProgramId, programId),
        ),
      )
      .limit(1);
    if (owned)
      throw new ConflictError('Archive this Program to preserve its recurring work history.');
    const [removed] = await tx.delete(program).where(predicate).returning();
    if (!removed) throw new NotFoundError('Program not found');
    await removeWorkResources(tx, {
      orgId: organizationId,
      subjectType: 'program',
      subjectId: programId,
    });
    return removed;
  });
}
