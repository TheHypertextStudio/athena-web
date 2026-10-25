import {
  processInstance,
  processInstanceTask,
  processInstanceProject,
  readScheduleHistoricalReferences,
  type BlueprintOccurrenceRoot,
  type Database,
} from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';

/** Only the link facts needed by compatibility history; source bodies remain private. */
export interface OccurrenceReferenceRecord {
  readonly id: string;
  readonly native: boolean;
  readonly historical: boolean;
  readonly legacyInstanceId: string | null;
  readonly blueprintAppliedAt: Date | null;
  readonly blueprintRootRefs: readonly BlueprintOccurrenceRoot[] | null;
}
/** Current physical link associated with one occurrence compatibility identity. */
export interface GeneratedOccurrenceReference {
  readonly instanceId: string;
  readonly id: string;
  readonly kind: 'task' | 'project';
}
function navigableReference(
  value: Readonly<Record<string, unknown>>,
  instanceId: string,
): GeneratedOccurrenceReference | null {
  const mapping = value['mapping'],
    selection = value['selection'];
  const mapped = mapping && typeof mapping === 'object' ? (mapping as Record<string, unknown>) : {};
  const selected =
    selection && typeof selection === 'object' ? (selection as Record<string, unknown>) : {};
  const kind = value['kind'] ?? selected['kind'];
  const id = mapped['task_id'] ?? mapped['project_id'] ?? selected['id'] ?? value['workId'];
  return (kind === 'task' || kind === 'project') && typeof id === 'string'
    ? { instanceId, kind, id }
    : null;
}
async function historicalReferences(
  database: Database,
  organizationId: string,
  row: OccurrenceReferenceRecord,
  instanceId: string,
): Promise<GeneratedOccurrenceReference[]> {
  const references: GeneratedOccurrenceReference[] = [];
  let offset = 0;
  for (;;) {
    const page = await readScheduleHistoricalReferences(database, {
      organizationId,
      occurrenceId: row.id,
      offset,
    });
    for (const value of page.references) {
      const reference = navigableReference(value, instanceId);
      if (reference) references.push(reference);
    }
    if (page.nextOffset === null) return references;
    offset = page.nextOffset;
  }
}
async function retainedReferences(
  database: Database,
  organizationId: string,
  ids: readonly string[],
): Promise<GeneratedOccurrenceReference[]> {
  if (!ids.length) return [];
  const [tasks, projects] = await Promise.all([
    database
      .select({ instanceId: processInstanceTask.instanceId, id: processInstanceTask.taskId })
      .from(processInstanceTask)
      .where(
        and(
          eq(processInstanceTask.organizationId, organizationId),
          inArray(processInstanceTask.instanceId, ids),
        ),
      ),
    database
      .select({
        instanceId: processInstanceProject.instanceId,
        id: processInstanceProject.projectId,
      })
      .from(processInstanceProject)
      .where(
        and(
          eq(processInstanceProject.organizationId, organizationId),
          inArray(processInstanceProject.instanceId, ids),
        ),
      ),
  ]);
  return [
    ...tasks.map((row) => ({ ...row, kind: 'task' as const })),
    ...projects.map((row) => ({ ...row, kind: 'project' as const })),
  ];
}
function nativeReferences(
  row: OccurrenceReferenceRecord,
  instanceId: string,
): GeneratedOccurrenceReference[] {
  const references: GeneratedOccurrenceReference[] = [];
  for (const root of row.blueprintRootRefs ?? [])
    for (const work of root.selectedWork ?? [root])
      if (work.kind === 'task' || work.kind === 'project')
        references.push({ instanceId, kind: work.kind, id: work.id });
  return references;
}
/**
 * Read native actuals and every historical page without touching normalized instance/maps for those runs.
 * Unconverted occurrences retain their existing source lookup until separate registration proves them.
 */
export async function occurrenceReferenceFacts(
  database: Database,
  organizationId: string,
  rows: readonly OccurrenceReferenceRecord[],
): Promise<{
  readonly instances: ReadonlyMap<string, string>;
  readonly references: readonly GeneratedOccurrenceReference[];
}> {
  const legacyIds = rows.filter((row) => !row.native && !row.historical).map((row) => row.id);
  const legacy = legacyIds.length
    ? await database
        .select({ occurrenceId: processInstance.occurrenceId, id: processInstance.id })
        .from(processInstance)
        .where(
          and(
            eq(processInstance.organizationId, organizationId),
            inArray(processInstance.occurrenceId, legacyIds),
          ),
        )
    : [];
  const instances = new Map(
    legacy.flatMap((row) => (row.occurrenceId ? [[row.occurrenceId, row.id] as const] : [])),
  );
  const references = await retainedReferences(
    database,
    organizationId,
    legacy.map((row) => row.id),
  );
  for (const row of rows) {
    if (!row.native && !row.historical) continue;
    const instanceId = row.legacyInstanceId ?? (row.blueprintAppliedAt ? row.id : null);
    if (!instanceId) continue;
    instances.set(row.id, instanceId);
    if (row.historical)
      references.push(...(await historicalReferences(database, organizationId, row, instanceId)));
    else references.push(...nativeReferences(row, instanceId));
  }
  return { instances, references };
}
