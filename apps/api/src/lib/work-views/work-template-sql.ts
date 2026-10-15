import { compileAuthorizationSql } from './authorization-sql';
import { sql, type SQL } from 'drizzle-orm';
import { ENTITY_DISPLAY_SUBJECTS } from '@docket/work/entity-display-contract';
import { VOCABULARY_PRESETS } from '@docket/work/vocabulary';
import type { ViewTarget } from '@docket/work/view-contract';

/** Resolve a base label from current vocabulary without changing its immutable snapshot. */
export function workTemplateNameSql(target: ViewTarget): SQL {
  const presetCases = Object.entries(VOCABULARY_PRESETS).map(
    ([preset, terms]) => sql`when ${preset} then ${terms[target].singular.toLowerCase()}`,
  );
  return sql`case when wt.is_base then 'Blank ' || lower(coalesce(
    org.vocabulary->'overrides'->${target}->>'singular',
    case org.vocabulary->>'preset' ${sql.join(presetCases, sql` `)} else ${target} end
  )) else published.definition->>'name' end`;
}

/** Resolve a base glyph from the kind display registry and other glyphs from publication. */
export function workTemplateIconSql(target: ViewTarget): SQL {
  return sql`case when wt.is_base then ${JSON.stringify(ENTITY_DISPLAY_SUBJECTS[target].glyph)}::jsonb
    else published.definition->'icon' end`;
}

/** Publication joins shared by grouping, filtering, facets, and bounded row projection. */
export function workTemplatePublicationSql(versionId: SQL): SQL {
  return sql`template wt
    join work_type_version published on published.id=${versionId}
      and published.work_type_id=wt.id and published.organization_id=wt.organization_id
    join organization org on org.id=wt.organization_id`;
}

/** Validate a visible item's template relation against its own workspace and published kind. */
export function workTemplateIdSql(target: ViewTarget): SQL {
  return sql`(select wt.id from ${workTemplatePublicationSql(sql`wt.latest_published_version_id`)}
    where wt.id=e.work_type_id and wt.organization_id=e.organization_id
      and wt.target_type=${target} and wt.scope='organization'
      and wt.publication_state in ('published','archived'))`;
}

/** Label one identity group from the latest publication, never its editable draft. */
export function workTemplateGroupSql(target: ViewTarget): {
  kind: 'scalar';
  key: SQL;
  label: SQL;
} {
  return {
    kind: 'scalar',
    key: workTemplateIdSql(target),
    label: sql`(select ${workTemplateNameSql(target)}
      from ${workTemplatePublicationSql(sql`wt.latest_published_version_id`)}
      where wt.id=e.work_type_id and wt.organization_id=e.organization_id
        and wt.target_type=${target} and wt.scope='organization'
        and wt.publication_state in ('published','archived'))`,
  };
}

/** Project a bounded display from the exact version pinned by the authorized work item. */
export function workTemplateProjectionSql(target: ViewTarget): SQL {
  return sql`e.work_type_id, e.work_type_version_id, e.work_type_assigned_at,
    e.work_type_assignment_source,
    (select json_build_object(
      'id', wt.id, 'name', ${workTemplateNameSql(target)}, 'icon', ${workTemplateIconSql(target)},
      'isBase', wt.is_base, 'archived', wt.publication_state='archived',
      'versionNumber', published.number, 'latestVersionNumber', latest.number
    ) from ${workTemplatePublicationSql(sql`e.work_type_version_id`)}
      join work_type_version latest on latest.id=wt.latest_published_version_id
        and latest.work_type_id=wt.id and latest.organization_id=wt.organization_id
    where wt.id=e.work_type_id and wt.organization_id=e.organization_id
      and wt.target_type=${target} and wt.scope='organization'
      and wt.publication_state in ('published','archived')) as work_template`;
}

/** Offer publications and archives used by authorized work, even when active filters hide every match. */
export function workTemplateFacetCatalogSql(
  target: ViewTarget,
  organizationId: string,
  actorId: string,
  userId: string | null,
): SQL {
  return sql`select wt.id::text key, ${workTemplateNameSql(target)}::text label
    from ${workTemplatePublicationSql(sql`wt.latest_published_version_id`)}
    where wt.organization_id=${organizationId} and wt.target_type=${target}
      and wt.scope='organization' and (wt.publication_state='published' or (
        wt.publication_state='archived' and exists (select 1 from ${sql.raw(target)} e
          where e.work_type_id=wt.id and e.organization_id=wt.organization_id
            and ${compileAuthorizationSql(target, organizationId, actorId, userId)})))`;
}

/** Resolve a group or facet's icon only after its identity is authorized for its workspace. */
export function workTemplateChoiceIconSql(target: ViewTarget, id: SQL, organizationId: SQL): SQL {
  return sql`(select ${workTemplateIconSql(target)}
    from ${workTemplatePublicationSql(sql`wt.latest_published_version_id`)}
    where wt.id=${id} and wt.organization_id=${organizationId}
      and wt.target_type=${target} and wt.scope='organization'
      and wt.publication_state in ('published','archived'))`;
}
