import { sql, type SQL } from 'drizzle-orm';
import type { GroupFieldCompiler } from './group-sql';
import type { ScalarFilterCompiler } from './filter-sql';
import { tenantScalarRelationFilter, WORK_VIEW_SCALAR_RELATIONS } from './relation-sql';

interface PersonField {
  subjectType: 'task' | 'project';
  field: 'assignee' | 'lead';
  column: 'assignee_id' | 'lead_id';
}

function activeSources(person: PersonField): SQL {
  return sql`select ea.id, coalesce(canonical_person.display_name, ea.display_name) as display_name from source_person_reference sp
    join external_actor ea on ea.id=sp.external_actor_id and ea.organization_id=e.organization_id
    left join actor canonical_person on canonical_person.id=ea.actor_id and canonical_person.organization_id=e.organization_id
    where sp.organization_id=e.organization_id and sp.subject_type=${person.subjectType}
      and sp.subject_id=e.id and sp.field=${person.field} and sp.detached_at is null`;
}

/** Distinguish genuinely empty person fields from imported assignments awaiting resolution. */
export function sourceAwarePersonFilter(person: PersonField): ScalarFilterCompiler {
  const base = tenantScalarRelationFilter(
    WORK_VIEW_SCALAR_RELATIONS.actor,
    sql`e.${sql.raw(person.column)}`,
  );
  return {
    ...base,
    isEmpty: sql`((${base.value}) is null and not exists (${activeSources(person)}))`,
  };
}

/** Group source-only people under explicit, non-actor provenance keys instead of Unassigned. */
export function sourceAwarePersonGroup(person: PersonField): GroupFieldCompiler {
  return {
    kind: 'fanout',
    memberships: () => sql`select a.id::text as key, a.display_name::text as label
      from actor a where a.id=e.${sql.raw(person.column)} and a.organization_id=e.organization_id
      union all
      select ('source-person:' || source.id)::text as key, source.display_name::text as label
      from (${activeSources(person)}) source
      where not exists (select 1 from actor a where a.id=e.${sql.raw(person.column)} and a.organization_id=e.organization_id)`,
  };
}
