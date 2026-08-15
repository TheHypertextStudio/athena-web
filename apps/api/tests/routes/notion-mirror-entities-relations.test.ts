/**
 * `@docket/api` — the relation values `loadEntityRows` emits for each projected entity.
 *
 * @remarks
 * Every one of these is an `ownerId`/`relatedId` pair read out of a link table, and two of them
 * read the SAME table in opposite directions (`project.initiatives` and `initiative.projects` are
 * both `initiative_project`). A transposed pair would not crash — it would fill Notion with
 * confidently wrong relations — so the direction is pinned here per entity rather than left to the
 * reconciler tests, which only exercise `task.project`.
 *
 * `program.projects` gets particular attention: it is the only relation with no link table at all,
 * derived instead from the reverse of `project.program_id`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { MirrorSourceValue } from '@docket/integrations';

import type { loadEntityRows as LoadEntityRows } from '../../src/routes/notion-mirror-entities';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let loadEntityRows!: typeof LoadEntityRows;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  loadEntityRows = (await import('../../src/routes/notion-mirror-entities')).loadEntityRows;
});

/** The `entityIds` a record's relation field points at, sorted for a stable comparison. */
function relatedIds(values: Readonly<Record<string, MirrorSourceValue>>, field: string): string[] {
  const value = values[field];
  if (value?.kind !== 'reference') throw new Error(`${field} is not a reference value`);
  return [...value.entityIds].sort();
}

/** The entity a record's relation field points at. */
function relatedEntity(values: Readonly<Record<string, MirrorSourceValue>>, field: string): string {
  const value = values[field];
  if (value?.kind !== 'reference') throw new Error(`${field} is not a reference value`);
  return value.entity;
}

async function seedGraph() {
  const base = await seedBaseOrg(db, schema);
  const integration = one(
    await db
      .insert(schema.integration)
      .values({ organizationId: base.orgId, provider: 'notion', pattern: 'connector' })
      .returning(),
  );
  const program = one(
    await db
      .insert(schema.program)
      .values({
        organizationId: base.orgId,
        name: 'Transit',
        status: 'active',
        statusId: base.statusId('program', 'active'),
      })
      .returning(),
  );
  const project = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: base.orgId,
        name: 'Bus lanes',
        programId: program.id,
        status: 'planned',
        statusId: base.statusId('project', 'planned'),
      })
      .returning(),
  );
  const initiative = one(
    await db
      .insert(schema.initiative)
      .values({
        organizationId: base.orgId,
        name: 'Ridership',
        status: 'active',
        statusId: base.statusId('initiative', 'active'),
      })
      .returning(),
  );
  await db
    .insert(schema.initiativeProject)
    .values({ organizationId: base.orgId, initiativeId: initiative.id, projectId: project.id });
  await db
    .insert(schema.initiativeProgram)
    .values({ organizationId: base.orgId, initiativeId: initiative.id, programId: program.id });

  const label = one(
    await db
      .insert(schema.label)
      .values({ organizationId: base.orgId, name: 'Urgent', color: 'red' })
      .returning(),
  );
  const cycle = one(
    await db
      .insert(schema.cycle)
      .values({
        organizationId: base.orgId,
        teamId: base.teamId,
        number: 1,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-01-08T00:00:00.000Z'),
        source: 'native',
      })
      .returning(),
  );
  const milestone = one(
    await db
      .insert(schema.milestone)
      .values({ organizationId: base.orgId, projectId: project.id, name: 'Phase one' })
      .returning(),
  );
  const task = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: base.orgId,
        teamId: base.teamId,
        title: 'Draft the brief',
        state: 'backlog',
        statusId: base.statusId('task', 'backlog'),
        projectId: project.id,
        cycleId: cycle.id,
        milestoneId: milestone.id,
      })
      .returning(),
  );
  await db
    .insert(schema.taskLabel)
    .values({ organizationId: base.orgId, taskId: task.id, labelId: label.id });
  await db
    .insert(schema.teamMember)
    .values({ organizationId: base.orgId, teamId: base.teamId, actorId: base.humanActorId });

  return { ...base, integration, program, project, initiative, label, cycle, milestone, task };
}

/** Load one entity and return the record for `entityId`. */
async function recordFor(
  orgId: string,
  integrationId: string,
  entity: Parameters<typeof LoadEntityRows>[2],
  entityId: string,
): Promise<Readonly<Record<string, MirrorSourceValue>>> {
  const rows = await loadEntityRows(orgId, integrationId, entity);
  const row = rows.find((candidate) => candidate.entityId === entityId);
  if (!row) throw new Error(`no ${entity} record for ${entityId}`);
  return row.values;
}

