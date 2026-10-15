import { canActor } from '@docket/authz';
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

function affectedVersions(orgId: string, id: string) {
  return sql`(with recursive affected(version_id,work_type_id) as (
  select v.id,v.work_type_id from work_type_version v where v.organization_id=${orgId} and v.work_type_id=${id}
  union
  select parent_version.id,parent_version.work_type_id
  from blueprint_step source_step
  join work_type_version parent_version on parent_version.id=source_step.version_id and parent_version.organization_id=${orgId}
  join template child_template on child_template.id=source_step.step->'template'->>'workTypeId' and child_template.organization_id=${orgId}
  join affected child_version on child_version.work_type_id=child_template.id and child_version.version_id=case
   when source_step.step->'template'->'selection'->>'kind'='pinned' then source_step.step->'template'->'selection'->>'workTypeVersionId'
   else child_template.latest_published_version_id end
  where source_step.organization_id=${orgId}
 ) select version_id from affected)`;
}
function page(items: { id: string; name: string }[], total: number, offset: number) {
  return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
}
async function mayReadAllSchedules(caller: TemplateActor): Promise<boolean> {
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
  return (
    await canActor(
      caller.actorId,
      'manage',
      { kind: 'organization', id: caller.orgId, orgId: caller.orgId },
      db,
    )
  ).allow;
}
async function parentImpact(
  caller: TemplateActor,
  id: string,
  query: WorkTemplateArchiveImpactQuery,
) {
  const references = affectedVersions(caller.orgId, id);
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
  manage: boolean,
) {
  const newer = alias(recurrenceSeriesRevision, 'newer_impact_revision');
  const references = affectedVersions(caller.orgId, id);
  const invocationReferences = sql`(${blueprintInvocation.manifest}->>'kind'='published' and (
  exists(select 1 from jsonb_array_elements(${blueprintInvocation.manifest}->'roots') as impact_root(value) where impact_root.value->>'workTypeVersionId' in ${references})
  or exists(select 1 from jsonb_array_elements(${blueprintInvocation.manifest}->'steps') as impact_step(value) where impact_step.value->>'sourceVersionId' in ${references})
 ))`;
  const where = and(
    eq(recurrenceSeries.organizationId, caller.orgId),
    eq(recurrenceSeries.status, 'active'),
    isNull(recurrenceSeries.archivedAt),
    manage ? undefined : eq(recurrenceSeries.createdBy, caller.actorId),
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
    or(inArray(recurrenceSeriesRevision.workTypeVersionId, references), invocationReferences),
  );
  const revisionJoin = and(
    eq(recurrenceSeriesRevision.seriesId, recurrenceSeries.id),
    eq(recurrenceSeriesRevision.organizationId, caller.orgId),
  );
  const invocationJoin = and(
    eq(blueprintInvocation.id, recurrenceSeriesRevision.blueprintInvocationId),
    eq(blueprintInvocation.organizationId, caller.orgId),
  );
  const [items, counts] = await Promise.all([
    db
      .select({ id: recurrenceSeries.id, name: recurrenceSeries.name })
      .from(recurrenceSeries)
      .innerJoin(recurrenceSeriesRevision, revisionJoin)
      .leftJoin(blueprintInvocation, invocationJoin)
      .where(where)
      .orderBy(asc(recurrenceSeries.id))
      .limit(query.limit)
      .offset(query.scheduleOffset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(recurrenceSeries)
      .innerJoin(recurrenceSeriesRevision, revisionJoin)
      .leftJoin(blueprintInvocation, invocationJoin)
      .where(where),
  ]);
  return page(items, counts[0]?.total ?? 0, query.scheduleOffset);
}
/** Read exact current public parents and creator/admin-visible schedules before explicit archive. */
export async function previewWorkTemplateArchive(
  caller: TemplateActor,
  id: string,
  query: WorkTemplateArchiveImpactQuery,
): Promise<WorkTemplateArchiveImpact> {
  await getWorkTemplate(caller, id);
  await requireTemplateAuthor({ orgId: caller.orgId, actorId: caller.actorId });
  const manage = await mayReadAllSchedules(caller);
  const [parents, schedules] = await Promise.all([
    parentImpact(caller, id, query),
    scheduleImpact(caller, id, query, manage),
  ]);
  return { parents, schedules };
}
