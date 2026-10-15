import { sql } from 'drizzle-orm';
import type { BlueprintInvocationManifest, BlueprintOccurrenceRoot } from '../blueprint-invocation';
import { migrationRows, type BlueprintMigrationConnection } from './query';

async function occurrenceRoots(
  connection: BlueprintMigrationConnection,
  organizationId: string,
  instanceId: string | null,
  manifest: BlueprintInvocationManifest,
): Promise<BlueprintOccurrenceRoot[]> {
  if (!instanceId) return [];
  const refs: BlueprintOccurrenceRoot[] = [];
  for (const source of manifest.roots) {
    const table = source.kind === 'project' ? 'process_instance_project' : 'process_instance_task';
    const column = source.kind === 'project' ? 'project_id' : 'task_id';
    const [mapping] = await migrationRows<{ id: string; organization_id: string }>(
      connection,
      sql`select ${sql.identifier(column)} as id,organization_id from ${sql.identifier(table)} where instance_id=${instanceId} and step_id=${source.sourceStepId}`,
    );
    if (!mapping) continue;
    if (mapping.organization_id !== organizationId)
      throw new Error('Retained root mapping crosses workspace boundaries.');
    refs.push({ key: source.sourceKey, kind: source.kind, id: mapping.id });
  }
  return refs;
}

/** Add canonical selection/pointers while retaining all original cadence, keys and legacy mappings. */
export async function backfillBlueprintRecurrence(
  connection: BlueprintMigrationConnection,
  organizationId: string,
  invocationId: string,
  manifest: BlueprintInvocationManifest,
): Promise<void> {
  const root =
    manifest.kind === 'published' && manifest.roots.length === 1 ? manifest.roots[0] : undefined;
  await connection.execute(
    sql`update recurrence_series_revision set blueprint_invocation_id=${invocationId},work_type_id=${root?.workTypeId ?? null},work_type_version_id=${root?.workTypeVersionId ?? null} where process_revision_id=${manifest.legacyProcessRevisionId} and organization_id=${organizationId} and blueprint_invocation_id is null`,
  );
  const occurrences = await migrationRows<{
    id: string;
    instance_id: string | null;
    organization_id: string;
  }>(
    connection,
    sql`select o.id,i.id as instance_id,o.organization_id from process_occurrence o join recurrence_series_revision r on r.id=o.series_revision_id left join process_instance i on i.occurrence_id=o.id where r.process_revision_id=${manifest.legacyProcessRevisionId}`,
  );
  for (const occurrence of occurrences) {
    if (occurrence.organization_id !== organizationId)
      throw new Error('Retained occurrence crosses workspace boundaries.');
    const refs = await occurrenceRoots(
      connection,
      organizationId,
      occurrence.instance_id,
      manifest,
    );
    await connection.execute(
      sql`update process_occurrence set blueprint_invocation_id=${invocationId},blueprint_root_refs=${JSON.stringify(refs)}::jsonb where id=${occurrence.id} and organization_id=${organizationId} and blueprint_invocation_id is null`,
    );
  }
}
