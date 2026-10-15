import { sql, type SQL } from 'drizzle-orm';

/** Reverse immutable publication references, including independent reusable Program schedules. */
export function archiveAffectedVersions(orgId: string, id: string): SQL {
  return sql`(with recursive publication_reference(version_id,work_type_id,reference) as (
    select source_step.version_id,parent_version.work_type_id,source_step.step->'template'
      from blueprint_step source_step
      join work_type_version parent_version on parent_version.id=source_step.version_id and parent_version.organization_id=${orgId}
      where source_step.organization_id=${orgId} and source_step.step->'template' is not null
    union all
    select parent_version.id,parent_version.work_type_id,outline.value->'template'
      from work_type_version parent_version
      cross join lateral jsonb_array_elements(coalesce(parent_version.definition->'defaultSchedules','[]'::jsonb)) outline(value)
      where parent_version.organization_id=${orgId}
  ), affected(version_id,work_type_id) as (
    select v.id,v.work_type_id from work_type_version v where v.organization_id=${orgId} and v.work_type_id=${id}
    union
    select reference.version_id,reference.work_type_id from publication_reference reference
      join template child_template on child_template.id=reference.reference->>'workTypeId' and child_template.organization_id=${orgId}
      join affected child_version on child_version.work_type_id=child_template.id and child_version.version_id=case
        when reference.reference->'selection'->>'kind'='pinned' then reference.reference->'selection'->>'workTypeVersionId'
        else child_template.latest_published_version_id end
  ) select version_id from affected)`;
}
