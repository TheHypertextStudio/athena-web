import { sql } from 'drizzle-orm';
import {
  migrationRows,
  type BlueprintMigrationConnection,
} from './work-template-blueprint-migration/query';

/** Recover immutable selected identities even when work deletion already removed its old mapping row. */
export async function archiveHistoricalSelections(
  connection: BlueprintMigrationConnection,
  occurrenceId: string | null,
  references: readonly Readonly<Record<string, unknown>>[],
): Promise<Readonly<Record<string, unknown>>[]> {
  if (!occurrenceId) return [];
  const rows = await migrationRows<{ entry: Record<string, unknown> }>(
    connection,
    sql`
    select jsonb_build_object('selection',selected.value,'rootKey',root.value->>'key','deleted',
      case selected.value->>'kind'
      when 'task' then not exists(select 1 from task where id=selected.value->>'id' and organization_id=o.organization_id)
      when 'project' then not exists(select 1 from project where id=selected.value->>'id' and organization_id=o.organization_id)
      when 'milestone' then not exists(select 1 from milestone where id=selected.value->>'id' and organization_id=o.organization_id)
      when 'program' then not exists(select 1 from program where id=selected.value->>'id' and organization_id=o.organization_id)
      else true end) as entry from process_occurrence o
    cross join lateral jsonb_array_elements(coalesce(o.blueprint_root_refs,'[]'::jsonb)) root(value)
    cross join lateral jsonb_array_elements(coalesce(root.value->'selectedWork',jsonb_build_array(jsonb_build_object('path','[]'::jsonb,'kind',root.value->>'kind','id',root.value->>'id')))) selected(value)
    where o.id=${occurrenceId} order by root.value->>'key',selected.value->'path'`,
  );
  const ids = new Set(
    references.map((reference) => {
      const mapping = reference['mapping'] as Record<string, unknown>;
      return `${String(reference['kind'])}:${String(mapping['task_id'] ?? mapping['project_id'] ?? mapping['milestone_id'])}`;
    }),
  );
  return rows
    .map((row) => row.entry)
    .filter((entry) => {
      const selection = entry['selection'] as Record<string, unknown>;
      return !ids.has(`${String(selection['kind'])}:${String(selection['id'])}`);
    });
}

/** Detect source mapping edits after a committed archive batch without discarding retained tombstones. */
export async function verifyHistoricalMappingArchives(
  connection: BlueprintMigrationConnection,
): Promise<void> {
  const rows = await migrationRows<{ id: string }>(
    connection,
    sql`
    with current_maps as (
      select instance_id,organization_id,jsonb_build_object('kind','task','mapping',to_jsonb(m)) as entry from process_instance_task m
      union all select instance_id,organization_id,jsonb_build_object('kind','project','mapping',to_jsonb(m)) from process_instance_project m
      union all select instance_id,organization_id,jsonb_build_object('kind','milestone','mapping',to_jsonb(m)) from process_instance_milestone m
    ) select i.id from process_instance i join process_occurrence o on o.legacy_instance_id=i.id and o.organization_id=i.organization_id
    where coalesce((select jsonb_agg(m.entry order by m.entry::text) from current_maps m where m.instance_id=i.id and m.organization_id=i.organization_id),'[]'::jsonb)
      is distinct from coalesce((select jsonb_agg(jsonb_build_object('kind',e.value->>'kind','mapping',e.value->'mapping') order by jsonb_build_object('kind',e.value->>'kind','mapping',e.value->'mapping')::text) from jsonb_array_elements(o.historical_archive->'references') e(value) where e.value ? 'mapping'),'[]'::jsonb)
    limit 1`,
  );
  if (rows.length) throw new Error('Historical instance mappings changed after archival.');
}
