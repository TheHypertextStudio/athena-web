import { sql } from 'drizzle-orm';
import type { BlueprintInvocationManifest, BlueprintInvocationStep } from '../blueprint-invocation';
import type { ConvertedDefinition } from './contracts';
import { migrationRows, type BlueprintMigrationConnection } from './query';

interface MappedWork {
  readonly instance_id: string;
  readonly step_id: string;
  readonly work_id: string;
  readonly organization_id: string;
  readonly kind: 'project' | 'milestone' | 'task';
}

async function mappedWork(
  connection: BlueprintMigrationConnection,
  revisionId: string,
): Promise<MappedWork[]> {
  return migrationRows<MappedWork>(
    connection,
    sql`
    select m.instance_id,m.step_id,m.project_id as work_id,m.organization_id,'project'::text as kind from process_instance_project m join process_instance i on i.id=m.instance_id where i.revision_id=${revisionId}
    union all select m.instance_id,m.step_id,m.milestone_id,m.organization_id,'milestone' from process_instance_milestone m join process_instance i on i.id=m.instance_id where i.revision_id=${revisionId}
    union all select m.instance_id,m.step_id,m.task_id,m.organization_id,'task' from process_instance_task m join process_instance i on i.id=m.instance_id where i.revision_id=${revisionId}`,
  );
}

function parentMapping(
  source: BlueprintInvocationStep,
  manifest: BlueprintInvocationManifest,
  rows: readonly MappedWork[],
  instanceId: string,
): MappedWork | undefined {
  const path = source.path.slice(0, -1);
  const parent = manifest.steps.find(
    (step) => step.rootKey === source.rootKey && JSON.stringify(step.path) === JSON.stringify(path),
  );
  return rows.find((row) => row.instance_id === instanceId && row.step_id === parent?.sourceStepId);
}

async function stampGeneratedWork(
  connection: BlueprintMigrationConnection,
  row: MappedWork,
  source: BlueprintInvocationStep,
  parent: MappedWork | undefined,
  definition: ConvertedDefinition,
): Promise<void> {
  const fields =
    row.kind === 'task'
      ? { startDate: 'start_date', dueDate: 'due_date' }
      : row.kind === 'project'
        ? { startDate: 'start_date', targetDate: 'target_date' }
        : { targetDate: 'target_date' };
  const pairs = Object.values(fields).flatMap((column) => [
    sql`${column}::text`,
    sql.identifier(column),
  ]);
  const [work] = await migrationRows<{ row: Record<string, unknown> }>(
    connection,
    sql`select jsonb_build_object(${sql.join(pairs, sql`,`)}) as row from ${sql.identifier(row.kind)} where id=${row.work_id} and organization_id=${row.organization_id}`,
  );
  const values = work?.row;
  if (!values) throw new Error('Retained concrete mapping crosses workspace boundaries.');
  const step = definition.blueprint.steps.find((step) => step.key === source.path.at(-1));
  if (!step) throw new Error('Retained source projection is missing.');
  const bindings = conservativeBindings(fields, values, step, source);
  await connection.execute(
    sql`update ${sql.identifier(row.kind)} set blueprint_step_id=${source.blueprintStepId},blueprint_source_version_id=${source.sourceVersionId},blueprint_parent_kind=${parent?.kind ?? null},blueprint_parent_id=${parent?.work_id ?? null},blueprint_path=ARRAY(select jsonb_array_elements_text(${JSON.stringify(source.path)}::jsonb)),blueprint_date_bindings=${JSON.stringify(bindings)}::jsonb where id=${row.work_id} and organization_id=${row.organization_id} and blueprint_step_id is null`,
  );
}

/** Add only proven origin metadata; authored identity, placement, bodies, dates and audits stay intact. */
export async function backfillGeneratedBlueprintWork(
  connection: BlueprintMigrationConnection,
  organizationId: string,
  manifest: BlueprintInvocationManifest,
  projections: ReadonlyMap<
    string,
    { ids: Readonly<Record<string, string>>; versionId: string; definition: ConvertedDefinition }
  >,
): Promise<void> {
  const rows = await mappedWork(connection, manifest.legacyProcessRevisionId);
  if (rows.some((row) => row.organization_id !== organizationId))
    throw new Error('Retained concrete mappings cross workspace boundaries.');
  for (const row of rows) {
    const source = manifest.steps.find((step) => step.sourceStepId === row.step_id);
    if (!source) throw new Error('Retained concrete mapping has no source step.');
    const projection = projections.get(
      manifest.roots.find((root) => root.key === source.rootKey)?.sourceStepId ?? '',
    );
    if (source.blueprintStepId && projection)
      await stampGeneratedWork(
        connection,
        row,
        source,
        parentMapping(source, manifest, rows, row.instance_id),
        projection.definition,
      );
  }
}

function conservativeBindings(
  fields: Readonly<Record<string, string>>,
  values: Readonly<Record<string, unknown>>,
  step: ConvertedDefinition['blueprint']['steps'][number],
  source: BlueprintInvocationStep,
): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(fields)) {
    const date = values[column];
    const rule = step.dates[field];
    if (!rule && date === null) continue;
    bindings[field] = {
      sourceStepId: source.blueprintStepId,
      sourceVersionId: source.sourceVersionId,
      rule: rule ?? { kind: 'none' },
      manual: date !== null,
      lastDerivedDate: null,
    };
  }
  return bindings;
}