describe('loadEntityRows relation values', () => {
  it('points a task at its project, cycle, milestone, team and labels', async () => {
    const g = await seedGraph();
    const values = await recordFor(g.orgId, g.integration.id, 'task', g.task.id);

    expect(relatedIds(values, 'project')).toEqual([g.project.id]);
    expect(relatedIds(values, 'cycle')).toEqual([g.cycle.id]);
    expect(relatedIds(values, 'milestone')).toEqual([g.milestone.id]);
    expect(relatedIds(values, 'team')).toEqual([g.teamId]);
    expect(relatedIds(values, 'labels')).toEqual([g.label.id]);
    // The target entity, not just the ids: a reference naming the wrong database resolves against
    // the wrong page map and would silently write nothing.
    expect(relatedEntity(values, 'project')).toBe('project');
    expect(relatedEntity(values, 'labels')).toBe('label');
  });

  it('reads initiative_project in both directions without transposing it', async () => {
    const g = await seedGraph();
    const project = await recordFor(g.orgId, g.integration.id, 'project', g.project.id);
    const initiative = await recordFor(g.orgId, g.integration.id, 'initiative', g.initiative.id);

    // Same table, opposite directions. A transposed `ownerId`/`relatedId` pair would make one of
    // these list itself, or list nothing, rather than fail.
    expect(relatedIds(project, 'initiatives')).toEqual([g.initiative.id]);
    expect(relatedEntity(project, 'initiatives')).toBe('initiative');
    expect(relatedIds(initiative, 'projects')).toEqual([g.project.id]);
    expect(relatedEntity(initiative, 'projects')).toBe('project');
  });

  it('carries a project to its program and team, and an initiative to its programs', async () => {
    const g = await seedGraph();
    const project = await recordFor(g.orgId, g.integration.id, 'project', g.project.id);
    const initiative = await recordFor(g.orgId, g.integration.id, 'initiative', g.initiative.id);

    expect(relatedIds(project, 'program')).toEqual([g.program.id]);
    expect(relatedIds(initiative, 'programs')).toEqual([g.program.id]);
    expect(relatedEntity(initiative, 'programs')).toBe('program');
  });

  it('derives program.projects from the reverse of project.program_id', async () => {
    // The only relation with no link table, and the only one whose owner id is nullable — so it
    // is also the only one whose grouping could quietly collect projects with no program at all.
    const g = await seedGraph();
    const unowned = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: g.orgId,
          name: 'No program',
          status: 'planned',
          statusId: g.statusId('project', 'planned'),
        })
        .returning(),
    );
    const program = await recordFor(g.orgId, g.integration.id, 'program', g.program.id);

    expect(relatedIds(program, 'projects')).toEqual([g.project.id]);
    expect(relatedIds(program, 'projects')).not.toContain(unowned.id);
    expect(relatedEntity(program, 'projects')).toBe('project');
  });

  it('reads team_member in both directions, and points a cycle at its team', async () => {
    const g = await seedGraph();
    const team = await recordFor(g.orgId, g.integration.id, 'team', g.teamId);
    const person = await recordFor(g.orgId, g.integration.id, 'person', g.humanActorId);
    const cycle = await recordFor(g.orgId, g.integration.id, 'cycle', g.cycle.id);

    expect(relatedIds(team, 'members')).toEqual([g.humanActorId]);
    expect(relatedEntity(team, 'members')).toBe('person');
    expect(relatedIds(person, 'teams')).toEqual([g.teamId]);
    expect(relatedEntity(person, 'teams')).toBe('team');
    expect(relatedIds(cycle, 'team')).toEqual([g.teamId]);
  });

  it('points a milestone at its project', async () => {
    const g = await seedGraph();
    const milestone = await recordFor(g.orgId, g.integration.id, 'milestone', g.milestone.id);

    expect(relatedIds(milestone, 'project')).toEqual([g.project.id]);
    expect(relatedEntity(milestone, 'project')).toBe('project');
  });

  it('sorts a to-many set, so an unchanged row keeps its content hash', async () => {
    // Postgres returns link rows in no guaranteed order, and the projected content hash
    // stringifies the relation array in order. Without a stable sort a task with two labels would
    // rewrite itself to Notion on every sweep with nothing changed.
    const g = await seedGraph();
    const second = one(
      await db
        .insert(schema.label)
        .values({ organizationId: g.orgId, name: 'Later', color: 'blue' })
        .returning(),
    );
    await db
      .insert(schema.taskLabel)
      .values({ organizationId: g.orgId, taskId: g.task.id, labelId: second.id });

    const values = await recordFor(g.orgId, g.integration.id, 'task', g.task.id);
    const emitted = values['labels'];
    if (emitted?.kind !== 'reference') throw new Error('labels is not a reference value');

    expect([...emitted.entityIds]).toEqual([...emitted.entityIds].sort());
    expect(emitted.entityIds).toHaveLength(2);
  });

  it('emits an empty reference — never an absent field — when nothing is related', async () => {
    // Absence defers the column; an empty reference clears it. A task with no project genuinely
    // has none, so the Notion cell must be emptied rather than left to a later pass.
    const g = await seedGraph();
    const bare = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: g.orgId,
          teamId: g.teamId,
          title: 'Unfiled',
          state: 'backlog',
          statusId: g.statusId('task', 'backlog'),
        })
        .returning(),
    );
    const values = await recordFor(g.orgId, g.integration.id, 'task', bare.id);

    expect(relatedIds(values, 'project')).toEqual([]);
    expect(relatedIds(values, 'labels')).toEqual([]);
  });
});
