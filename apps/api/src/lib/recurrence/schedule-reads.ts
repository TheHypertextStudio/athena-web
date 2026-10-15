import {
  recurrenceSeries,
  recurrenceSeriesRevision,
  recurrenceSeriesWeekday,
  template,
  type Database,
} from '@docket/db';
import { WorkScheduleDetailOut, WorkScheduleOut } from '@docket/work/work-schedule-management';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import { encodeIdCursor, pageResultById, seekAfterId } from '../list-cursor';
import { requireScheduleAccess, type ScheduleAccessRequest } from './schedule-access';
import { scheduleDocumentRoots } from './schedule-compiler';
import { listWorkScheduleRuns, countUnresolvedScheduleRuns } from './schedule-history';
import { nextScheduleRunDate } from './schedule-next-date';
import { loadNextScheduleWorkTitle } from './schedule-next-work';
import { retainedScheduleTemplate } from './schedule-retained-summary';
import { triggerFromStorage } from './series';

/** Return one currently authorized private schedule through the canonical stored cadence. */
export async function loadWorkSchedule(
  database: Database,
  input: ScheduleAccessRequest,
): Promise<WorkScheduleOut> {
  const { series, canEdit } = await requireScheduleAccess(database, input);
  const [revision] = await database
    .select()
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
        eq(recurrenceSeriesRevision.seriesId, series.id),
      ),
    )
    .orderBy(desc(recurrenceSeriesRevision.number))
    .limit(1);
  if (!revision) throw new NotFoundError('Schedule not found');
  const weekdays = await database
    .select({ weekday: recurrenceSeriesWeekday.weekday })
    .from(recurrenceSeriesWeekday)
    .where(eq(recurrenceSeriesWeekday.seriesRevisionId, revision.id));
  const trigger = triggerFromStorage(
    revision,
    weekdays.map((row) => row.weekday),
  );
  const ids = revision.scheduleDraft
    ? scheduleDocumentRoots(revision.scheduleDraft).map((root) => root.draft.template.workTypeId)
    : [];
  const archived = ids.length
    ? await database
        .select({ id: template.id })
        .from(template)
        .where(
          and(
            eq(template.organizationId, input.organizationId),
            inArray(template.id, ids),
            eq(template.publicationState, 'archived'),
          ),
        )
        .limit(1)
    : [];
  const nextRunDate =
    series.status === 'active'
      ? await nextScheduleRunDate(database, input.organizationId, series.id)
      : null;
  return WorkScheduleOut.parse({
    id: series.id,
    organizationId: series.organizationId,
    ownerProgramId: series.ownerProgramId,
    name: series.name,
    status: series.status,
    canEdit,
    templateArchived: archived.length > 0,
    retainedTemplate: await retainedScheduleTemplate(database, input.organizationId, revision),
    nextRunDate,
    nextWorkTitle: await loadNextScheduleWorkTitle(database, input, nextRunDate),
    failedRunCount: await countUnresolvedScheduleRuns(database, input),
    revision: {
      id: revision.id,
      number: revision.number,
      effectiveFrom: revision.effectiveFrom,
      document: revision.scheduleDraft,
      trigger,
      createdAt: revision.createdAt.toISOString(),
    },
    createdAt: series.createdAt.toISOString(),
    updatedAt: series.updatedAt.toISOString(),
    pausedAt: series.pausedAt?.toISOString() ?? null,
    endedAt: series.endedAt?.toISOString() ?? null,
  });
}
/** Current private schedule with a bounded first page of durable history. */
export async function loadWorkScheduleDetail(
  database: Database,
  input: ScheduleAccessRequest,
): Promise<WorkScheduleDetailOut> {
  const schedule = await loadWorkSchedule(database, input);
  const runs = await listWorkScheduleRuns(database, input, { limit: 50 });
  return WorkScheduleDetailOut.parse({ ...schedule, runs });
}
async function visibleSchedule(
  database: Database,
  input: ScheduleAccessRequest,
): Promise<WorkScheduleOut | null> {
  try {
    return await loadWorkSchedule(database, input);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}
/** Visibility-filtered ascending pages never expose an inaccessible schedule's pagination key. */
export async function listWorkSchedules(
  database: Database,
  input: Omit<ScheduleAccessRequest, 'seriesId'> & {
    readonly ownerProgramId?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit: number;
  },
): Promise<{ items: WorkScheduleOut[]; nextCursor?: string }> {
  const visible: WorkScheduleOut[] = [];
  let cursor = input.cursor;
  while (visible.length <= input.limit) {
    const rows = await database
      .select({ id: recurrenceSeries.id })
      .from(recurrenceSeries)
      .where(
        and(
          eq(recurrenceSeries.organizationId, input.organizationId),
          isNull(recurrenceSeries.archivedAt),
          input.ownerProgramId
            ? eq(recurrenceSeries.ownerProgramId, input.ownerProgramId)
            : undefined,
          seekAfterId(recurrenceSeries.id, cursor, 'asc'),
        ),
      )
      .orderBy(asc(recurrenceSeries.id))
      .limit(100);
    for (const row of rows) {
      const schedule = await visibleSchedule(database, { ...input, seriesId: row.id });
      if (schedule) visible.push(schedule);
      if (visible.length > input.limit) break;
    }
    if (rows.length < 100) break;
    const last = rows.at(-1);
    if (!last || visible.length > input.limit) break;
    // Advance over the whole scanned page internally; only visible rows define the public cursor.
    cursor = encodeIdCursor(last.id);
  }
  return pageResultById(visible, input.limit);
}
