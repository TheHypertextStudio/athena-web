import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type tasksRouter from '../../src/routes/tasks';
import type projectsRouter from '../../src/routes/projects';
import type projectRollupRouter from '../../src/routes/project-rollup';
import type programsRouter from '../../src/routes/programs';
import type initiativesRouter from '../../src/routes/initiatives';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;
let projects!: typeof projectsRouter;
let projectRollup!: typeof projectRollupRouter;
let programs!: typeof programsRouter;
let initiatives!: typeof initiativesRouter;

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
});
