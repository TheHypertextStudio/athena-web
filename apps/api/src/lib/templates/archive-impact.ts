import {
  actor,
  blueprintInvocation,
  db,
  recurrenceSeries,
  recurrenceSeriesRevision,
  template,
  workTypeVersion,
} from '@docket/db';
import type {
  WorkTemplateArchiveImpact,
  WorkTemplateArchiveImpactQuery,
} from '@docket/work/work-template-contract';
import { and, asc, eq, gt, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NotFoundError } from '../../error';
import { requireTemplateAuthor, type TemplateActor } from './authorization';
import { getWorkTemplate } from './service';
import { archiveAffectedVersions } from './archive-impact-references';
import { nativeScheduleReferences } from './archive-impact-native';
import { requireScheduleAccess } from '../recurrence/schedule-access';

function page(items: { id: string; name: string }[], total: number, offset: number) {
  return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
}
async function requireLiveImpactActor(caller: TemplateActor): Promise<void> {
  const [live] = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.organizationId, caller.orgId),
        eq(actor.id, caller.actorId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!live) throw new NotFoundError('Template not found');
}
async function parentImpact(
  caller: TemplateActor,
  id: string,
  query: WorkTemplateArchiveImpactQuery,
) {
  const references = archiveAffectedVersions(caller.orgId, id);
  const where = and(
    eq(template.organizationId, caller.orgId),
    eq(template.scope, 'organization'),
    eq(template.publicationState, 'published'),
    isNull(template.archivedAt),
    sql`${template.id}<>${id}`,
    eq(workTypeVersion.organizationId, caller.orgId),
    inArray(workTypeVersion.id, references),
  );
  const join = and(
    eq(workTypeVersion.id, template.latestPublishedVersionId),
    eq(workTypeVersion.workTypeId, template.id),
    eq(workTypeVersion.organizationId, caller.orgId),
  );
  const [items, counts] = await Promise.all([
    db
      .select({ id: template.id, name: sql<string>`${workTypeVersion.definition}->>'name'` })
      .from(template)
      .innerJoin(workTypeVersion, join)
      .where(where)
      .orderBy(asc(template.id))
      .limit(query.limit)
      .offset(query.parentOffset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(template)
      .innerJoin(workTypeVersion, join)
      .where(where),
  ]);
  return page(items, counts[0]?.total ?? 0, query.parentOffset);
}
async function scheduleImpact(
  caller: TemplateActor,
  id: string,
  query: WorkTemplateArchiveImpactQuery,
) {
  const newer = alias(recurrenceSeriesRevision, 'newer_impact_revision');
  const references = archiveAffectedVersions(caller.orgId, id);
  const invocationReferences = sql`(${blueprintInvocation.manifest}->>'kind'='published' and (
  exists(select 1 from jsonb_array_elements(${blueprintInvocation.manifest}->'roots') as impact_root(value) where impact_root.value->>'workTypeVersionId' in ${references})
  or exists(select 1 from jsonb_array_elements(${blueprintInvocation.manifest}->'steps') as impact_step(value) where impact_step.value->>'sourceVersionId' in ${references})
 ))`;
  const where = and(
    eq(recurrenceSeries.organizationId, caller.orgId),
    eq(recurrenceSeries.status, 'active'),
    isNull(recurrenceSeries.archivedAt),
    notExists(
      db
        .select({ id: newer.id })
        .from(newer)
        .where(
          and(
            eq(newer.organizationId, caller.orgId),
            eq(newer.seriesId, recurrenceSeries.id),
            gt(newer.number, recurrenceSeriesRevision.number),
          ),
        ),
    ),
    or(
      sql`${recurrenceSeriesRevision.scheduleDraft}->>'kind'='schedule'`,
      inArray(recurrenceSeriesRevision.workTypeVersionId, references),
      invocationReferences,
    ),
  );
  const revisionJoin = and(
    eq(recurrenceSeriesRevision.seriesId, recurrenceSeries.id),
    eq(recurrenceSeriesRevision.organizationId, caller.orgId),
  );
  const invocationJoin = and(
    eq(blueprintInvocation.id, recurrenceSeriesRevision.blueprintInvocationId),
    eq(blueprintInvocation.organizationId, caller.orgId),
  );
  return db.transaction(async (tx) => {
    const items: { id: string; name: string }[] = [];
    let total = 0;
    let cursor: string | undefined;
    for (;;) {
      const candidates = await tx
        .select({ series: recurrenceSeries, revision: recurrenceSeriesRevision })
        .from(recurrenceSeries)
        .innerJoin(recurrenceSeriesRevision, revisionJoin)
        .leftJoin(blueprintInvocation, invocationJoin)
        .where(and(where, cursor ? gt(recurrenceSeries.id, cursor) : undefined))
        .orderBy(asc(recurrenceSeries.id))
        .limit(100);
      for (const candidate of candidates) {
        if (!(await matchingImpactSchedule(tx, caller, candidate, id))) continue;
        if (total >= query.scheduleOffset && items.length < query.limit)
          items.push({ id: candidate.series.id, name: candidate.series.name });
        total++;
      }
      if (candidates.length < 100) break;
      cursor = candidates.at(-1)?.series.id;
    }
    return page(items, total, query.scheduleOffset);
  });
}
async function matchingImpactSchedule(
  tx: Parameters<typeof nativeScheduleReferences>[0],
  caller: TemplateActor,
  candidate: {
    series: typeof recurrenceSeries.$inferSelect;
    revision: typeof recurrenceSeriesRevision.$inferSelect;
  },
  targetId: string,
): Promise<boolean> {
  if (!(await visibleImpactSchedule(tx, caller, candidate.series.id))) return false;
  return (
    candidate.revision.scheduleDraft?.kind !== 'schedule' ||
    (await nativeScheduleReferences(tx, candidate.revision, targetId))
  );
}
async function visibleImpactSchedule(
  tx: Parameters<typeof requireScheduleAccess>[0],
  caller: TemplateActor,
  seriesId: string,
): Promise<boolean> {
  try {
    await requireScheduleAccess(tx, {
      organizationId: caller.orgId,
      actorId: caller.actorId,
      seriesId,
    });
    return true;
  } catch (error) {
    if (error instanceof NotFoundError) return false;
    throw error;
  }
}
/** Read exact current public parents and actual-scope-authorized schedules before explicit archive. */
export async function previewWorkTemplateArchive(
  caller: TemplateActor,
  id: string,
  query: WorkTemplateArchiveImpactQuery,
): Promise<WorkTemplateArchiveImpact> {
  await getWorkTemplate(caller, id);
  await requireTemplateAuthor({ orgId: caller.orgId, actorId: caller.actorId });
  await requireLiveImpactActor(caller);
  const [parents, schedules] = await Promise.all([
    parentImpact(caller, id, query),
    scheduleImpact(caller, id, query),
  ]);
  return { parents, schedules };
}
