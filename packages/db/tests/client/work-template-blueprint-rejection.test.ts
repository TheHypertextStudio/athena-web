import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';
import { fullSchema, type Database } from '../../src/client';
import { genId } from '../../src/id';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillWorkTemplateBlueprints } from '../../src/work-template-blueprint-backfill';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintRetainedFixture,
} from '../fixtures/work-template-blueprint-migration';
import { requiredRow } from '../fixtures/required-row';
import type { RetainedGraph } from '../../src/work-template-blueprint-migration/contracts';
import { normalizeLegacyBlueprint } from '../../src/work-template-blueprint-migration/normalize';
import { validateRetainedBlueprint } from '../../src/work-template-blueprint-migration/validate';
import { persistBlueprintProjection } from '../../src/work-template-blueprint-projection';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { provisionMigrationBases } from '../../src/work-template-migration/bases';

async function fixtureCase(
  run: (database: Database, fixture: BlueprintRetainedFixture) => Promise<void>,
): Promise<void> {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const fixture = await prepareBlueprintRetainedFixture(database, options);
    await withMigrationPrefix(
      options.migrationsFolder,
      '0154_work_template_blueprints_expand',
      options.applySqlMigrations,
    );
    await run(database, fixture);
  } finally {
    await client.close();
  }
}

it('rejects foreign literal teams before copying source bodies or publishing anything', async () =>
  fixtureCase(async (database, fixture) => {
    const other = genId();
    const team = genId();
    await database.execute(
      sql`insert into organization(id,name,slug) values(${other},'Foreign','foreign-rejection')`,
    );
    await database.execute(
      sql`insert into team(id,organization_id,name,key) values(${team},${other},'Foreign','FOREIGN')`,
    );
    await database.execute(
      sql`update process_task_spec set team_id=${team} where step_id=${fixture.forestTaskStepId}`,
    );
    const before = await migrationRows(database, sql`select id from template`);
    await expect(backfillWorkTemplateBlueprints(database)).rejects.toThrow('foreign team');
    expect(await migrationRows(database, sql`select id from template`)).toEqual(before);
    expect(
      await migrationRows(
        database,
        sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
      ),
    ).toHaveLength(0);
  }));

it('rejects an oversized forest with no truncated invocation or partial publication', async () =>
  fixtureCase(async (database, fixture) => {
    const definitionId = genId();
    const revisionId = '00000000000000000000000001';
    await database.execute(
      sql`insert into process_definition(id,organization_id,name,status) values(${definitionId},${fixture.organizationId},'Oversized source','published')`,
    );
    await database.execute(
      sql`insert into process_revision(id,organization_id,definition_id,number,published_at) values(${revisionId},${fixture.organizationId},${definitionId},1,now())`,
    );
    await database.execute(
      sql`insert into process_step(id,organization_id,revision_id,key,kind) select 's'||lpad(i::text,25,'0'),${fixture.organizationId},${revisionId},'step_'||i,'task' from generate_series(1,501) i`,
    );
    await database.execute(
      sql`insert into process_task_spec(step_id,organization_id,title,team_id) select id,${fixture.organizationId},'Bounded Task',${fixture.teamId} from process_step where revision_id=${revisionId}`,
    );
    const before = await migrationRows(database, sql`select id from template`);
    await expect(backfillWorkTemplateBlueprints(database)).rejects.toThrow('bounded graph limit');
    expect(await migrationRows(database, sql`select id from template`)).toEqual(before);
    expect(
      await migrationRows(database, sql`select id from work_template_blueprint_invocation`),
    ).toHaveLength(0);
  }));

