import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import type tasksRouter from '../../src/routes/tasks';
import type projectsRouter from '../../src/routes/projects';
import type projectRollupRouter from '../../src/routes/project-rollup';
import type programsRouter from '../../src/routes/programs';
import type initiativesRouter from '../../src/routes/initiatives';
import { detailCapabilities } from '../../src/lib/detail-capabilities';
import { NotFoundError } from '../../src/error';
import {
  associatedWorkSummary,
  assertInitiativeLabels,
  assertOwnerInOrg,
  buildInitiativeDetail,
  buildInitiativeDetailFromSummary,
  type InitiativeRow,
  loadInitiative,
  projectOverlapsWindow,
  type ProjectRow,
  toOut,
} from '../../src/routes/initiative-helpers';
import {
  appWithActor,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedInitiative,
  seedProgram,
  seedProject,
  seedStatuses,
  seedTask,
  seedTaskAccessOrg,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;
let projects!: typeof projectsRouter;
let projectRollup!: typeof projectRollupRouter;
let programs!: typeof programsRouter;
let initiatives!: typeof initiativesRouter;

const initiativeRow: InitiativeRow = {
  id: 'initiative-row',
  organizationId: 'organization-row',
  createdBy: null,
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
  updatedAt: new Date('2026-08-24T00:00:00.000Z'),
  archivedAt: null,
  name: 'Complete street access',
  summary: null,
  description: null,
  ownerId: null,
  leadTeamId: null,
  status: 'active',
  statusId: 'initiative-active',
  priority: 'none',
  updateCadence: 'monthly',
  targetDate: null,
  targetDateResolution: null,
  targetDateFiscalYearStartMonth: null,
  health: null,
};

const projectRow: ProjectRow = {
  id: 'project-row',
  organizationId: 'organization-row',
  createdBy: null,
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
  updatedAt: new Date('2026-08-24T00:00:00.000Z'),
  archivedAt: null,
  name: 'Protected bike lanes',
  summary: null,
  description: null,
  leadId: null,
  programId: null,
  teamId: null,
  status: 'planned',
  statusId: 'project-planned',
  priority: 'none',
  health: null,
  startDate: null,
  startDateResolution: null,
  startDateFiscalYearStartMonth: null,
  targetDate: null,
  targetDateResolution: null,
  targetDateFiscalYearStartMonth: null,
  visibility: 'public',
  ancestorPath: [],
  source: 'native',
  sourceIntegrationId: null,
  externalId: null,
  externalUrl: null,
  externalUpdatedAt: null,
};

/** Count database round trips for one aggregate request without counting its fixture setup. */
function observeDatabaseQueries(): { readonly count: () => number; readonly restore: () => void } {
  const client = Reflect.get(db, '$client') as {
    query: (...args: unknown[]) => Promise<unknown>;
  };
  const original = client.query.bind(client);
  const query = vi.fn(original);
  client.query = query;
  return {
    count: () => query.mock.calls.length,
    restore: () => {
      client.query = original;
    },
  };
}

/** Attach a persisted user identity to actors used by canonical resource-access fixtures. */
async function authenticatedSessionFor(actorIds: readonly string[]) {
  const [viewer] = await db
    .insert(schema.user)
    .values({
      name: 'Detail aggregate viewer',
      email: `detail-aggregate-${crypto.randomUUID()}@x.test`,
    })
    .returning({ id: schema.user.id });
  if (!viewer) throw new Error('detail aggregate viewer was not created');
  for (const actorId of actorIds) {
    await db.update(schema.actor).set({ userId: viewer.id }).where(eq(schema.actor.id, actorId));
  }
  return fakeSession(viewer.id);
}

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
  projects = (await import('../../src/routes/projects')).default;
  projectRollup = (await import('../../src/routes/project-rollup')).default;
  programs = (await import('../../src/routes/programs')).default;
  initiatives = (await import('../../src/routes/initiatives')).default;
});

