import { processOccurrence, recurrenceSeries, type Database } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { GeneratedWorkRecurrenceOut } from '../../contracts/recurrence';
import { ApiError } from '../../error';
import { findNativeScheduleOccurrence } from './schedule-native-facts';
import { requireScheduleAccess } from './schedule-access';
import { loadCreationActor } from '../work-creation/context';
import { loadBlueprintSnapshot } from '../work-template-blueprints/snapshot';
import type { z } from 'zod';

/** Private, current-visibility backlink for an actual native root or generated descendant. */
export async function loadNativeGeneratedWorkRecurrence(
  database: Database,
  input: {
    readonly organizationId: string;
    readonly actorId?: string;
    readonly kind: 'task' | 'project';
    readonly id: string;
  },
): Promise<z.input<typeof GeneratedWorkRecurrenceOut> | null> {
  const actorId = input.actorId;
  if (!actorId) return null;
  const occurrenceId = await findNativeScheduleOccurrence(database, input.organizationId, input);
  if (!occurrenceId) return null;
  try {
    return await database.transaction(async (tx) => {
      const [row] = await tx
        .select({ occurrence: processOccurrence, series: recurrenceSeries })
        .from(processOccurrence)
        .innerJoin(
          recurrenceSeries,
          and(
            eq(recurrenceSeries.id, processOccurrence.seriesId),
            eq(recurrenceSeries.organizationId, input.organizationId),
          ),
        )
        .where(
          and(
            eq(processOccurrence.id, occurrenceId),
            eq(processOccurrence.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!row) return null;
      await requireScheduleAccess(tx, {
        organizationId: input.organizationId,
        actorId: actorId,
        seriesId: row.series.id,
      });
      const caller = await loadCreationActor(tx, input.organizationId, actorId);
      await loadBlueprintSnapshot(tx, caller, input, { scope: 'reference', access: 'view' });
      return GeneratedWorkRecurrenceOut.parse({
        kind: input.kind,
        ...(input.kind === 'task' ? { taskId: input.id } : { projectId: input.id }),
        seriesId: row.series.id,
        seriesName: row.series.name,
        seriesStatus: row.series.status,
        // Native compatibility aliases identify canonical records; no legacy instance is synthesized.
        processDefinitionId: row.series.definitionId ?? row.series.id,
        processInstanceId: row.occurrence.legacyInstanceId ?? row.occurrence.id,
        occurrenceId: row.occurrence.id,
        scheduledFor: row.occurrence.scheduledFor,
        occurrenceStatus: row.occurrence.status,
      });
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}
