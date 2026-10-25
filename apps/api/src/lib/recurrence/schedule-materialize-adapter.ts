import { processOccurrence, recurrenceSeriesRevision, type Database } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { ConflictError } from '../../error';
import { deferWorkCreationEffects } from '../work-creation/effects';
import type { MaterializedOccurrence, MaterializeOccurrenceCommand } from './materialize';
import { moveNativeScheduleOccurrence } from './schedule-native-movement';
import { executeScheduleOccurrence, type ScheduleRunResult } from './schedule-runtime';
import {
  authoredScheduleCompatibilityIdentity,
  privateScheduleCompatibilityProjection,
} from './schedule-private-compatibility';

async function existingProviderOccurrence(
  database: Database,
  command: MaterializeOccurrenceCommand,
) {
  if (!command.externalOccurrenceKey) return null;
  const [row] = await database
    .select()
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, command.organizationId),
        eq(processOccurrence.seriesId, command.seriesId),
        eq(processOccurrence.externalOccurrenceKey, command.externalOccurrenceKey),
      ),
    )
    .limit(1);
  return row ?? null;
}
function compatibilityIdentity(
  result: Pick<ScheduleRunResult, 'occurrenceId' | 'roots'>,
): MaterializedOccurrence {
  const projects: Record<string, string> = {},
    milestones: Record<string, string> = {},
    tasks: Record<string, string> = {};
  for (const root of result.roots) {
    const selected = root.selectedWork ?? [{ path: [], kind: root.kind, id: root.id }];
    for (const work of selected) {
      const key = [root.key, ...work.path].join('/');
      if (work.kind === 'project') projects[key] = work.id;
      else if (work.kind === 'milestone') milestones[key] = work.id;
      else if (work.kind === 'task') tasks[key] = work.id;
    }
  }
  // The durable occurrence is an opaque compatibility alias, never a fabricated SQL instance.
  return {
    occurrenceId: result.occurrenceId,
    instanceId: result.occurrenceId,
    projectIdsByKey: projects,
    milestoneIdsByKey: milestones,
    taskIdsByKey: tasks,
  };
}
function projectedIdentity(
  result: Pick<ScheduleRunResult, 'occurrenceId' | 'roots'>,
  projection: Awaited<ReturnType<typeof privateScheduleCompatibilityProjection>>,
): MaterializedOccurrence {
  return projection
    ? authoredScheduleCompatibilityIdentity(result, projection)
    : compatibilityIdentity(result);
}
/** Dispatch canonical revisions through durable claims while retaining existing provider and caller identities. */
export async function materializeCanonicalSchedule(
  database: Database,
  command: MaterializeOccurrenceCommand,
): Promise<MaterializedOccurrence | null> {
  // A provider identity belongs to its original revision even when its date crosses a future edit.
  const existing = await existingProviderOccurrence(database, command);
  const externalOccurrenceKey = command.externalOccurrenceKey;
  const revisionId = existing?.seriesRevisionId ?? command.seriesRevisionId;
  const [revision] = await database
    .select({
      document: recurrenceSeriesRevision.scheduleDraft,
      invocationId: recurrenceSeriesRevision.blueprintInvocationId,
      revisionId: recurrenceSeriesRevision.processRevisionId,
    })
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.id, revisionId),
        eq(recurrenceSeriesRevision.seriesId, command.seriesId),
        eq(recurrenceSeriesRevision.organizationId, command.organizationId),
      ),
    )
    .limit(1);
  if (!revision?.document) return null;
  const projection = await privateScheduleCompatibilityProjection(database, {
    organizationId: command.organizationId,
    invocationId: revision.invocationId,
    revisionId: revision.revisionId,
  });
  if (existing?.blueprintAppliedAt && externalOccurrenceKey) {
    const effects = await database.transaction((tx) =>
      moveNativeScheduleOccurrence(tx, {
        organizationId: command.organizationId,
        occurrenceId: existing.id,
        scheduledFor: command.scheduledFor,
        externalOccurrenceKey,
        ...(command.originalScheduledFor
          ? { originalScheduledFor: command.originalScheduledFor }
          : {}),
      }),
    );
    deferWorkCreationEffects(effects);
    const result = {
      occurrenceId: existing.id,
      roots: existing.blueprintRootRefs ?? [],
    };
    return projectedIdentity(result, projection);
  }
  const result = await executeScheduleOccurrence(database, {
    organizationId: command.organizationId,
    seriesId: command.seriesId,
    seriesRevisionId: revisionId,
    scheduledFor: command.scheduledFor,
    ...(command.originalScheduledFor ? { originalScheduledFor: command.originalScheduledFor } : {}),
    ...(command.externalOccurrenceKey
      ? { externalOccurrenceKey: command.externalOccurrenceKey }
      : {}),
  });
  if (result.status === 'failed') throw new ConflictError('The scheduled run needs attention');
  return projectedIdentity(result, projection);
}
