import { FractionalRank } from '@docket/work/work-view-contract';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { appWithActor, seedBaseOrg } from '../support/routes-harness';
import { grantOrganizationCapability, JSON_HEADERS, schema, workViews } from './work-views-harness';

type SeededOrg = Awaited<ReturnType<typeof seedBaseOrg>>;
type OrderApp = ReturnType<typeof appWithActor>;

/** A seeded organization with a contributor app mounted on the work-view routes. */
interface ContributorFixture extends SeededOrg {
  readonly app: OrderApp;
}

async function contributorFixture(): Promise<ContributorFixture> {
  const seeded = await seedBaseOrg(schema.db, schema);
  await grantOrganizationCapability(seeded.orgId, seeded.humanActorId, 'contribute');
  return {
    ...seeded,
    app: appWithActor(workViews, seeded.orgId, ['contribute'], seeded.humanActorId),
  };
}

async function patchOrder(app: OrderApp, body: Record<string, unknown>): Promise<Response> {
  return app.request('/order', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ context: { kind: 'organization' }, ...body }),
  });
}

async function seedTasks(fixture: SeededOrg, titles: readonly string[]): Promise<string[]> {
  const rows = await schema.db
    .insert(schema.task)
    .values(
      titles.map((title) => ({
        organizationId: fixture.orgId,
        teamId: fixture.teamId,
        title,
        state: 'todo' as const,
        statusId: fixture.statusId('task', 'todo'),
        visibility: 'public' as const,
      })),
    )
    .returning({ id: schema.task.id });
  return rows.map((row) => row.id);
}

async function seedRank(orgId: string, itemId: string, rank: string): Promise<void> {
  await schema.db.insert(schema.workItemOrder).values({
    organizationId: orgId,
    contextType: 'organization',
    contextId: orgId,
    target: 'task',
    itemId,
    rank: FractionalRank.parse(rank),
  });
}

async function readRanks(orgId: string): Promise<Map<string, string>> {
  const rows = await schema.db
    .select({ itemId: schema.workItemOrder.itemId, rank: schema.workItemOrder.rank })
    .from(schema.workItemOrder)
    .where(eq(schema.workItemOrder.organizationId, orgId));
  return new Map(rows.map((row) => [row.itemId, row.rank]));
}

function rankOf(ranks: Map<string, string>, itemId: string): string {
  const rank = ranks.get(itemId);
  if (rank === undefined) throw new Error(`no stored rank for ${itemId}`);
  return rank;
}

async function seedProject(fixture: SeededOrg, name: string): Promise<string> {
  const [row] = await schema.db
    .insert(schema.project)
    .values({
      organizationId: fixture.orgId,
      teamId: fixture.teamId,
      name,
      status: 'planned',
      statusId: fixture.statusId('project', 'planned'),
      visibility: 'public',
    })
    .returning({ id: schema.project.id });
  if (!row) throw new Error('Project seed failed');
  return row.id;
}

async function seedProgram(fixture: SeededOrg, name: string): Promise<string> {
  const [row] = await schema.db
    .insert(schema.program)
    .values({
      organizationId: fixture.orgId,
      name,
      status: 'active',
      statusId: fixture.statusId('program', 'active'),
    })
    .returning({ id: schema.program.id });
  if (!row) throw new Error('Program seed failed');
  return row.id;
}

async function seedInitiative(fixture: SeededOrg, name: string): Promise<string> {
  const [row] = await schema.db
    .insert(schema.initiative)
    .values({
      organizationId: fixture.orgId,
      name,
      status: 'active',
      statusId: fixture.statusId('initiative', 'active'),
    })
    .returning({ id: schema.initiative.id });
  if (!row) throw new Error('Initiative seed failed');
  return row.id;
}

async function seedActor(orgId: string, displayName: string): Promise<string> {
  const [row] = await schema.db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName })
    .returning({ id: schema.actor.id });
  if (!row) throw new Error('actor seed failed');
  return row.id;
}

async function seedTeam(orgId: string, name: string): Promise<string> {
  const [row] = await schema.db
    .insert(schema.team)
    .values({ organizationId: orgId, name, key: `T${Math.random().toString(36).slice(2, 6)}` })
    .returning({ id: schema.team.id });
  if (!row) throw new Error('team seed failed');
  return row.id;
}

