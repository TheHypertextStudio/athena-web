import type { Database } from '@docket/db';
import type {
  WorkScheduleRunOut,
  WorkScheduleRunRequest,
} from '@docket/work/work-schedule-management';
import { ConflictError } from '../../error';
import { requireScheduleAccess, type ScheduleAccessRequest } from './schedule-access';
import { loadWorkScheduleRun } from './schedule-history';
import { executeScheduleOccurrence, retryScheduleOccurrence } from './schedule-runtime';
import { seriesRevisionAt } from './series';

/** Run checked public work with the governing revision's saved occurrence identity. */
export async function runWorkSchedule(
  database: Database,
  access: ScheduleAccessRequest,
  request: WorkScheduleRunRequest,
): Promise<WorkScheduleRunOut> {
  await requireScheduleAccess(database, access, 'manage');
  const revision = await seriesRevisionAt(
    database,
    access.organizationId,
    access.seriesId,
    request.scheduledFor,
  );
  if (request.occurrenceKey && ['calendar', 'after_completion'].includes(revision.triggerKind))
    throw new ConflictError('Calendar and completion runs use their saved date identity');
  const result = await executeScheduleOccurrence(database, {
    organizationId: access.organizationId,
    seriesId: access.seriesId,
    seriesRevisionId: revision.id,
    scheduledFor: request.scheduledFor,
    ...(request.occurrenceKey ? { externalOccurrenceKey: request.occurrenceKey } : {}),
  });
  return loadWorkScheduleRun(database, access, result.occurrenceId);
}

/** Retry only an authorized run of this schedule, retaining its accepted version closure. */
export async function retryWorkSchedule(
  database: Database,
  access: ScheduleAccessRequest,
  occurrenceId: string,
): Promise<WorkScheduleRunOut> {
  await requireScheduleAccess(database, access, 'manage');
  await loadWorkScheduleRun(database, access, occurrenceId);
  await retryScheduleOccurrence(database, {
    organizationId: access.organizationId,
    occurrenceId,
    actorId: access.actorId,
  });
  return loadWorkScheduleRun(database, access, occurrenceId);
}