describe('detail aggregate routes', () => {
  it('returns zero work when both bounded aggregate queries have no row', async () => {
    const client = Reflect.get(db, '$client') as {
      query: (...args: unknown[]) => Promise<unknown>;
    };
    const query = client.query;
    client.query = vi.fn().mockResolvedValue({ rows: [] });

    try {
      await expect(associatedWorkSummary('organization-row', 'initiative-row')).resolves.toEqual({
        projects: 0,
        programs: 0,
        onTrack: 0,
        atRisk: 0,
        offTrack: 0,
        unknown: 0,
      });
    } finally {
      client.query = query;
    }
  });

  it('serializes Initiative dates for the aggregate contract', () => {
    expect(
      toOut({ ...initiativeRow, targetDate: new Date('2026-12-31T00:00:00.000Z') }),
    ).toMatchObject({
      id: initiativeRow.id,
      targetDate: '2026-12-31T00:00:00.000Z',
    });
  });

  it('loads only an Initiative owned by the requested organization', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, local.orgId, ['contribute'], local.humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Crosswalk safety' }),
    });
    const item = (await created.json()) as { id: string };

    await expect(loadInitiative(local.orgId, item.id)).resolves.toMatchObject({ id: item.id });
    await expect(loadInitiative(foreign.orgId, item.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('accepts only Initiative owners inside the current organization', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);

    await expect(assertOwnerInOrg(local.orgId, null)).resolves.toBeUndefined();
    await expect(assertOwnerInOrg(local.orgId, undefined)).resolves.toBeUndefined();
    await expect(assertOwnerInOrg(local.orgId, local.humanActorId)).resolves.toBeUndefined();
    await expect(assertOwnerInOrg(local.orgId, foreign.humanActorId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('accepts only global labels owned by the current organization', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const [localLabel] = await db
      .insert(schema.label)
      .values({ organizationId: local.orgId, name: 'Safety first', color: '#7c3aed' })
      .returning({ id: schema.label.id });
    const [foreignLabel] = await db
      .insert(schema.label)
      .values({ organizationId: foreign.orgId, name: 'Foreign label', color: '#16a34a' })
      .returning({ id: schema.label.id });
    if (!localLabel || !foreignLabel) throw new Error('labels were not seeded');

    await expect(assertInitiativeLabels(local.orgId, undefined)).resolves.toEqual([]);
    await expect(
      assertInitiativeLabels(local.orgId, [localLabel.id, localLabel.id]),
    ).resolves.toEqual([localLabel.id]);
    await expect(assertInitiativeLabels(local.orgId, [foreignLabel.id])).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('projects the control bundle from the viewer capability lattice', () => {
    expect(detailCapabilities([])).toEqual({
      comment: false,
      contribute: false,
      assign: false,
      manage: false,
    });
    expect(detailCapabilities(['manage'])).toEqual({
      comment: true,
      contribute: true,
      assign: true,
      manage: true,
    });
    expect(detailCapabilities(['assign'])).toEqual({
      comment: true,
      contribute: true,
      assign: true,
      manage: false,
    });
    expect(detailCapabilities(['contribute'])).toEqual({
      comment: true,
      contribute: true,
      assign: false,
      manage: false,
    });
    expect(detailCapabilities(['comment'])).toEqual({
      comment: true,
      contribute: false,
      assign: false,
      manage: false,
    });
  });

  it.each([
    [{ offTrack: 1, atRisk: 1, onTrack: 1, unknown: 0 }, 'off_track'],
    [{ offTrack: 0, atRisk: 1, onTrack: 1, unknown: 0 }, 'at_risk'],
    [{ offTrack: 0, atRisk: 0, onTrack: 1, unknown: 0 }, 'on_track'],
    [{ offTrack: 0, atRisk: 0, onTrack: 0, unknown: 1 }, null],
  ] as const)(
    'derives the Initiative rollup health from every SQL summary state',
    (health, expected) => {
      expect(
        buildInitiativeDetailFromSummary(initiativeRow, {
          projects: 2,
          programs: 3,
          ...health,
        }),
      ).toMatchObject({
        childMix: { projects: 2, programs: 3 },
        distribution: health,
        rolledUpHealth: expected,
      });
    },
  );

  it.each([
    [[{ health: 'off_track' }], [{ health: 'on_track' }], 'off_track'],
    [[{ health: 'on_track' }, { health: null }], [{ health: 'at_risk' }], 'at_risk'],
    [[{ health: 'on_track' }], [], 'on_track'],
    [[], [{ health: null }], null],
  ] as const)(
    'derives each Initiative rollup-health outcome from child work',
    (projects, programs, rolledUpHealth) => {
      expect(buildInitiativeDetail(initiativeRow, projects, programs)).toMatchObject({
        childMix: { projects: projects.length, programs: programs.length },
        rolledUpHealth,
      });
    },
  );

  it.each([
    [{ startDate: null, targetDate: null }, undefined, undefined, true],
    [
      { startDate: new Date('2026-01-01'), targetDate: new Date('2026-01-31') },
      '2026-02-01',
      undefined,
      false,
    ],
    [
      { startDate: new Date('2026-03-01'), targetDate: new Date('2026-03-31') },
      undefined,
      '2026-02-28',
      false,
    ],
    [{ startDate: null, targetDate: new Date('2026-03-31') }, '2026-02-01', '2026-02-28', false],
    [{ startDate: new Date('2026-02-01'), targetDate: null }, '2026-02-01', '2026-02-28', true],
    [
      { startDate: new Date('2026-02-01'), targetDate: new Date('2026-02-28') },
      '2026-02-01',
      '2026-02-28',
      true,
    ],
  ] as const)(
    'keeps only Initiative Projects that overlap the requested window',
    (dates, from, to, expected) => {
      expect(projectOverlapsWindow({ ...projectRow, ...dates }, from, to)).toBe(expected);
    },
  );

  it('keeps optional Initiative owners as no-ops and rejects a foreign owner', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const [foreignActor] = await db
      .insert(schema.actor)
      .values({ organizationId: foreign.orgId, kind: 'human', displayName: 'Foreign owner' })
      .returning({ id: schema.actor.id });
    if (!foreignActor) throw new Error('foreign actor was not seeded');

    await expect(assertOwnerInOrg(local.orgId, null)).resolves.toBeUndefined();
    await expect(assertOwnerInOrg(local.orgId, undefined)).resolves.toBeUndefined();
    await expect(assertOwnerInOrg(local.orgId, foreignActor.id)).rejects.toThrow('Owner not found');
  });

  it('keeps Initiative labels workspace-scoped and removes duplicate inputs', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const [localLabel] = await db
      .insert(schema.label)
      .values({ organizationId: local.orgId, name: 'Mobility', color: '#0f766e' })
      .returning({ id: schema.label.id });
    const [foreignLabel] = await db
      .insert(schema.label)
      .values({ organizationId: foreign.orgId, name: 'Foreign', color: '#dc2626' })
      .returning({ id: schema.label.id });
    if (!localLabel || !foreignLabel) throw new Error('labels were not seeded');

    await expect(assertInitiativeLabels(local.orgId, undefined)).resolves.toEqual([]);
    await expect(assertInitiativeLabels(local.orgId, [])).resolves.toEqual([]);
    await expect(
      assertInitiativeLabels(local.orgId, [localLabel.id, localLabel.id]),
    ).resolves.toEqual([localLabel.id]);
    await expect(assertInitiativeLabels(local.orgId, [foreignLabel.id])).rejects.toThrow(
      'Label not found',
    );
  });

  it('returns one bounded Task detail aggregate with its local snapshot and no org roster', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Publish rider guide', teamId }),
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string };

    const relatedResponse = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Review rider feedback',
        teamId,
        relatedTaskIds: [task.id],
      }),
    });
    expect(relatedResponse.status).toBe(201);
    const relatedTask = (await relatedResponse.json()) as { id: string };

    const response = await writer.request(`/${task.id}/aggregate-detail`);
    expect(response.status).toBe(200);
    const aggregateResponse = (await response.json()) as {
      defaultView: { task: { relatedTasks: unknown[] } };
    };
    expect(aggregateResponse).toMatchObject({
      target: 'task',
      snapshot: {
        target: 'task',
        id: task.id,
        organizationId: orgId,
        title: 'Publish rider guide',
      },
      viewer: { actorId: humanActorId },
      capabilities: { comment: true, contribute: true, assign: false, manage: false },
      defaultView: { task: { id: task.id } },
    });

    expect(aggregateResponse).toMatchObject({
      defaultView: { task: { relatedTasks: [{ id: relatedTask.id }] } },
    });

    const body = await writer.request(`/${task.id}/aggregate-detail`);
    const aggregate = (await body.json()) as Record<string, unknown>;
    expect(aggregate).not.toHaveProperty('members');
    expect(aggregate).not.toHaveProperty('projects');
    expect(aggregate).not.toHaveProperty('programs');
    expect(aggregate).not.toHaveProperty('roles');
    expect(aggregate).toHaveProperty('references.workflowStates');
  });

  it('rejects a malformed aggregate identifier before any detail query starts', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(tasks, orgId, ['view'], humanActorId);

    expect((await reader.request('/not-a-task-id/aggregate-detail')).status).toBe(422);
  });

  it('returns one bounded Project detail aggregate with visible references only', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bus buddies pilot', teamId, leadId: humanActorId }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string };

    const response = await writer.request(`/${project.id}/aggregate-detail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      target: 'project',
      snapshot: { target: 'project', id: project.id, organizationId: orgId },
      viewer: { actorId: humanActorId },
      capabilities: { comment: true, contribute: true, assign: false, manage: false },
      references: { team: { id: teamId }, lead: { actorId: humanActorId } },
      defaultView: { project: { id: project.id }, progress: { taskCount: 0 } },
    });
  });

  it('serializes Project progress when postgres-js returns aggregate numerics as text', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Postgres aggregate project', teamId }),
    });
    const project = (await created.json()) as { id: string };
    const client = Reflect.get(db, '$client') as {
      query: (
        query: string,
        params?: unknown[],
        options?: unknown,
      ) => Promise<{ rows?: Record<string, unknown>[] }>;
    };
    const original = client.query.bind(client);
    client.query = async (...args) => {
      const result = await original(...args);
      if (args[0].includes('count(*) filter')) {
        for (const row of result.rows ?? []) {
          for (const [key, value] of Object.entries(row)) {
            if (typeof value === 'number') row[key] = String(value);
          }
        }
      }
      return result;
    };

    try {
      const response = await writer.request(`/${project.id}/aggregate-detail`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        defaultView: {
          progress: {
            percent: 0,
            completedWeight: 0,
            totalWeight: 0,
            taskCount: 0,
            completedCount: 0,
          },
        },
      });
    } finally {
      client.query = original;
    }
  });

  it('keeps Project work rows out of the aggregate and returns them only from the deferred section', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Deferred work', teamId }),
    });
    const project = (await created.json()) as { id: string };
    const aggregate = (await writer.request(`/${project.id}/aggregate-detail`)).json() as Promise<
      Record<string, unknown>
    >;
    expect(await aggregate).not.toHaveProperty('tasks');
    const work = await appWithActor(projectRollup, orgId, ['contribute'], humanActorId).request(
      `/${project.id}/work`,
    );
    expect(work.status).toBe(200);
    expect(await work.json()).toMatchObject({ milestones: [], tasks: [], taskMilestones: [] });
  });

  it('returns one bounded Program detail aggregate with its rollup', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const manager = appWithActor(programs, orgId, ['manage'], humanActorId);
    const created = await manager.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Service operations', ownerId: humanActorId }),
    });
    expect(created.status).toBe(201);
    const program = (await created.json()) as { id: string };

    const response = await manager.request(`/${program.id}/aggregate-detail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      target: 'program',
      snapshot: { target: 'program', id: program.id, organizationId: orgId },
      viewer: { actorId: humanActorId },
      capabilities: { comment: true, contribute: true, assign: true, manage: true },
      references: { owner: { actorId: humanActorId } },
      defaultView: { program: { id: program.id, rollup: { projects: 0, tasks: 0 } } },
    });
  });

  it('excludes archived Projects and their Tasks from the Program aggregate rollup', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const manager = appWithActor(programs, orgId, ['manage'], humanActorId);
    const program = await seedProgram(db, schema, statusId, {
      organizationId: orgId,
      name: 'Service delivery',
      createdBy: humanActorId,
    });
    const activeProject = await seedProject(db, schema, statusId, {
      organizationId: orgId,
      name: 'Active service project',
      teamId,
      programId: program.id,
      createdBy: humanActorId,
    });
    const archivedProject = await seedProject(db, schema, statusId, {
      organizationId: orgId,
      name: 'Archived service project',
      teamId,
      programId: program.id,
      archivedAt: new Date('2026-08-24T12:00:00.000Z'),
      createdBy: humanActorId,
    });
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Active Project task',
      state: 'backlog',
      projectId: activeProject.id,
    });
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Archived Project task',
      state: 'backlog',
      projectId: archivedProject.id,
    });
    await seedTask(db, schema, statusId, {
      organizationId: orgId,
      teamId,
      title: 'Direct Program task',
      state: 'backlog',
      programId: program.id,
    });

    const response = await manager.request(`/${program.id}/aggregate-detail`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      defaultView: { program: { rollup: { projects: 1, tasks: 2 } } },
    });
  });

  it('returns one bounded Initiative detail aggregate without loading optional sections', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId, session);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Improve bus service', ownerId: humanActorId }),
    });
    expect(created.status).toBe(201);
    const initiative = (await created.json()) as { id: string };

    const response = await writer.request(`/${initiative.id}/aggregate-detail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      target: 'initiative',
      snapshot: { target: 'initiative', id: initiative.id, organizationId: orgId },
      viewer: { actorId: humanActorId },
      capabilities: { comment: true, contribute: true, assign: false, manage: false },
      references: { owner: { actorId: humanActorId } },
      defaultView: {
        initiative: { id: initiative.id, childMix: { programs: 0, projects: 0 } },
      },
    });

    const labels = await writer.request(`/${initiative.id}/labels`);
    expect(labels.status).toBe(200);
    expect(await labels.json()).toEqual([]);

    const relationships = await writer.request(`/${initiative.id}/relationships`);
    expect(relationships.status).toBe(200);
    const relationshipBody = (await relationships.json()) as Record<string, unknown>;
    expect(relationshipBody).toMatchObject({
      contextOrganizationId: orgId,
      parent: null,
      children: [],
      connectedWork: [],
      truncated: false,
    });
    expect(relationshipBody).not.toHaveProperty('labels');
    expect(relationshipBody).not.toHaveProperty('resources');
    expect(relationshipBody).not.toHaveProperty('latestUpdate');
  });

  it('reveals a cross-workspace Initiative parent only after the viewer joins that workspace', async () => {
    const local = await seedBaseOrg(db, schema);
    const hidden = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([local.humanActorId]);
    if (!session) throw new Error('detail aggregate viewer session was not created');
    const reader = appWithActor(initiatives, local.orgId, ['view'], local.humanActorId, session);
    const [hiddenParent, localChild] = await Promise.all([
      seedInitiative(db, schema, hidden.statusId, {
        organizationId: hidden.orgId,
        name: 'Hidden aggregate parent',
        createdBy: hidden.humanActorId,
      }),
      seedInitiative(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Local aggregate child',
        createdBy: local.humanActorId,
      }),
    ]);
    await db.insert(schema.initiativeHierarchyLink).values({
      contextOrganizationId: local.orgId,
      parentInitiativeId: hiddenParent.id,
      childInitiativeId: localChild.id,
      createdBy: local.humanActorId,
    });

    expect((await reader.request(`/${localChild.id}/aggregate-detail`)).status).toBe(404);

    await db
      .update(schema.actor)
      .set({ userId: session.user.id })
      .where(eq(schema.actor.id, hidden.humanActorId));

    const visible = await reader.request(`/${localChild.id}/aggregate-detail`);
    expect(visible.status).toBe(200);
    expect(await visible.json()).toMatchObject({
      references: {
        parent: {
          id: hiddenParent.id,
          organizationId: hidden.orgId,
          name: 'Hidden aggregate parent',
        },
      },
    });
  });

  it('counts only visible organization-owned work in an Initiative aggregate', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([local.humanActorId]);
    const reader = appWithActor(initiatives, local.orgId, ['view'], local.humanActorId, session);
    const target = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Authorized aggregate work',
      createdBy: local.humanActorId,
    });
    const [
      publicProject,
      privateProject,
      foreignProject,
      publicProgram,
      privateProgram,
      foreignProgram,
    ] = await Promise.all([
      seedProject(db, schema, local.statusId, {
        organizationId: local.orgId,
        teamId: local.teamId,
        name: 'Visible aggregate Project',
        health: 'on_track',
        visibility: 'public',
        createdBy: local.humanActorId,
      }),
      seedProject(db, schema, local.statusId, {
        organizationId: local.orgId,
        teamId: local.teamId,
        name: 'Private aggregate Project',
        health: 'off_track',
        visibility: 'private',
        createdBy: local.humanActorId,
      }),
      seedProject(db, schema, foreign.statusId, {
        organizationId: foreign.orgId,
        teamId: foreign.teamId,
        name: 'Corrupt foreign aggregate Project',
        health: 'off_track',
        visibility: 'public',
        createdBy: foreign.humanActorId,
      }),
      seedProgram(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Visible aggregate Program',
        health: 'at_risk',
        visibility: 'public',
        createdBy: local.humanActorId,
      }),
      seedProgram(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Private aggregate Program',
        health: 'off_track',
        visibility: 'private',
        createdBy: local.humanActorId,
      }),
      seedProgram(db, schema, foreign.statusId, {
        organizationId: foreign.orgId,
        name: 'Corrupt foreign aggregate Program',
        health: 'off_track',
        visibility: 'public',
        createdBy: foreign.humanActorId,
      }),
    ]);
    await db.insert(schema.initiativeProject).values(
      [publicProject, privateProject, foreignProject].map((row) => ({
        initiativeId: target.id,
        projectId: row.id,
        organizationId: local.orgId,
      })),
    );
    await db.insert(schema.initiativeProgram).values(
      [publicProgram, privateProgram, foreignProgram].map((row) => ({
        initiativeId: target.id,
        programId: row.id,
        organizationId: local.orgId,
      })),
    );

    const response = await reader.request(`/${target.id}/aggregate-detail`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      defaultView: {
        initiative: {
          childMix: { programs: 1, projects: 1 },
          distribution: { onTrack: 1, atRisk: 1, offTrack: 0, unknown: 0 },
          rolledUpHealth: 'at_risk',
        },
      },
    });
  });

  it('returns core detail for an accessible nested Initiative and its descendants', async () => {
    const local = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([local.humanActorId]);
    const reader = appWithActor(initiatives, local.orgId, ['view'], local.humanActorId, session);
    const [root, target, descendant] = await Promise.all(
      ['Nested root', 'Nested target', 'Nested descendant'].map((name) =>
        seedInitiative(db, schema, local.statusId, {
          organizationId: local.orgId,
          name,
          createdBy: local.humanActorId,
        }),
      ),
    );
    if (!root || !target || !descendant) throw new Error('nested detail fixture was not created');
    const project = await seedProject(db, schema, local.statusId, {
      organizationId: local.orgId,
      teamId: local.teamId,
      name: 'Nested descendant Project',
      health: 'off_track',
      createdBy: local.humanActorId,
    });
    await db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: local.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: target.id,
        createdBy: local.humanActorId,
      },
      {
        contextOrganizationId: local.orgId,
        parentInitiativeId: target.id,
        childInitiativeId: descendant.id,
        createdBy: local.humanActorId,
      },
    ]);
    await db.insert(schema.initiativeProject).values({
      initiativeId: descendant.id,
      projectId: project.id,
      organizationId: local.orgId,
    });

    const response = await reader.request(`/${target.id}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: target.id,
      childMix: { programs: 0, projects: 1 },
      rolledUpHealth: 'off_track',
    });
  });

  it('keeps an Initiative aggregate usable when it has no owner', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId, session);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ownerless Initiative' }),
    });
    const item = (await created.json()) as { id: string };

    const aggregate = await writer.request(`/${item.id}/aggregate-detail`);
    expect(aggregate.status).toBe(200);
    expect(await aggregate.json()).toMatchObject({ references: { owner: null } });
  });

  it('includes only a visible direct parent in the initial Initiative aggregate', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(initiatives, orgId, ['view'], humanActorId);
    const parent = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Transit access',
      createdBy: humanActorId,
    });
    const child = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Bus lanes',
      createdBy: humanActorId,
    });
    const [link] = await db
      .insert(schema.initiativeHierarchyLink)
      .values({
        contextOrganizationId: orgId,
        parentInitiativeId: parent.id,
        childInitiativeId: child.id,
        createdBy: humanActorId,
      })
      .returning({ id: schema.initiativeHierarchyLink.id });

    const childAggregate = await reader.request(`/${child.id}/aggregate-detail`);
    expect(childAggregate.status).toBe(200);
    expect(await childAggregate.json()).toMatchObject({
      references: {
        parent: { id: parent.id, organizationId: orgId, name: 'Transit access' },
        parentLinkId: link?.id,
      },
    });

    const rootAggregate = await reader.request(`/${parent.id}/aggregate-detail`);
    expect(await rootAggregate.json()).toMatchObject({
      references: { parent: null, parentLinkId: null },
    });
  });

  it('serializes Initiative health counts when postgres-js returns numerics as text', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId, session);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Postgres aggregate Initiative' }),
    });
    const initiative = (await created.json()) as { id: string };
    const client = Reflect.get(db, '$client') as {
      query: (
        query: string,
        params?: unknown[],
        options?: unknown,
      ) => Promise<{ rows?: Record<string, unknown>[] }>;
    };
    const original = client.query.bind(client);
    client.query = async (...args) => {
      const result = await original(...args);
      if (args[0].includes('count(*) filter')) {
        for (const row of result.rows ?? []) {
          for (const [key, value] of Object.entries(row)) {
            if (typeof value === 'number') row[key] = String(value);
          }
        }
      }
      return result;
    };

    try {
      const response = await writer.request(`/${initiative.id}/aggregate-detail`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        defaultView: {
          initiative: {
            childMix: { programs: 0, projects: 0 },
            distribution: { atRisk: 0, offTrack: 0, onTrack: 0, unknown: 0 },
          },
        },
      });
    } finally {
      client.query = original;
    }
  });

  it('does not expose a foreign label through a corrupt Initiative-label association', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, local.orgId, ['contribute'], local.humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Local Initiative' }),
    });
    const initiative = (await created.json()) as { id: string };
    const [foreignLabel] = await db
      .insert(schema.label)
      .values({ organizationId: foreign.orgId, name: 'Foreign label', color: '#7c3aed' })
      .returning({ id: schema.label.id });
    if (!foreignLabel) throw new Error('foreign label was not seeded');
    await db.insert(schema.initiativeLabel).values({
      initiativeId: initiative.id,
      labelId: foreignLabel.id,
      organizationId: foreign.orgId,
    });

    const labels = await writer.request(`/${initiative.id}/labels`);
    expect(labels.status).toBe(200);
    expect(await labels.json()).toEqual([]);
  });

  it('loads hierarchy and connected work only after the Initiative relationship section opens', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const initiativeWriter = appWithActor(
      initiatives,
      orgId,
      ['contribute'],
      humanActorId,
      session,
    );
    const manager = appWithActor(programs, orgId, ['manage'], humanActorId);
    const projectWriter = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const [rootResponse, childResponse, programResponse, projectResponse] = await Promise.all([
      initiativeWriter.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Transit access' }),
      }),
      initiativeWriter.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Bus stop safety' }),
      }),
      manager.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Street operations', ownerId: humanActorId }),
      }),
      projectWriter.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Shelter audit', teamId }),
      }),
    ]);
    const [root, child, program, project] = (await Promise.all([
      rootResponse.json(),
      childResponse.json(),
      programResponse.json(),
      projectResponse.json(),
    ])) as { id: string }[];
    if (!root || !child || !program || !project)
      throw new Error('relationship fixture was not created');

    expect(
      (
        await initiativeWriter.request('/hierarchy-links', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentInitiativeId: root.id, childInitiativeId: child.id }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await initiativeWriter.request(`/${child.id}/programs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ programId: program.id }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await initiativeWriter.request(`/${root.id}/projects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: project.id }),
        })
      ).status,
    ).toBe(201);

    const rootRelationships = await initiativeWriter.request(`/${root.id}/relationships`);
    expect(rootRelationships.status).toBe(200);
    const rootRelationshipBody = (await rootRelationships.json()) as {
      parent: unknown;
      children: unknown[];
      connectedWork: unknown[];
      truncated: boolean;
    };
    expect(rootRelationshipBody).toMatchObject({
      parent: null,
      children: [{ id: child.id, parentInitiativeId: root.id, crossWorkspace: false }],
      truncated: false,
    });
    expect(rootRelationshipBody.connectedWork).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: project.id,
          kind: 'project',
          direct: true,
          inheritedThroughInitiativeId: null,
        }),
        expect.objectContaining({
          id: program.id,
          kind: 'program',
          direct: false,
          inheritedThroughInitiativeId: child.id,
        }),
      ]),
    );

    const childRelationships = await initiativeWriter.request(`/${child.id}/relationships`);
    expect(childRelationships.status).toBe(200);
    expect(await childRelationships.json()).toMatchObject({
      parent: { id: root.id, crossWorkspace: false },
      children: [],
      connectedWork: [{ id: program.id, kind: 'program', direct: true }],
      truncated: false,
    });
  });

  it('deduplicates inherited Program and Project work shared by sibling Initiatives', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const initiativeWriter = appWithActor(
      initiatives,
      orgId,
      ['contribute'],
      humanActorId,
      session,
    );
    const programWriter = appWithActor(programs, orgId, ['manage'], humanActorId);
    const projectWriter = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const [rootResponse, firstResponse, secondResponse, programResponse, projectResponse] =
      await Promise.all([
        initiativeWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Root Initiative' }),
        }),
        initiativeWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'First child Initiative' }),
        }),
        initiativeWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Second child Initiative' }),
        }),
        programWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Shared Program', ownerId: humanActorId }),
        }),
        projectWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Shared Project', teamId }),
        }),
      ]);
    const [root, first, second, program, project] = (await Promise.all([
      rootResponse.json(),
      firstResponse.json(),
      secondResponse.json(),
      programResponse.json(),
      projectResponse.json(),
    ])) as { id: string }[];
    if (!root || !first || !second || !program || !project) {
      throw new Error('shared-work fixture was not created');
    }

    for (const child of [first, second]) {
      expect(
        (
          await initiativeWriter.request('/hierarchy-links', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parentInitiativeId: root.id, childInitiativeId: child.id }),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await initiativeWriter.request(`/${child.id}/programs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ programId: program.id }),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await initiativeWriter.request(`/${child.id}/projects`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectId: project.id }),
          })
        ).status,
      ).toBe(201);
    }

    const relationships = await initiativeWriter.request(`/${root.id}/relationships`);
    expect(relationships.status).toBe(200);
    const body = (await relationships.json()) as {
      connectedWork: { id: string; kind: string; direct: boolean }[];
    };
    expect(body.connectedWork.filter((item) => item.id === program.id)).toEqual([
      expect.objectContaining({ kind: 'program', direct: false }),
    ]);
    expect(body.connectedWork.filter((item) => item.id === project.id)).toEqual([
      expect.objectContaining({ kind: 'project', direct: false }),
    ]);
  });

  it('walks nested Initiative work while suppressing corrupt foreign associations', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([local.humanActorId]);
    const initiativeWriter = appWithActor(
      initiatives,
      local.orgId,
      ['contribute'],
      local.humanActorId,
      session,
    );
    const foreignProgramWriter = appWithActor(
      programs,
      foreign.orgId,
      ['manage'],
      foreign.humanActorId,
    );
    const foreignProjectWriter = appWithActor(
      projects,
      foreign.orgId,
      ['contribute'],
      foreign.humanActorId,
    );
    const [rootResponse, middleResponse, leafResponse, programResponse, projectResponse] =
      await Promise.all([
        initiativeWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Hierarchy root' }),
        }),
        initiativeWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Hierarchy middle' }),
        }),
        initiativeWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Hierarchy leaf' }),
        }),
        foreignProgramWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Foreign Program', ownerId: foreign.humanActorId }),
        }),
        foreignProjectWriter.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Foreign Project', teamId: foreign.teamId }),
        }),
      ]);
    const [root, middle, leaf, foreignProgram, foreignProject] = (await Promise.all([
      rootResponse.json(),
      middleResponse.json(),
      leafResponse.json(),
      programResponse.json(),
      projectResponse.json(),
    ])) as { id: string }[];
    if (!root || !middle || !leaf || !foreignProgram || !foreignProject) {
      throw new Error('nested hierarchy fixture was not created');
    }

    await db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: local.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: middle.id,
        createdBy: local.humanActorId,
      },
      {
        contextOrganizationId: local.orgId,
        parentInitiativeId: middle.id,
        childInitiativeId: leaf.id,
        createdBy: local.humanActorId,
      },
    ]);
    await db.insert(schema.initiativeProgram).values({
      initiativeId: root.id,
      programId: foreignProgram.id,
      organizationId: local.orgId,
    });
    await db.insert(schema.initiativeProject).values({
      initiativeId: root.id,
      projectId: foreignProject.id,
      organizationId: local.orgId,
    });

    const relationships = await initiativeWriter.request(`/${root.id}/relationships`);
    expect(relationships.status).toBe(200);
    expect(await relationships.json()).toMatchObject({
      children: [{ id: middle.id }],
      connectedWork: [],
      truncated: false,
    });
  });

  it('shows a cross-workspace Initiative only to a viewer who belongs to both workspaces', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const localWriter = appWithActor(initiatives, local.orgId, ['contribute'], local.humanActorId);
    const foreignWriter = appWithActor(
      initiatives,
      foreign.orgId,
      ['contribute'],
      foreign.humanActorId,
    );
    const [rootResponse, childResponse] = await Promise.all([
      localWriter.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Local Initiative' }),
      }),
      foreignWriter.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Foreign Initiative' }),
      }),
    ]);
    const [root, child] = (await Promise.all([rootResponse.json(), childResponse.json()])) as {
      id: string;
    }[];
    if (!root || !child) throw new Error('cross-workspace hierarchy fixture was not created');
    const [viewerUser] = await db
      .insert(schema.user)
      .values({ name: 'Cross-workspace viewer', email: 'cross-workspace-viewer@example.com' })
      .returning({ id: schema.user.id });
    if (!viewerUser) throw new Error('cross-workspace viewer was not created');
    await db
      .update(schema.actor)
      .set({ userId: viewerUser.id })
      .where(eq(schema.actor.id, local.humanActorId));
    await db
      .update(schema.actor)
      .set({ userId: viewerUser.id })
      .where(eq(schema.actor.id, foreign.humanActorId));
    await db.insert(schema.initiativeHierarchyLink).values({
      contextOrganizationId: local.orgId,
      parentInitiativeId: root.id,
      childInitiativeId: child.id,
      createdBy: local.humanActorId,
    });

    const viewer = appWithActor(
      initiatives,
      local.orgId,
      ['view'],
      local.humanActorId,
      fakeSession(viewerUser.id),
    );
    const relationships = await viewer.request(`/${child.id}/relationships`);
    expect(relationships.status).toBe(200);
    expect(await relationships.json()).toMatchObject({
      contextOrganizationId: local.orgId,
      parent: { id: root.id, crossWorkspace: false },
      children: [],
    });
  });

  it('reports a missing deferred Initiative relationship section as not found', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(initiatives, orgId, ['view'], humanActorId);

    expect((await reader.request('/01ARZ3NDEKTSV4RRFFQ69G5FAV/relationships')).status).toBe(404);
  });

  it('bounds an expanded Initiative hierarchy instead of returning every descendant', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId, session);
    const rootResponse = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bounded hierarchy root' }),
    });
    const root = (await rootResponse.json()) as { id: string };
    const statusId = await seedStatuses(db, schema, orgId);
    const children = await db
      .insert(schema.initiative)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          organizationId: orgId,
          name: `Bounded child ${index}`,
          createdBy: humanActorId,
          status: 'active' as const,
          statusId: statusId('initiative', 'active'),
        })),
      )
      .returning({ id: schema.initiative.id });
    await db.insert(schema.initiativeHierarchyLink).values(
      children.map((child) => ({
        contextOrganizationId: orgId,
        parentInitiativeId: root.id,
        childInitiativeId: child.id,
        createdBy: humanActorId,
      })),
    );

    const response = await writer.request(`/${root.id}/relationships`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { children: { id: string }[]; truncated: boolean };
    expect(body).toMatchObject({ truncated: true });
    expect(body.children).toHaveLength(100);
    const childIds = new Set(children.map((child) => child.id));
    expect(body.children.every((child) => childIds.has(child.id))).toBe(true);
  });

  it('bounds connected work and rejects rootless cyclic Initiative hierarchy data', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const reader = appWithActor(initiatives, orgId, ['view'], humanActorId, session);
    const root = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Bounded connected work',
      createdBy: humanActorId,
    });
    const firstChild = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'First connected-work child',
      createdBy: humanActorId,
    });
    const secondChild = await seedInitiative(db, schema, statusId, {
      organizationId: orgId,
      name: 'Second connected-work child',
      createdBy: humanActorId,
    });
    await db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: orgId,
        parentInitiativeId: root.id,
        childInitiativeId: firstChild.id,
        createdBy: humanActorId,
      },
      {
        contextOrganizationId: orgId,
        parentInitiativeId: root.id,
        childInitiativeId: secondChild.id,
        createdBy: humanActorId,
      },
    ]);
    const programRows = await db
      .insert(schema.program)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          organizationId: orgId,
          name: `Bounded program ${index}`,
          status: 'active' as const,
          statusId: statusId('program', 'active'),
          createdBy: humanActorId,
        })),
      )
      .returning();
    const projectRows = await db
      .insert(schema.project)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          organizationId: orgId,
          name: `Bounded project ${index}`,
          status: 'planned' as const,
          statusId: statusId('project', 'planned'),
          createdBy: humanActorId,
        })),
      )
      .returning();
    const sharedProgram = programRows[0];
    const sharedProject = projectRows[0];
    if (!sharedProgram || !sharedProject)
      throw new Error('connected-work fixtures were not created');
    await db.insert(schema.initiativeProgram).values([
      ...programRows.slice(1).map((program) => ({
        initiativeId: root.id,
        programId: program.id,
        organizationId: orgId,
      })),
      {
        initiativeId: firstChild.id,
        programId: sharedProgram.id,
        organizationId: orgId,
      },
      {
        initiativeId: secondChild.id,
        programId: sharedProgram.id,
        organizationId: orgId,
      },
    ]);
    await db.insert(schema.initiativeProject).values([
      ...projectRows.slice(1).map((project) => ({
        initiativeId: root.id,
        projectId: project.id,
        organizationId: orgId,
      })),
      {
        initiativeId: firstChild.id,
        projectId: sharedProject.id,
        organizationId: orgId,
      },
      {
        initiativeId: secondChild.id,
        projectId: sharedProject.id,
        organizationId: orgId,
      },
    ]);

    const boundedResponse = await reader.request(`/${root.id}/relationships`);
    expect(boundedResponse.status).toBe(200);
    const bounded = (await boundedResponse.json()) as {
      connectedWork: unknown[];
      truncated: boolean;
    };
    expect(bounded.truncated).toBe(true);
    expect(bounded.connectedWork).toHaveLength(100);
    expect(await (await reader.request(`/${root.id}/aggregate-detail`)).json()).toMatchObject({
      references: { owner: null },
    });

    const cycleNodes = await db
      .insert(schema.initiative)
      .values(
        ['Cycle root', 'Cycle child', 'Cycle grandchild'].map((name) => ({
          organizationId: orgId,
          name,
          status: 'active' as const,
          statusId: statusId('initiative', 'active'),
          createdBy: humanActorId,
        })),
      )
      .returning();
    const [cycleRoot, cycleChild, cycleGrandchild] = cycleNodes;
    if (!cycleRoot || !cycleChild || !cycleGrandchild)
      throw new Error('cyclic hierarchy fixtures were not created');
    await db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: orgId,
        parentInitiativeId: cycleRoot.id,
        childInitiativeId: cycleChild.id,
        createdBy: humanActorId,
      },
      {
        contextOrganizationId: orgId,
        parentInitiativeId: cycleChild.id,
        childInitiativeId: cycleGrandchild.id,
        createdBy: humanActorId,
      },
      {
        contextOrganizationId: orgId,
        parentInitiativeId: cycleGrandchild.id,
        childInitiativeId: cycleRoot.id,
        createdBy: humanActorId,
      },
    ]);
    // A cycle has no route-owned root. Treating one node as a root would disclose a projection
    // that the stored hierarchy does not contain and would make the chosen fake root arbitrary.
    expect((await reader.request(`/${cycleRoot.id}/relationships`)).status).toBe(404);
    expect((await reader.request(`/${cycleRoot.id}`)).status).toBe(404);
    expect((await reader.request(`/${cycleRoot.id}/timeline`)).status).toBe(404);
  });

  it('covers Initiative association, hierarchy mutation, and tenant-filter branches', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([local.humanActorId]);
    const writer = appWithActor(
      initiatives,
      local.orgId,
      ['view', 'contribute', 'manage'],
      local.humanActorId,
      session,
    );
    const firstParent = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'First parent',
      createdBy: local.humanActorId,
    });
    const secondParent = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Second parent',
      createdBy: local.humanActorId,
    });
    const child = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Movable child',
      createdBy: local.humanActorId,
    });
    const foreignChild = await seedInitiative(db, schema, foreign.statusId, {
      organizationId: foreign.orgId,
      name: 'Foreign child',
      createdBy: foreign.humanActorId,
    });
    const project = await seedProject(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Linked project',
      createdBy: local.humanActorId,
    });
    const program = await seedProgram(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Linked program',
      createdBy: local.humanActorId,
    });
    const missingId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

    expect(
      (
        await writer.request(`/${firstParent.id}/projects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: missingId }),
        })
      ).status,
    ).toBe(404);
    const linkProject = () =>
      writer.request(`/${firstParent.id}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
    expect((await linkProject()).status).toBe(201);
    expect((await linkProject()).status).toBe(409);
    expect(
      (
        await writer.request(`/${firstParent.id}/projects/${project.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await writer.request(`/${firstParent.id}/projects/${project.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);

    expect(
      (
        await writer.request(`/${firstParent.id}/programs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ programId: missingId }),
        })
      ).status,
    ).toBe(404);
    const linkProgram = () =>
      writer.request(`/${firstParent.id}/programs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ programId: program.id }),
      });
    expect((await linkProgram()).status).toBe(201);
    expect((await linkProgram()).status).toBe(409);
    expect(
      (
        await writer.request(`/${firstParent.id}/programs/${program.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await writer.request(`/${firstParent.id}/programs/${program.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);

    const linkedResponse = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parentInitiativeId: firstParent.id,
        childInitiativeId: child.id,
      }),
    });
    expect(linkedResponse.status).toBe(201);
    const link = (await linkedResponse.json()) as { id: string };
    expect(
      (
        await writer.request(`/hierarchy-links/${link.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentInitiativeId: secondParent.id }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await writer.request(`/hierarchy-links/${missingId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentInitiativeId: firstParent.id }),
        })
      ).status,
    ).toBe(404);
    expect((await writer.request(`/hierarchy-links/${link.id}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect((await writer.request(`/hierarchy-links/${link.id}`, { method: 'DELETE' })).status).toBe(
      404,
    );

    expect(
      (
        await writer.request(`/${firstParent.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leadTeamId: local.teamId, health: null }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await writer.request(`/${firstParent.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leadTeamId: missingId }),
        })
      ).status,
    ).toBe(404);

    await db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: local.orgId,
        parentInitiativeId: firstParent.id,
        childInitiativeId: child.id,
        createdBy: local.humanActorId,
      },
      {
        contextOrganizationId: local.orgId,
        parentInitiativeId: secondParent.id,
        childInitiativeId: foreignChild.id,
        createdBy: local.humanActorId,
      },
    ]);
    expect((await writer.request(`/${secondParent.id}/timeline`)).status).toBe(200);
    expect((await writer.request(`/${firstParent.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await writer.request(`/${child.id}`)).status).toBe(200);
  });

  it('settles each initial aggregate within its bounded database-read budget', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const session = await authenticatedSessionFor([humanActorId]);
    const taskWriter = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const projectWriter = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const manager = appWithActor(programs, orgId, ['manage'], humanActorId);
    const initiativeWriter = appWithActor(
      initiatives,
      orgId,
      ['contribute'],
      humanActorId,
      session,
    );
    const taskResponse = await taskWriter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Bounded query task', teamId }),
    });
    const projectResponse = await projectWriter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bounded query project', teamId }),
    });
    const programResponse = await manager.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bounded query program', ownerId: humanActorId }),
    });
    const initiativeResponse = await initiativeWriter.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bounded query initiative', ownerId: humanActorId }),
    });
    const [taskResult, projectResult, programResult, initiativeResult] = [
      (await taskResponse.json()) as { id: string },
      (await projectResponse.json()) as { id: string },
      (await programResponse.json()) as { id: string },
      (await initiativeResponse.json()) as { id: string },
    ] as const;
    const cases = [
      ['Task', taskWriter, `/${taskResult.id}/aggregate-detail`],
      ['Project', projectWriter, `/${projectResult.id}/aggregate-detail`],
      ['Program', manager, `/${programResult.id}/aggregate-detail`],
      ['Initiative', initiativeWriter, `/${initiativeResult.id}/aggregate-detail`],
    ] as const;

    for (const [target, app, path] of cases) {
      const observed = observeDatabaseQueries();
      try {
        expect((await app.request(path)).status).toBe(200);
        expect(observed.count(), `${target} must issue database reads`).toBeGreaterThan(0);
        // Initiative uses complete graph authorization plus two compact empty-work aggregates.
        // Eight reads is the explicit bound for that canonical path.
        const maximumReads = target === 'Initiative' ? 8 : 4;
        expect(
          observed.count(),
          `${target} exceeded its ${maximumReads}-read budget`,
        ).toBeLessThanOrEqual(maximumReads);
      } finally {
        observed.restore();
      }
    }
  });
});