async function projectTeams(projectId: string) {
  return schema.db
    .select({ teamId: schema.projectTeam.teamId, isPrimary: schema.projectTeam.isPrimary })
    .from(schema.projectTeam)
    .where(eq(schema.projectTeam.projectId, projectId));
}

describe('work-view order authorization', () => {
  it('rejects a Project reorder from a member without contribute', async () => {
    const seeded = await seedBaseOrg(schema.db, schema);
    const projectId = await seedProject(seeded, 'Read-only Project');
    const viewer = appWithActor(workViews, seeded.orgId, ['view'], seeded.humanActorId);

    const response = await patchOrder(viewer, {
      target: 'project',
      itemId: projectId,
      groupField: null,
      groupValue: null,
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(403);
  });

  it('rejects an Initiative reorder whose neighbor belongs to another organization', async () => {
    const fixture = await contributorFixture();
    const foreign = await seedBaseOrg(schema.db, schema);
    const itemId = await seedInitiative(fixture, 'Local Initiative');
    const foreignId = await seedInitiative(foreign, 'Foreign Initiative');

    const response = await patchOrder(fixture.app, {
      target: 'initiative',
      itemId,
      groupField: null,
      groupValue: null,
      beforeId: foreignId,
      afterId: null,
    });

    expect(response.status).toBe(404);
  });

  it('rejects a Task cycle drop onto a cycle from another organization', async () => {
    const fixture = await contributorFixture();
    const foreign = await seedBaseOrg(schema.db, schema);
    const [foreignCycle] = await schema.db
      .insert(schema.cycle)
      .values({
        organizationId: foreign.orgId,
        teamId: foreign.teamId,
        number: 1,
        startsAt: new Date('2026-09-21T00:00:00.000Z'),
        endsAt: new Date('2026-09-27T23:59:59.999Z'),
      })
      .returning({ id: schema.cycle.id });
    if (!foreignCycle) throw new Error('foreign cycle seed failed');
    const [itemId] = await seedTasks(fixture, ['Cycle drop']);
    if (!itemId) throw new Error('Task seed failed');

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId,
      groupField: 'cycle',
      groupValue: foreignCycle.id,
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(404);
    const [stored] = await schema.db
      .select({ cycleId: schema.task.cycleId })
      .from(schema.task)
      .where(eq(schema.task.id, itemId));
    expect(stored?.cycleId).toBeNull();
  });
});

describe('work-view container group drops', () => {
  it('moves a Project to another status group', async () => {
    const fixture = await contributorFixture();
    const projectId = await seedProject(fixture, 'Status Project');

    const response = await patchOrder(fixture.app, {
      target: 'project',
      itemId: projectId,
      groupField: 'status',
      groupValue: 'active',
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const [stored] = await schema.db
      .select({ status: schema.project.status, statusId: schema.project.statusId })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    expect(stored).toEqual({
      status: 'active',
      statusId: fixture.statusId('project', 'active'),
    });
  });

  it('changes a Project priority group', async () => {
    const fixture = await contributorFixture();
    const projectId = await seedProject(fixture, 'Priority Project');

    const response = await patchOrder(fixture.app, {
      target: 'project',
      itemId: projectId,
      groupField: 'priority',
      groupValue: 'urgent',
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const [stored] = await schema.db
      .select({ priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    expect(stored?.priority).toBe('urgent');
  });

  it('changes an Initiative priority group', async () => {
    const fixture = await contributorFixture();
    const initiativeId = await seedInitiative(fixture, 'Priority Initiative');

    const response = await patchOrder(fixture.app, {
      target: 'initiative',
      itemId: initiativeId,
      groupField: 'priority',
      groupValue: 'high',
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const [stored] = await schema.db
      .select({ priority: schema.initiative.priority })
      .from(schema.initiative)
      .where(eq(schema.initiative.id, initiativeId));
    expect(stored?.priority).toBe('high');
  });

  it('makes the current actor the Project lead', async () => {
    const fixture = await contributorFixture();
    const projectId = await seedProject(fixture, 'Lead Project');

    const response = await patchOrder(fixture.app, {
      target: 'project',
      itemId: projectId,
      groupField: 'lead',
      groupValue: { kind: 'current-actor' },
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const [stored] = await schema.db
      .select({ leadId: schema.project.leadId })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    expect(stored?.leadId).toBe(fixture.humanActorId);
  });

  it('assigns a Program owner from an explicit actor group', async () => {
    const fixture = await contributorFixture();
    const programId = await seedProgram(fixture, 'Owned Program');
    const ownerId = await seedActor(fixture.orgId, 'Program owner');

    const response = await patchOrder(fixture.app, {
      target: 'program',
      itemId: programId,
      groupField: 'owner',
      groupValue: { kind: 'actor', actorId: ownerId },
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const [stored] = await schema.db
      .select({ ownerId: schema.program.ownerId })
      .from(schema.program)
      .where(eq(schema.program.id, programId));
    expect(stored?.ownerId).toBe(ownerId);
  });

  it('assigns an Initiative owner from an explicit actor group', async () => {
    const fixture = await contributorFixture();
    const initiativeId = await seedInitiative(fixture, 'Owned Initiative');
    const ownerId = await seedActor(fixture.orgId, 'Initiative owner');

    const response = await patchOrder(fixture.app, {
      target: 'initiative',
      itemId: initiativeId,
      groupField: 'owner',
      groupValue: { kind: 'actor', actorId: ownerId },
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const [stored] = await schema.db
      .select({ ownerId: schema.initiative.ownerId })
      .from(schema.initiative)
      .where(eq(schema.initiative.id, initiativeId));
    expect(stored?.ownerId).toBe(ownerId);
  });

  it('replaces one Program label with another', async () => {
    const fixture = await contributorFixture();
    const programId = await seedProgram(fixture, 'Labelled Program');
    const [source, destination] = await schema.db
      .insert(schema.label)
      .values([
        { organizationId: fixture.orgId, name: 'Program source', color: 'red' },
        { organizationId: fixture.orgId, name: 'Program destination', color: 'green' },
      ])
      .returning({ id: schema.label.id });
    if (!source || !destination) throw new Error('Program label seed failed');
    await schema.db
      .insert(schema.programLabel)
      .values({ organizationId: fixture.orgId, programId, labelId: source.id });

    const response = await patchOrder(fixture.app, {
      target: 'program',
      itemId: programId,
      groupField: 'labels',
      sourceGroupValue: source.id,
      groupValue: destination.id,
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const links = await schema.db
      .select({ labelId: schema.programLabel.labelId })
      .from(schema.programLabel)
      .where(eq(schema.programLabel.programId, programId));
    expect(links).toEqual([{ labelId: destination.id }]);
  });
});

describe('work-view Project Team group drops', () => {
  it('leaves Project Teams untouched when the source and destination Team match', async () => {
    const fixture = await contributorFixture();
    const projectId = await seedProject(fixture, 'Same Team Project');
    await schema.db.insert(schema.projectTeam).values({
      organizationId: fixture.orgId,
      projectId,
      teamId: fixture.teamId,
      isPrimary: true,
    });

    const response = await patchOrder(fixture.app, {
      target: 'project',
      itemId: projectId,
      groupField: 'teams',
      sourceGroupValue: fixture.teamId,
      groupValue: fixture.teamId,
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    expect(await projectTeams(projectId)).toEqual([{ teamId: fixture.teamId, isPrimary: true }]);
  });

  it('adds a secondary Team from the empty group and keeps the primary Team', async () => {
    const fixture = await contributorFixture();
    const projectId = await seedProject(fixture, 'Added Team Project');
    const addedTeamId = await seedTeam(fixture.orgId, 'Added');
    await schema.db.insert(schema.projectTeam).values({
      organizationId: fixture.orgId,
      projectId,
      teamId: fixture.teamId,
      isPrimary: true,
    });

    const response = await patchOrder(fixture.app, {
      target: 'project',
      itemId: projectId,
      groupField: 'teams',
      sourceGroupValue: null,
      groupValue: addedTeamId,
      beforeId: null,
      afterId: null,
    });

    expect(response.status).toBe(200);
    const teams = await projectTeams(projectId);
    expect(teams).toHaveLength(2);
    expect(teams).toContainEqual({ teamId: fixture.teamId, isPrimary: true });
    expect(teams).toContainEqual({ teamId: addedTeamId, isPrimary: false });
    const [stored] = await schema.db
      .select({ teamId: schema.project.teamId })
      .from(schema.project)
      .where(
        and(eq(schema.project.id, projectId), eq(schema.project.organizationId, fixture.orgId)),
      );
    expect(stored?.teamId).toBe(fixture.teamId);
  });
});

describe('work-view manual rank placement', () => {
  it('appends an unranked after-neighbor to the persisted tail before placing the moved item', async () => {
    const fixture = await contributorFixture();
    const [tail, after, moved] = await seedTasks(fixture, ['Tail', 'Unranked after', 'Moved']);
    if (!tail || !after || !moved) throw new Error('tail seed failed');
    await seedRank(fixture.orgId, tail, 'M');

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId: moved,
      groupField: null,
      groupValue: null,
      beforeId: null,
      afterId: after,
    });

    expect(response.status).toBe(200);
    const ranks = await readRanks(fixture.orgId);
    expect(rankOf(ranks, tail) < rankOf(ranks, after)).toBe(true);
    expect(rankOf(ranks, after) < rankOf(ranks, moved)).toBe(true);
  });

  it('places an unranked before-neighbor directly after a ranked after-neighbor', async () => {
    const fixture = await contributorFixture();
    const [after, following, before, moved] = await seedTasks(fixture, [
      'Ranked after',
      'Ranked following',
      'Unranked before',
      'Moved',
    ]);
    if (!after || !following || !before || !moved) throw new Error('neighbor seed failed');
    await seedRank(fixture.orgId, after, 'C');
    await seedRank(fixture.orgId, following, 'M');

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId: moved,
      groupField: null,
      groupValue: null,
      beforeId: before,
      afterId: after,
    });

    expect(response.status).toBe(200);
    const ranks = await readRanks(fixture.orgId);
    expect(rankOf(ranks, after) < rankOf(ranks, moved)).toBe(true);
    expect(rankOf(ranks, moved) < rankOf(ranks, before)).toBe(true);
    expect(rankOf(ranks, before) < rankOf(ranks, following)).toBe(true);
  });

  it('rebalances a first-position neighbor that has no predecessor rank', async () => {
    const fixture = await contributorFixture();
    const [after, before, moved] = await seedTasks(fixture, [
      'Unranked after',
      'Lowest before',
      'Moved',
    ]);
    if (!after || !before || !moved) throw new Error('lowest-rank seed failed');
    await seedRank(fixture.orgId, before, '0');

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId: moved,
      groupField: null,
      groupValue: null,
      beforeId: before,
      afterId: after,
    });

    expect(response.status).toBe(200);
    const ranks = await readRanks(fixture.orgId);
    expect(rankOf(ranks, after) < rankOf(ranks, moved)).toBe(true);
    expect(rankOf(ranks, moved) < rankOf(ranks, before)).toBe(true);
    for (const rank of ranks.values()) expect(FractionalRank.safeParse(rank).success).toBe(true);
  });

  it('rebalances neighbors whose dotted ranks leave no midpoint', async () => {
    const fixture = await contributorFixture();
    const [after, before, moved] = await seedTasks(fixture, [
      'Dotted after',
      'Dotted before',
      'Moved',
    ]);
    if (!after || !before || !moved) throw new Error('dotted-rank seed failed');
    await seedRank(fixture.orgId, after, 'A');
    await seedRank(fixture.orgId, before, 'A.V');

    const response = await patchOrder(fixture.app, {
      target: 'task',
      itemId: moved,
      groupField: null,
      groupValue: null,
      beforeId: before,
      afterId: after,
    });

    expect(response.status).toBe(200);
    const ranks = await readRanks(fixture.orgId);
    expect(rankOf(ranks, after) < rankOf(ranks, moved)).toBe(true);
    expect(rankOf(ranks, moved) < rankOf(ranks, before)).toBe(true);
  });
});