it('keeps an explicit retained Task version pinned and preserves drafts even with stray publication timestamps', async () =>
  fixtureCase(async (database, fixture) => {
    const templateId = genId();
    const versionId = genId();
    const laterVersionId = genId();
    const definition = {
      name: 'Selected Task type',
      description: null,
      icon: null,
      defaultStatusKey: null,
      payload: { targetType: 'task' },
    };
    await database.execute(
      sql`insert into template(id,organization_id,target_type,name,scope,payload,draft_definition,publication_state) values(${templateId},${fixture.organizationId},'task',${definition.name},'organization',${JSON.stringify(definition.payload)}::jsonb,${JSON.stringify(definition)}::jsonb,'draft')`,
    );
    await database.execute(
      sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${versionId},${fixture.organizationId},${templateId},1,${JSON.stringify(definition)}::jsonb),(${laterVersionId},${fixture.organizationId},${templateId},2,${JSON.stringify(definition)}::jsonb)`,
    );
    await database.execute(
      sql`update template set publication_state='published',latest_published_version_id=${laterVersionId} where id=${templateId}`,
    );
    await database.execute(
      sql`update process_task_spec set work_type_id=${templateId},work_type_version_id=${versionId} where step_id in(select id from process_step where revision_id=${fixture.genericRevisionId})`,
    );
    await database.execute(
      sql`update process_revision set published_at=now() where id=${fixture.draftRevisionId}`,
    );
    const before = await migrationRows(database, sql`select id from template`);
    await backfillWorkTemplateBlueprints(database);
    const [selected] = await migrationRows<{
      manifest: { roots: { workTypeId: string; workTypeVersionId: string }[] };
    }>(
      database,
      sql`select i.manifest from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id=${fixture.genericRevisionId}`,
    );
    expect(requiredRow(selected).manifest.roots[0]).toMatchObject({
      workTypeId: templateId,
      workTypeVersionId: versionId,
    });
    const [draft] = await migrationRows<{ manifest: { kind: string } }>(
      database,
      sql`select i.manifest from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id=${fixture.draftRevisionId}`,
    );
    expect(requiredRow(draft).manifest.kind).toBe('pending_draft');
    expect(await migrationRows(database, sql`select id from template`)).toHaveLength(
      before.length + 1,
    );
  }));

it('refuses malformed authorized snapshots before conversion allocates any publication', async () =>
  fixtureCase(async (database, fixture) => {
    const { graph } = requiredRow(
      (
        await migrationRows<{ graph: RetainedGraph }>(
          database,
          sql`select docket_blueprint_retained_source(${fixture.forestRevisionId}) as graph`,
        )
      )[0],
    );
    const before = await migrationRows(database, sql`select id from template order by id`);
    const task = requiredRow(
      graph.tasks.find((row) => row['step_id'] === fixture.forestTaskStepId),
    );
    const project = requiredRow(graph.projects[0]);
    const independent = requiredRow(
      graph.tasks.find(
        (row) => row['project_step_id'] === null && row['parent_task_step_id'] === null,
      ),
    );
    const [base] = await migrationRows<{ id: string }>(
      database,
      sql`select id from template where organization_id=${fixture.organizationId} and target_type='task' and is_base`,
    );
    const changeTask = (fields: Record<string, string | number | null>): RetainedGraph => ({
      ...graph,
      tasks: graph.tasks.map((row) => (row === task ? { ...row, ...fields } : row)),
    });
    const cases: { source: RetainedGraph; message: string }[] = [
      {
        source: { ...graph, definition: { ...graph.definition, organization_id: genId() } },
        message: 'cross workspace',
      },
      {
        source: { ...graph, revision: { ...graph.revision, definition_id: genId() } },
        message: 'does not own',
      },
      {
        source: { ...graph, steps: graph.steps.map((row) => ({ ...row, revision_id: genId() })) },
        message: 'foreign revision',
      },
      {
        source: changeTask({ project_step_id: fixture.forestTaskStepId }),
        message: 'Project reference',
      },
      {
        source: changeTask({ parent_task_step_id: requiredRow(project)['step_id'] ?? null }),
        message: 'parent Task',
      },
      {
        source: changeTask({ milestone_step_id: independent['step_id'] ?? null }),
        message: 'Milestone does not belong',
      },
      ...[36501, 0.5, 'tomorrow'].map((offset) => ({
        source: changeTask({ due_offset_days: offset }),
        message: 'date offset',
      })),
      { source: changeTask({ assignee_id: genId() }), message: 'missing or foreign actor' },
      {
        source: changeTask({ work_type_id: genId(), work_type_version_id: null }),
        message: 'missing or foreign template',
      },
      {
        source: changeTask({ work_type_id: requiredRow(base).id, work_type_version_id: null }),
        message: 'selection is incomplete',
      },
      {
        source: changeTask({ work_type_id: requiredRow(base).id, work_type_version_id: genId() }),
        message: 'wrong-kind template version',
      },
      {
        source: changeTask({ work_type_id: null, work_type_version_id: genId() }),
        message: 'selection is incomplete',
      },
      {
        source: {
          ...graph,
          dependencies: [
            {
              organization_id: fixture.organizationId,
              blocking_step_id: requiredRow(project)['step_id'] ?? null,
              blocked_step_id: fixture.forestTaskStepId,
            },
          ],
        },
        message: 'two Task endpoints',
      },
    ];
    for (const { source, message } of cases)
      await expect(
        validateRetainedBlueprint(database, source, normalizeLegacyBlueprint(source)),
      ).rejects.toThrow(message);
    expect(await migrationRows(database, sql`select id from template order by id`)).toEqual(before);
    expect(
      await migrationRows(database, sql`select id from work_template_blueprint_invocation`),
    ).toEqual([]);
  }));

it('refuses same-workspace literal placements that disagree with their owning team or Project', async () =>
  fixtureCase(async (database, fixture) => {
    const otherTeam = genId();
    const cycle = genId();
    const otherProject = genId();
    await database.execute(
      sql`insert into team(id,organization_id,name,key) values(${otherTeam},${fixture.organizationId},'Other team','OTHER')`,
    );
    await database.execute(
      sql`insert into cycle(id,organization_id,team_id,number,starts_at,ends_at) values(${cycle},${fixture.organizationId},${otherTeam},1,'2026-10-01','2026-10-08')`,
    );
    await database.execute(
      sql`insert into project(id,organization_id,name,status,status_id,work_type_id,work_type_version_id) select ${otherProject},organization_id,'Other Project',status,status_id,work_type_id,work_type_version_id from project where id=${fixture.projectId}`,
    );
    const { graph } = requiredRow(
      (
        await migrationRows<{ graph: RetainedGraph }>(
          database,
          sql`select docket_blueprint_retained_source(${fixture.forestRevisionId}) as graph`,
        )
      )[0],
    );
    for (const [fields, message] of [
      [{ cycle_id: cycle }, 'cycle belongs to another team'],
      [
        { milestone_id: fixture.milestoneId, project_id: otherProject },
        'literal Milestone belongs to another Project',
      ],
    ] as const) {
      const source = {
        ...graph,
        tasks: graph.tasks.map((row) =>
          row['step_id'] === fixture.forestTaskStepId ? { ...row, ...fields } : row,
        ),
      };
      await expect(
        validateRetainedBlueprint(database, source, normalizeLegacyBlueprint(source)),
      ).rejects.toThrow(message);
    }
    expect(
      await migrationRows(
        database,
        sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
      ),
    ).toEqual([]);
  }));

it('refuses inconsistent projections retained before SQL enforcement without accepting or repairing them', async () =>
  fixtureCase(async (database, fixture) => {
    const [base] = await migrationRows<{ id: string }>(
      database,
      sql`select id from template where organization_id=${fixture.organizationId} and target_type='project' and is_base`,
    );
    const definition = WorkTemplateDefinition.parse({
      name: 'Sibling dependencies',
      payload: { targetType: 'project' },
      blueprint: {
        steps: ['a', 'b', 'c'].map((key) => ({
          key,
          kind: 'task',
          parentStepKey: null,
          sort: 0,
          optional: { enabled: false, selectedByDefault: true },
          template: null,
          fields: { title: key },
          teamRule: 'creation_team',
          actorRule: 'unassigned',
          cycleRule: 'none',
          dates: {},
        })),
        dependencies: [{ blockerStepKey: 'a', blockedStepKey: 'b' }],
      },
    });
    for (const [index, fault] of [
      'different-step',
      'unexpected-step',
      'different-edge',
    ].entries()) {
      const versionId = genId();
      await database.execute(
        sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${versionId},${fixture.organizationId},${requiredRow(base).id},${index + 2},${JSON.stringify(definition)}::jsonb)`,
      );
      const ids = Object.fromEntries(['a', 'b', 'c'].map((key) => [key, genId()]));
      for (const original of definition.blueprint.steps) {
        const step =
          fault === 'different-step' && original.key === 'a'
            ? { ...original, fields: { title: 'Unpublished edit' } }
            : fault === 'unexpected-step' && original.key === 'c'
              ? { ...original, key: 'unexpected' }
              : original;
        await database.execute(
          sql`insert into blueprint_step(id,organization_id,version_id,key,kind,parent_step_key,sort,step) values(${requiredRow(ids[original.key])},${fixture.organizationId},${versionId},${step.key},${step.kind},${step.parentStepKey},${step.sort},${JSON.stringify(step)}::jsonb)`,
        );
      }
      await database.execute(
        sql`insert into blueprint_dependency(organization_id,version_id,blocker_step_id,blocked_step_id) values(${fixture.organizationId},${versionId},${requiredRow(ids['a'])},${requiredRow(ids[fault === 'different-edge' ? 'c' : 'b'])})`,
      );
      const before = await migrationRows(
        database,
        sql`select id,step from blueprint_step where version_id=${versionId} order by id`,
      );
      await expect(
        persistBlueprintProjection(database, {
          organizationId: fixture.organizationId,
          versionId,
          blueprint: definition.blueprint,
        }),
      ).rejects.toThrow('projection is incomplete or different');
      expect(
        await migrationRows(
          database,
          sql`select id,step from blueprint_step where version_id=${versionId} order by id`,
        ),
      ).toEqual(before);
    }
  }));

