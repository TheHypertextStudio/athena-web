import { processDefinition, recurrenceSeries, type Database } from '@docket/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { requireLegacyDefinitionAccess } from './legacy-definition-access';
import { requireScheduleAccess } from './schedule-access';

/**
 * Archive a private definition and its authorized active schedules atomically, retaining history.
 * @throws When current definition or any affected schedule authority is missing; no changes commit.
 */
export async function archiveLegacyDefinition(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId: string;
    readonly definitionId: string;
  },
  now: Date,
): Promise<void> {
  const { organizationId, actorId, definitionId } = input;
  await database.transaction(async (tx) => {
    await requireLegacyDefinitionAccess(tx, { organizationId, actorId, definitionId }, 'manage');
    const series = await tx
      .select({ id: recurrenceSeries.id })
      .from(recurrenceSeries)
      .where(
        and(
          eq(recurrenceSeries.organizationId, organizationId),
          eq(recurrenceSeries.definitionId, definitionId),
          ne(recurrenceSeries.status, 'ended'),
          isNull(recurrenceSeries.archivedAt),
        ),
      )
      .for('update');
    for (const row of series)
      await requireScheduleAccess(tx, { organizationId, actorId, seriesId: row.id }, 'manage');
    await tx
      .update(processDefinition)
      .set({ status: 'archived', archivedAt: now })
      .where(
        and(
          eq(processDefinition.id, definitionId),
          eq(processDefinition.organizationId, organizationId),
        ),
      );
    await tx
      .update(recurrenceSeries)
      .set({ status: 'ended', endedAt: now })
      .where(
        and(
          eq(recurrenceSeries.definitionId, definitionId),
          eq(recurrenceSeries.organizationId, organizationId),
          ne(recurrenceSeries.status, 'ended'),
          isNull(recurrenceSeries.archivedAt),
        ),
      );
  });
}
