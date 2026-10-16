import { sql } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { BlueprintStep } from '@docket/work/work-template-blueprint';
import { PlanDocument } from '@docket/work/plan-draft-contract';
import { ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import type { CopyStorageFixture } from './work-template-copy';

/** Exact live private plan selection, with the full existing node contract. */
export function copyReferencePlan(
  targetId: string,
  versionId: string | null,
  kind: 'task' | 'project' | 'initiative' | 'program' = 'task',
): PlanDocument {
  return PlanDocument.parse({
    nodes: [
      {
        ref: 'selected',
        kind,
        parentRef: null,
        initiativeRefs: [],
        initiativeIds: [],
        fields: { title: 'Private work' },
        templateId: targetId,
        ...(versionId ? { workTypeVersionId: versionId } : {}),
        status: 'draft',
        objectId: null,
      },
    ],
    edges: [],
  });
}
/** Exact live composer selection, with no fabricated actual publication. */
export function copyReferenceComposer(
  targetId: string,
  versionId: string | null,
  kind: 'task' | 'project' | 'initiative' | 'program' = 'task',
): ComposerDraftPayload {
  return ComposerDraftPayload.parse({ kind, workTypeId: targetId, workTypeVersionId: versionId });
}
/** Canonical private definition with an exact pending Task pin, optionally through a Program default. */
export function copyReferenceDefinition(
  f: CopyStorageFixture,
  defaults = false,
): WorkTemplateDefinition {
  const selection = { kind: 'pinned', workTypeVersionId: f.reservedId };
  const reference = { workTypeId: f.destinationId, selection };
  const step = BlueprintStep.parse({
    key: 'child',
    kind: 'task',
    parentStepKey: null,
    sort: 0,
    fields: { title: 'Child' },
    optional: { enabled: false, selectedByDefault: true },
    template: reference,
    teamRule: 'none',
    actorRule: 'unassigned',
    cycleRule: 'none',
    dates: {},
  });
  return WorkTemplateDefinition.parse({
    name: 'Private referencing body',
    payload: { targetType: defaults ? 'program' : 'task' },
    ...(defaults
      ? {
          defaultSchedules: [
            {
              key: 'routine',
              name: 'Private routine',
              template: { ...reference, targetType: 'task' },
              titlePattern: 'Routine',
              cadence: { kind: 'daily', interval: 1 },
              teamRule: 'none',
              actorRule: 'unassigned',
            },
          ],
        }
      : { blueprint: { steps: [step], dependencies: [] } }),
  });
}
/** Insert through the existing canonical schema; the new SQL reference writer must participate. */
export async function insertCopyReferencingDefinition(
  database: Database,
  f: CopyStorageFixture,
  defaults = false,
): Promise<string> {
  const id = genId(),
    definition = copyReferenceDefinition(f, defaults);
  await database.execute(
    sql`insert into template(id,organization_id,created_by,target_type,name,scope,owner_actor_id,payload,draft_definition) values(${id},${f.organizationId},${f.actorId},${defaults ? 'program' : 'task'},${definition.name},'personal',${f.actorId},${JSON.stringify(definition.payload)}::jsonb,${JSON.stringify(definition)}::jsonb)`,
  );
  return id;
}
