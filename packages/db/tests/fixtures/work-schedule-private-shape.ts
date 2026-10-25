import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';

interface Source {
  readonly organizationId: string;
  readonly actorId: string;
  readonly teamId: string;
  readonly workTypeId: string;
  readonly versionId: string;
}
function constraint(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  if ('constraint' in error && typeof error.constraint === 'string') return error.constraint;
  if ('constraint_name' in error && typeof error.constraint_name === 'string')
    return error.constraint_name;
  return 'cause' in error ? constraint(error.cause) : null;
}
function draft(source: Source) {
  return {
    kind: 'schedule',
    revision: 1,
    template: {
      targetType: 'task',
      workTypeId: source.workTypeId,
      selection: { kind: 'pinned', workTypeVersionId: source.versionId },
    },
    root: {
      kind: 'task',
      fields: { title: 'Private work' },
      dates: {},
      teamId: source.teamId,
      placement: {},
    },
    stepOverrides: [],
    optionalChoices: [],
    titlePattern: 'Private work',
    timezone: 'UTC',
  };
}
async function rejectBoundPlacement(database: Database, source: Source): Promise<void> {
  const root = draft(source),
    base = {
      kind: 'forest',
      revision: 2,
      state: 'published',
      creationMode: 'all_at_once',
      roots: [
        { key: 'one', draft: root },
        { key: 'two', draft: root },
      ],
      dependencies: [],
      timing: { kind: 'field_timing', revision: 2, rules: [] },
      absentFields: [],
      titlePolicy: { kind: 'native_title', revision: 1 },
      titles: [],
      completionPolicy: { kind: 'terminal_actual_tree', revision: 1 },
    };
  const malformed = [{ rootKey: 'one', parentTask: { rootKey: 'two', path: [] }, invented: true }];
  for (const placements of [
    [{ rootKey: 'one', parentTask: { rootKey: 'one', path: [] } }],
    [
      { rootKey: 'one', parentTask: { rootKey: 'two', path: [] } },
      { rootKey: 'two', parentTask: { rootKey: 'one', path: [] } },
    ],
    malformed,
  ]) {
    const document = { ...base, placements };
    const [shape] = await migrationRows<{ valid: boolean }>(
      database,
      sql`select docket_schedule_v2_shape(${JSON.stringify(document)}::jsonb) as valid`,
    );
    expect(shape?.valid).toBe(false);
    await expect(
      database.transaction(async (tx) => {
        const series = genId();
        await tx.execute(
          sql`insert into recurrence_series(id,organization_id,name,created_by) values(${series},${source.organizationId},'Private shape fixture',${source.actorId})`,
        );
        await tx.execute(
          sql`insert into recurrence_series_revision(id,organization_id,series_id,number,effective_from,trigger_kind,schedule_draft) values(${genId()},${source.organizationId},${series},1,'2026-10-01','manual',${JSON.stringify(document)}::jsonb)`,
        );
      }),
    ).rejects.toSatisfy((error: unknown) => constraint(error) === 'schedule_draft_shape');
  }
}
async function acceptBoundPlacement(database: Database, source: Source): Promise<void> {
  const root = draft(source),
    document = {
      kind: 'forest',
      revision: 2,
      state: 'published',
      creationMode: 'all_at_once',
      roots: [
        { key: 'one', draft: root },
        { key: 'two', draft: root },
      ],
      dependencies: [],
      timing: { kind: 'field_timing', revision: 2, rules: [] },
      absentFields: [],
      titlePolicy: { kind: 'native_title', revision: 1 },
      titles: [],
      completionPolicy: { kind: 'terminal_actual_tree', revision: 1 },
      placements: [{ rootKey: 'one', parentTask: { rootKey: 'two', path: [] } }],
    };
  const [shape] = await migrationRows<{ valid: boolean }>(
    database,
    sql`select docket_schedule_v2_shape(${JSON.stringify(document)}::jsonb) as valid`,
  );
  expect(shape?.valid).toBe(true);
  const stop = new Error('Rollback valid private placement control');
  await expect(
    database.transaction(async (tx) => {
      const series = genId();
      await tx.execute(
        sql`insert into recurrence_series(id,organization_id,name,created_by) values(${series},${source.organizationId},'Valid private placement fixture',${source.actorId})`,
      );
      await tx.execute(
        sql`insert into recurrence_series_revision(id,organization_id,series_id,number,effective_from,trigger_kind,schedule_draft) values(${genId()},${source.organizationId},${series},1,'2026-10-01','manual',${JSON.stringify(document)}::jsonb)`,
      );
      throw stop;
    }),
  ).rejects.toBe(stop);
}
async function rejectNegativeOffset(database: Database, source: Source): Promise<void> {
  const selected = draft(source),
    reference = { rootKey: 'one', path: [] },
    head = genId(),
    revision = genId();
  const document = {
    kind: 'private_definition',
    revision: 1,
    state: 'published',
    creationMode: 'all_at_once',
    roots: [
      {
        key: 'one',
        template: selected.template,
        root: selected.root,
        stepOverrides: [],
        optionalChoices: [],
      },
    ],
    sourceMappings: [{ alias: genId(), sourceKey: 'one', reference, kind: 'task', sort: 0 }],
    dependencies: [],
    timing: {
      kind: 'field_timing',
      revision: 2,
      rules: [
        {
          target: { ...reference, field: 'dueDate' },
          source: { kind: 'after_completion', works: [reference] },
          offset: { days: -1, unit: 'calendar' },
        },
      ],
    },
    absentFields: [{ ...reference, field: 'startDate' }],
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [{ target: reference, kind: 'task', pattern: 'Private work' }],
    completionPolicy: { kind: 'legacy_authored_tasks', revision: 1, tasks: [reference] },
    authoring: {
      kind: 'process_definition',
      revision: 1,
      definitionAlias: head,
      revisionAlias: revision,
      definition: {
        name: 'Private original',
        creationMode: 'all_at_once',
        tasks: [{ key: 'one', title: 'Private work', teamId: source.teamId }],
      },
    },
  };
  const [shape] = await migrationRows<{ valid: boolean }>(
    database,
    sql`select docket_private_definition_shape(${JSON.stringify(document)}::jsonb) as valid`,
  );
  expect(shape?.valid).toBe(false);
  await expect(
    database.execute(
      sql`insert into work_template_blueprint_invocation(organization_id,owner_actor_id,manifest,overrides) values(${source.organizationId},${source.actorId},${JSON.stringify(document)}::jsonb,'[]'::jsonb)`,
    ),
  ).rejects.toSatisfy((error: unknown) => constraint(error) === 'private_definition_shape');
}
/** Prove persisted bound placement and private completion-offset refusal through actual SQL registration. */
export async function exercisePrivateScheduleShapeValidation(database: Database): Promise<void> {
  const [source] = await migrationRows<Source>(
    database,
    sql`select d.organization_id as "organizationId",d.created_by as "actorId",t.team_id as "teamId",r.value->>'workTypeId' as "workTypeId",r.value->>'workTypeVersionId' as "versionId" from process_definition d join process_revision v on v.definition_id=d.id join work_template_blueprint_conversion c on c.legacy_process_revision_id=v.id join work_template_blueprint_invocation i on i.id=c.invocation_id cross join lateral jsonb_array_elements(i.manifest->'roots') r(value) join process_task_spec t on t.step_id=r.value->>'sourceStepId' where r.value->>'kind'='task' and i.manifest->>'kind'='published' limit 1`,
  );
  if (!source) throw new Error('Missing private SQL shape fixture');
  await rejectBoundPlacement(database, source);
  await rejectNegativeOffset(database, source);
  await acceptBoundPlacement(database, source);
}
