import { WorkViewFacetResponse } from '@docket/work/work-view-contract';
import { describe, expect, it } from 'vitest';

import { appWithActor, seedBaseOrg } from '../support/routes-harness';
import { projectRequest, taskRequest } from '../work-views/request-fixtures';
import {
  grantOrganizationCapability,
  initiativeRequest,
  JSON_HEADERS,
  schema,
  workViews,
} from './work-views-harness';

type SeededOrg = Awaited<ReturnType<typeof seedBaseOrg>>;
type FacetApp = ReturnType<typeof appWithActor>;
type FacetBucket = WorkViewFacetResponse['buckets'][number];

/** A seeded organization with a viewer app mounted on the work-view routes. */
interface ViewerFixture extends SeededOrg {
  readonly app: FacetApp;
}

/** Optional per-request facet inputs layered on the default Task view. */
interface TaskFacetOptions {
  readonly filter?: unknown;
  readonly search?: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

async function viewerFixture(): Promise<ViewerFixture> {
  const seeded = await seedBaseOrg(schema.db, schema);
  await grantOrganizationCapability(seeded.orgId, seeded.humanActorId, 'contribute');
  return { ...seeded, app: appWithActor(workViews, seeded.orgId, ['view'], seeded.humanActorId) };
}

async function requestFacets(app: FacetApp, body: Record<string, unknown>): Promise<Response> {
  return app.request('/facets', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ temporaryFilter: null, context: { kind: 'organization' }, ...body }),
  });
}

function taskFacetBody(field: string, options: TaskFacetOptions = {}): Record<string, unknown> {
  return {
    target: 'task',
    fields: [field],
    definition: { ...taskRequest().definition, filter: options.filter ?? null },
    limit: options.limit ?? 20,
    ...(options.search === undefined ? {} : { search: options.search }),
    ...(options.cursor === undefined || options.cursor === null ? {} : { cursor: options.cursor }),
  };
}

async function taskBucket(
  app: FacetApp,
  field: string,
  options: TaskFacetOptions = {},
): Promise<FacetBucket> {
  const response = await requestFacets(app, taskFacetBody(field, options));
  expect(response.status).toBe(200);
  const parsed = WorkViewFacetResponse.parse(await response.json());
  const bucket = parsed.buckets[0];
  if (!bucket) throw new Error(`no ${field} facet bucket`);
  return bucket;
}

