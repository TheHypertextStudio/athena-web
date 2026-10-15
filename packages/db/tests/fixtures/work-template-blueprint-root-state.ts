import assert from 'node:assert/strict';
import { BlueprintState } from '@docket/work/work-template-blueprint';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { persistBlueprintProjection } from '../../src/work-template-blueprint-projection';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

type Workspace = Pick<BlueprintRetainedFixture, 'organizationId' | 'actorId'>;

async function publishDefinition(
  database: Database,
  workspace: Workspace,
  definition: WorkTemplateDefinition,
) {
  const workTypeId = genId();
  const versionId = genId();
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`insert into template(id,organization_id,target_type,name,scope,owner_actor_id,payload,draft_definition,publication_state) values(${workTypeId},${workspace.organizationId},${definition.payload.targetType},${definition.name},'organization',${workspace.actorId},${JSON.stringify(definition.payload)}::jsonb,${JSON.stringify(definition)}::jsonb,'draft')`,
    );
    await tx.execute(
      sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${versionId},${workspace.organizationId},${workTypeId},1,${JSON.stringify(definition)}::jsonb)`,
    );
    const ids = await persistBlueprintProjection(tx, {
      organizationId: workspace.organizationId,
      versionId,
      blueprint: definition.blueprint,
    });
    assert.equal(Object.keys(ids).length, definition.blueprint.steps.length);
    await tx.execute(
      sql`update template set publication_state='published',latest_published_version_id=${versionId} where id=${workTypeId}`,
    );
  });
  return { workTypeId, versionId };
}

/** Insert and update a real root with populated exact resolutions, choices, and a persisted receipt. */
export async function exerciseBlueprintRootState(
  database: Database,
  workspace: Workspace,
): Promise<void> {
  const versions = await migrationRows<{ id: string; work_type_id: string; target_type: string }>(
    database,
    sql`select v.id,v.work_type_id,t.target_type from work_type_version v join template t on t.id=v.work_type_id where t.organization_id=${workspace.organizationId} and t.is_base and t.target_type in('project','task')`,
  );
  const child = versions.find((row) => row.target_type === 'task');
  assert.ok(child);
  const root = await publishDefinition(
    database,
    workspace,
    WorkTemplateDefinition.parse({
      name: 'Root metadata template',
      payload: { targetType: 'project' },
      blueprint: {
        dependencies: [],
        steps: [
          {
            key: 'prepare',
            kind: 'task',
            parentStepKey: null,
            sort: 0,
            template: null,
            fields: { title: 'Prepare' },
            dates: {},
            optional: { enabled: true, selectedByDefault: true },
            teamRule: 'creation_team',
            actorRule: 'creator',
            cycleRule: 'none',
          },
        ],
      },
    }),
  );
  const rootId = genId();
  const receiptId = genId();
  const state = BlueprintState.parse({
    revision: 0,
    generationKey: rootId,
    resolvedManifest: [
      { path: [], workTypeId: root.workTypeId, versionId: root.versionId },
      { path: ['prepare'], workTypeId: child.work_type_id, versionId: child.id },
    ],
    optionalChoices: [{ path: ['prepare'], selected: true }],
    creationTimezone: 'America/Los_Angeles',
    workingWeekdays: [1, 2, 3, 4, 5],
    lastApplicationChangeSetId: null,
  });
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`insert into project(id,organization_id,name,status,status_id,work_type_id,work_type_version_id,blueprint_path,blueprint_state) select ${rootId},${workspace.organizationId},'Root metadata regression','planned',id,${root.workTypeId},${root.versionId},ARRAY[]::text[],${JSON.stringify(state)}::jsonb from work_status where organization_id=${workspace.organizationId} and entity_type='project' and key='planned'`,
    );
    await tx.execute(
      sql`insert into change_set(id,organization_id,actor_id,origin,summary) values(${receiptId},${workspace.organizationId},${workspace.actorId},'{"channel":"app","surface":"detail"}'::jsonb,'Created root with its blueprint')`,
    );
    await tx.execute(
      sql`update project set blueprint_state=${JSON.stringify({ ...state, revision: 1, lastApplicationChangeSetId: receiptId })}::jsonb where id=${rootId}`,
    );
  });
  const [saved] = await migrationRows<{ blueprint_state: unknown }>(
    database,
    sql`select blueprint_state from project where id=${rootId}`,
  );
  assert.deepEqual(saved?.blueprint_state, {
    ...state,
    revision: 1,
    lastApplicationChangeSetId: receiptId,
  });
}

/** Commit canonical Task state/effort and Project priority fields through the actual SQL projection guard. */
export async function exerciseBlueprintCanonicalFields(
  database: Database,
  workspace: Workspace,
): Promise<void> {
  const shared = {
    parentStepKey: null,
    sort: 0,
    optional: { enabled: false, selectedByDefault: true },
    template: null,
    teamRule: 'creation_team',
    actorRule: 'unassigned',
    dates: {},
  };
  const definition = WorkTemplateDefinition.parse({
    name: 'Canonical field contract',
    payload: { targetType: 'program' },
    blueprint: {
      dependencies: [],
      steps: [
        {
          ...shared,
          key: 'prepare',
          kind: 'task',
          cycleRule: 'none',
          fields: {
            title: 'Prepare',
            summary: 'Starting summary',
            state: 'in_progress',
            priority: 'high',
            estimate: 3,
            estimateMinutes: null,
          },
        },
        {
          ...shared,
          key: 'event',
          kind: 'project',
          fields: {
            name: 'Event',
            summary: 'Project summary',
            status: 'planned',
            priority: 'medium',
            health: 'on_track',
          },
        },
      ],
    },
  });
  const { versionId } = await publishDefinition(database, workspace, definition);
  const steps = await migrationRows<{ step: unknown }>(
    database,
    sql`select step from blueprint_step where version_id=${versionId} order by key`,
  );
  assert.deepEqual(
    steps.map((row) => row.step),
    [...definition.blueprint.steps].sort((a, b) => a.key.localeCompare(b.key)),
  );
}