it.each(['foreign-mapping', 'foreign-source-step', 'foreign-concrete-task'] as const)(
  'rejects a retained %s atomically without publishing private source bodies',
  async (fault) =>
    fixtureCase(async (database, fixture) => {
      const foreign = genId();
      await database.execute(
        sql`insert into organization(id,name,slug) values(${foreign},'Foreign mappings',${foreign.toLowerCase()})`,
      );
      if (fault === 'foreign-mapping')
        await database.execute(
          sql`update process_instance_task set organization_id=${foreign} where task_id=${fixture.taskId}`,
        );
      else if (fault === 'foreign-source-step')
        await database.execute(
          sql`update process_instance_task set step_id=(select id from process_step where revision_id=${fixture.genericRevisionId} limit 1) where task_id=${fixture.taskId}`,
        );
      else {
        const team = genId();
        const status = genId();
        const task = genId();
        await database.transaction((tx) => provisionMigrationBases(tx, foreign));
        await database.execute(
          sql`insert into team(id,organization_id,name,key) values(${team},${foreign},'Foreign','FOREIGN')`,
        );
        await database.execute(
          sql`insert into work_status(id,organization_id,entity_type,key,name,category,position,is_default) values(${status},${foreign},'task','backlog','Backlog','backlog',0,true)`,
        );
        await database.execute(
          sql`insert into task(id,organization_id,team_id,title,state,status_id) values(${task},${foreign},${team},'Private foreign Task','backlog',${status})`,
        );
        await database.execute(
          sql`update process_instance_task set task_id=${task} where task_id=${fixture.taskId}`,
        );
      }
      const before = await migrationRows(database, sql`select id from template order by id`);
      const expected =
        fault === 'foreign-mapping'
          ? 'concrete mappings cross workspace'
          : fault === 'foreign-source-step'
            ? 'mapping has no source step'
            : 'concrete mapping crosses workspace';
      await expect(backfillWorkTemplateBlueprints(database)).rejects.toThrow(expected);
      expect(await migrationRows(database, sql`select id from template order by id`)).toEqual(
        before,
      );
      expect(
        await migrationRows(database, sql`select id from work_template_blueprint_invocation`),
      ).toEqual([]);
      expect(
        await migrationRows(
          database,
          sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
        ),
      ).toEqual([]);
    }),
);

it('refuses an empty published retained revision rather than manufacturing a root', async () =>
  fixtureCase(async (database, fixture) => {
    const definitionId = genId();
    await database.execute(
      sql`insert into process_definition(id,organization_id,name,status) values(${definitionId},${fixture.organizationId},'Empty publication','published')`,
    );
    await database.execute(
      sql`insert into process_revision(id,organization_id,definition_id,number,published_at) values(${'00000000000000000000000001'},${fixture.organizationId},${definitionId},1,now())`,
    );
    await expect(backfillWorkTemplateBlueprints(database)).rejects.toThrow(
      'Published retained blueprint has no work roots',
    );
    expect(
      await migrationRows(
        database,
        sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
      ),
    ).toEqual([]);
  }));
