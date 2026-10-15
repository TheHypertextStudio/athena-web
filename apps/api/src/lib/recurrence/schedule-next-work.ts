import { canActor } from '@docket/authz';
import {
  processOccurrence,
  project,
  task,
  recurrenceSeriesRevision,
  type Database,
} from '@docket/db';
import { renderScheduleTitlePattern } from '@docket/work/schedule-title-pattern';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { ScheduleDocument } from './schedule-compiler';
import type { ScheduleAccessRequest } from './schedule-access';

/** Actual upcoming work retains its title; unavailable actual work never becomes a fabricated preview. */
export function nextWorkTitleForDate(
  document: ScheduleDocument | null,
  date: string,
  actual: { readonly title: string | null } | null,
): string | null {
  if (actual) return actual.title;
  if (document?.kind !== 'schedule') return null;
  try {
    return renderScheduleTitlePattern(document.titlePattern, date);
  } catch {
    return null;
  }
}
async function actualUpcomingTitle(
  database: Database,
  input: ScheduleAccessRequest,
  refs: NonNullable<typeof processOccurrence.$inferSelect.blueprintRootRefs>,
): Promise<string | null> {
  const root = refs[0];
  if (!root || refs.length !== 1) return null;
  const visible = await canActor(
    input.actorId,
    'view',
    {
      kind: root.kind,
      id: root.id,
      orgId: input.organizationId,
    },
    database,
  );
  if (!visible.allow) return null;
  if (root.kind === 'project') {
    const [row] = await database
      .select({ title: project.name })
      .from(project)
      .where(
        and(
          eq(project.organizationId, input.organizationId),
          eq(project.id, root.id),
          isNull(project.archivedAt),
        ),
      )
      .limit(1);
    return row?.title ?? null;
  }
  const [row] = await database
    .select({ title: task.title })
    .from(task)
    .where(
      and(
        eq(task.organizationId, input.organizationId),
        eq(task.id, root.id),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  return row?.title ?? null;
}
/** Resolve the next title from authorized actual work, or the saved revision governing that civil date. */
export async function loadNextScheduleWorkTitle(
  database: Database,
  input: ScheduleAccessRequest,
  date: string | null,
): Promise<string | null> {
  if (!date) return null;
  const [occurrence] = await database
    .select({
      status: processOccurrence.status,
      roots: processOccurrence.blueprintRootRefs,
    })
    .from(processOccurrence)
    .where(
      and(
        eq(processOccurrence.organizationId, input.organizationId),
        eq(processOccurrence.seriesId, input.seriesId),
        eq(processOccurrence.scheduledFor, date),
        inArray(processOccurrence.status, ['expected', 'materialized']),
      ),
    )
    .orderBy(asc(processOccurrence.id))
    .limit(1);
  if (occurrence?.status === 'materialized')
    return actualUpcomingTitle(database, input, occurrence.roots ?? []);
  const [revision] = await database
    .select({ document: recurrenceSeriesRevision.scheduleDraft })
    .from(recurrenceSeriesRevision)
    .where(
      and(
        eq(recurrenceSeriesRevision.organizationId, input.organizationId),
        eq(recurrenceSeriesRevision.seriesId, input.seriesId),
        lte(recurrenceSeriesRevision.effectiveFrom, date),
      ),
    )
    .orderBy(desc(recurrenceSeriesRevision.effectiveFrom), desc(recurrenceSeriesRevision.number))
    .limit(1);
  return nextWorkTitleForDate(revision?.document ?? null, date, null);
}