async function seedTask(
  fixture: SeededOrg,
  title: string,
  values: Partial<typeof schema.task.$inferInsert> = {},
): Promise<string> {
  const [row] = await schema.db
    .insert(schema.task)
    .values({
      organizationId: fixture.orgId,
      teamId: fixture.teamId,
      title,
      state: 'todo',
      statusId: fixture.statusId('task', 'todo'),
      visibility: 'public',
      ...values,
    })
    .returning({ id: schema.task.id });
  if (!row) throw new Error('Task seed failed');
  return row.id;
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

function countsByLabel(bucket: FacetBucket): Record<string, number> {
  return Object.fromEntries(bucket.options.map((option) => [option.label, option.count]));
}

describe('work-view Task relation facet catalogs', () => {
  it('lists assignees as actor operands with their Task counts', async () => {
    const fixture = await viewerFixture();
    const [assignee] = await schema.db
      .insert(schema.actor)
      .values({ organizationId: fixture.orgId, kind: 'human', displayName: 'Facet assignee' })
      .returning({ id: schema.actor.id });
    if (!assignee) throw new Error('assignee seed failed');
    await seedTask(fixture, 'Assigned', { assigneeId: assignee.id });
    await seedTask(fixture, 'Unassigned');

    const bucket = await taskBucket(fixture.app, 'assignee');

    expect(bucket.options).toContainEqual({
      value: { kind: 'actor', actorId: assignee.id },
      label: 'Facet assignee',
      count: 1,
    });
    expect(bucket.emptyCount).toBe(1);
  });

  it('lists Teams with their Task counts', async () => {
    const fixture = await viewerFixture();
    await seedTask(fixture, 'Core Task');

    const bucket = await taskBucket(fixture.app, 'team');

    expect(bucket.options).toContainEqual({ value: fixture.teamId, label: 'Core', count: 1 });
  });

  it('lists authorized Projects including ones with no Tasks', async () => {
    const fixture = await viewerFixture();
    const usedProjectId = await seedProject(fixture, 'Used Project');
    const unusedProjectId = await seedProject(fixture, 'Unused Project');
    await seedTask(fixture, 'Project Task', { projectId: usedProjectId });

    const bucket = await taskBucket(fixture.app, 'project');

    expect(bucket.options).toContainEqual({
      value: usedProjectId,
      label: 'Used Project',
      count: 1,
    });
    expect(bucket.options).toContainEqual({
      value: unusedProjectId,
      label: 'Unused Project',
      count: 0,
    });
  });

  it('lists Programs with their Task counts', async () => {
    const fixture = await viewerFixture();
    const [programRow] = await schema.db
      .insert(schema.program)
      .values({
        organizationId: fixture.orgId,
        name: 'Facet Program',
        status: 'active',
        statusId: fixture.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id });
    if (!programRow) throw new Error('Program seed failed');
    await seedTask(fixture, 'Program Task', { programId: programRow.id });

    const bucket = await taskBucket(fixture.app, 'program');

    expect(bucket.options).toContainEqual({
      value: programRow.id,
      label: 'Facet Program',
      count: 1,
    });
  });

  it('lists milestones with their Task counts', async () => {
    const fixture = await viewerFixture();
    const projectId = await seedProject(fixture, 'Milestone Project');
    const [milestoneRow] = await schema.db
      .insert(schema.milestone)
      .values({ organizationId: fixture.orgId, projectId, name: 'Beta' })
      .returning({ id: schema.milestone.id });
    if (!milestoneRow) throw new Error('milestone seed failed');
    await seedTask(fixture, 'Milestone Task', { projectId, milestoneId: milestoneRow.id });

    const bucket = await taskBucket(fixture.app, 'milestone');

    expect(bucket.options).toContainEqual({ value: milestoneRow.id, label: 'Beta', count: 1 });
  });

  it('buckets a groupable due date by calendar day', async () => {
    const fixture = await viewerFixture();
    await seedTask(fixture, 'Due first', { dueDate: new Date('2026-10-05T00:00:00.000Z') });
    await seedTask(fixture, 'Due second', { dueDate: new Date('2026-10-05T00:00:00.000Z') });
    await seedTask(fixture, 'Undated');

    const bucket = await taskBucket(fixture.app, 'dueDate');

    expect(bucket.options).toEqual([
      { value: { kind: 'absolute', value: '2026-10-05' }, label: '2026-10-05', count: 2 },
    ]);
    expect(bucket.emptyCount).toBe(1);
  });
});

describe('work-view non-Task facet catalogs', () => {
  it('lists linked Initiatives on a Project facet', async () => {
    const fixture = await viewerFixture();
    const projectId = await seedProject(fixture, 'Initiative-linked Project');
    const [initiativeRow] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: fixture.orgId,
        name: 'Facet Initiative',
        status: 'active',
        statusId: fixture.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    if (!initiativeRow) throw new Error('Initiative seed failed');
    await schema.db.insert(schema.initiativeProject).values({
      organizationId: fixture.orgId,
      initiativeId: initiativeRow.id,
      projectId,
    });

    const response = await requestFacets(fixture.app, {
      target: 'project',
      fields: ['initiatives'],
      definition: projectRequest().definition,
      limit: 20,
    });

    expect(response.status).toBe(200);
    const parsed = WorkViewFacetResponse.parse(await response.json());
    expect(parsed.buckets[0]?.options).toContainEqual({
      value: initiativeRow.id,
      label: 'Facet Initiative',
      count: 1,
    });
  });

  it('offers every Initiative priority from the static catalog', async () => {
    const fixture = await viewerFixture();
    await schema.db.insert(schema.initiative).values({
      organizationId: fixture.orgId,
      name: 'Prioritized Initiative',
      status: 'active',
      statusId: fixture.statusId('initiative', 'active'),
      priority: 'high',
    });

    const response = await requestFacets(fixture.app, {
      target: 'initiative',
      fields: ['priority'],
      definition: initiativeRequest().definition,
      limit: 20,
    });

    expect(response.status).toBe(200);
    const parsed = WorkViewFacetResponse.parse(await response.json());
    const bucket = parsed.buckets[0];
    expect(bucket?.options.map((option) => option.value).sort()).toEqual(
      ['high', 'low', 'medium', 'none'].sort(),
    );
    expect(bucket?.options.find((option) => option.value === 'high')?.count).toBe(1);
  });
});

describe('work-view facet filters', () => {
  it('drops a negated predicate on the faceted field so every option keeps its count', async () => {
    const fixture = await viewerFixture();
    await seedTask(fixture, 'High', { priority: 'high' });
    await seedTask(fixture, 'Low', { priority: 'low' });

    const bucket = await taskBucket(fixture.app, 'priority', {
      filter: {
        kind: 'not',
        child: { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
      },
    });

    expect(countsByLabel(bucket)).toMatchObject({ high: 1, low: 1 });
  });

  it('keeps a negated predicate on another field when counting the faceted field', async () => {
    const fixture = await viewerFixture();
    await seedTask(fixture, 'Open high', { priority: 'high' });
    await seedTask(fixture, 'Done high', {
      priority: 'high',
      state: 'done',
      statusId: fixture.statusId('task', 'done'),
    });

    const bucket = await taskBucket(fixture.app, 'priority', {
      filter: {
        kind: 'not',
        child: { kind: 'predicate', field: 'status', operator: 'is', operand: 'done' },
      },
    });

    expect(countsByLabel(bucket)).toMatchObject({ high: 1 });
  });

  it('drops a filter group whose every child targets the faceted field', async () => {
    const fixture = await viewerFixture();
    await seedTask(fixture, 'Urgent', { priority: 'urgent' });
    await seedTask(fixture, 'Medium', { priority: 'medium' });

    const bucket = await taskBucket(fixture.app, 'priority', {
      filter: {
        kind: 'all',
        children: [{ kind: 'predicate', field: 'priority', operator: 'is', operand: 'urgent' }],
      },
    });

    expect(countsByLabel(bucket)).toMatchObject({ urgent: 1, medium: 1 });
  });
});

describe('work-view facet cursors', () => {
  it('rejects a facet cursor whose signature was altered', async () => {
    const fixture = await viewerFixture();
    await seedTask(fixture, 'Cursor Task');
    const first = await taskBucket(fixture.app, 'priority', { limit: 1 });
    if (!first.nextCursor) throw new Error('expected a facet continuation cursor');
    const tampered = `${first.nextCursor.slice(0, -1)}${first.nextCursor.endsWith('A') ? 'B' : 'A'}`;

    const response = await requestFacets(
      fixture.app,
      taskFacetBody('priority', { limit: 1, cursor: tampered }),
    );

    expect(response.status).toBe(400);
  });

  it('rejects a facet cursor replayed with a different search', async () => {
    const fixture = await viewerFixture();
    await seedTask(fixture, 'Cursor Task');
    const first = await taskBucket(fixture.app, 'priority', { limit: 1 });
    if (!first.nextCursor) throw new Error('expected a facet continuation cursor');

    const response = await requestFacets(
      fixture.app,
      taskFacetBody('priority', { limit: 1, cursor: first.nextCursor, search: 'high' }),
    );

    expect(response.status).toBe(400);
  });
});
