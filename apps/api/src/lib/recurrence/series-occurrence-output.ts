import { processOccurrence, recurrenceSeriesRevision, type Database } from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { OccurrenceOut } from '../../contracts/recurrence';
import { readableLegacyWork } from './legacy-work-visibility';
import { occurrenceReferenceFacts } from './series-history-references';

/** Serialize occurrence history with authorized links to generated projects and tasks. */
export async function occurrenceOutputs(
  database: Database,
  organizationId: string,
  seriesId: string,
  actorId: string,
): Promise<z.input<typeof OccurrenceOut>[]> {
  const rows = await database
    .select({
      id: processOccurrence.id,
      seriesId: processOccurrence.seriesId,
      scheduledFor: processOccurrence.scheduledFor,
      originalScheduledFor: processOccurrence.originalScheduledFor,
      status: processOccurrence.status,
      resolvedAt: processOccurrence.resolvedAt,
      legacyInstanceId: processOccurrence.legacyInstanceId,
      blueprintAppliedAt: processOccurrence.blueprintAppliedAt,
      blueprintRootRefs: processOccurrence.blueprintRootRefs,
      native: sql<boolean>`${recurrenceSeriesRevision.scheduleDraft} is not null`,
      historical: sql<boolean>`${processOccurrence.historicalArchive} is not null`,
    })
    .from(processOccurrence)
    .leftJoin(
      recurrenceSeriesRevision,
      and(
        eq(recurrenceSeriesRevision.id, processOccurrence.seriesRevisionId),
        eq(recurrenceSeriesRevision.seriesId, processOccurrence.seriesId),
        eq(recurrenceSeriesRevision.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(processOccurrence.organizationId, organizationId),
        eq(processOccurrence.seriesId, seriesId),
      ),
    )
    .orderBy(processOccurrence.scheduledFor);
  const { instances, references } = await occurrenceReferenceFacts(database, organizationId, rows);
  const visible = await readableLegacyWork(database, { organizationId, actorId }, references);
  const firstVisible = new Map<string, string>();
  for (const reference of references) {
    const key = `${reference.instanceId}:${reference.kind}`;
    if (visible.has(`${reference.kind}:${reference.id}`) && !firstVisible.has(key)) {
      firstVisible.set(key, reference.id);
    }
  }
  return rows.map((occurrence) => {
    const instanceId = instances.get(occurrence.id) ?? null;
    return OccurrenceOut.parse({
      id: occurrence.id,
      seriesId: occurrence.seriesId,
      scheduledFor: occurrence.scheduledFor,
      originalScheduledFor: occurrence.originalScheduledFor,
      status: occurrence.status,
      processInstanceId: instanceId,
      taskId: firstVisible.get(`${instanceId}:task`) ?? null,
      projectId: firstVisible.get(`${instanceId}:project`) ?? null,
      resolvedAt: occurrence.resolvedAt?.toISOString() ?? null,
    });
  });
}
