import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type tasksRouter from '../../src/routes/tasks';
import type projectsRouter from '../../src/routes/projects';
import type projectRollupRouter from '../../src/routes/project-rollup';
import type programsRouter from '../../src/routes/programs';
import type initiativesRouter from '../../src/routes/initiatives';
import { detailCapabilities } from '../../src/lib/detail-capabilities';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;
let projects!: typeof projectsRouter;
let projectRollup!: typeof projectRollupRouter;
let programs!: typeof programsRouter;
let initiatives!: typeof initiativesRouter;

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
  });

  it('returns one bounded Task detail aggregate with its local snapshot and no org roster', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Publish rider guide', teamId }),
    });
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string };

    const response = await writer.request(`/${task.id}/aggregate-detail`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
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

  it('returns one bounded Initiative detail aggregate without loading optional sections', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
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
    const initiativeWriter = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
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

  it('settles each initial aggregate within four database round trips', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const taskWriter = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const projectWriter = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const manager = appWithActor(programs, orgId, ['manage'], humanActorId);
    const initiativeWriter = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
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
        expect(observed.count(), `${target} exceeded the four-read budget`).toBeLessThanOrEqual(4);
      } finally {
        observed.restore();
      }
    }
  });
});
