import { beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { hc, InferResponseType } from 'hono/client';
import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import type * as DbModule from '@docket/db';
import {
  FractionalRank,
  InitiativeWorkViewQueryRequest,
  TaskWorkViewFacetRequest,
  WorkViewFacetResponse,
  WorkViewOrderRequest,
  type WorkViewFacetResponse as WorkViewFacetResponseValue,
  type WorkViewOrderResponse as WorkViewOrderResponseValue,
  WorkViewQueryResponse,
  type InitiativeViewRow,
  type ProgramViewRow,
  type ProjectViewRow,
  type TaskViewRow,
  type WorkViewQueryResponse as WorkViewQueryResponseValue,
} from '@docket/work/work-view-contract';
import { TimestampString } from '@docket/planning/date-time';

import { appWithActor, fakeSession, getDb, seedBaseOrg } from '../support/routes-harness';
import type workViewRoutes from '../../src/routes/work-views';
import type { queryWorkViewFacets as queryWorkViewFacetsFunction } from '../../src/lib/work-views/facets';
import type { reorderWorkView as reorderWorkViewFunction } from '../../src/lib/work-views/order';
import { programRequest, projectRequest, taskRequest } from '../work-views/request-fixtures';

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-route-test-secret-at-least-32-characters';

const JSON_HEADERS = { 'content-type': 'application/json' };

let schema!: typeof DbModule;
let workViews!: typeof workViewRoutes;
let queryWorkViewFacets!: typeof queryWorkViewFacetsFunction;
let reorderWorkView!: typeof reorderWorkViewFunction;

beforeAll(async () => {
  schema = await getDb();
  workViews = (await import('../../src/routes/work-views')).default;
  queryWorkViewFacets = (await import('../../src/lib/work-views/facets')).queryWorkViewFacets;
  reorderWorkView = (await import('../../src/lib/work-views/order')).reorderWorkView;
});

function initiativeRequest() {
  return InitiativeWorkViewQueryRequest.parse({
    target: 'initiative',
    definition: {
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
  });
}

async function grantOrganizationCapability(
  organizationId: string,
  actorId: string,
  capability: 'contribute' | 'assign',
): Promise<void> {
  await schema.db.insert(schema.grant).values({
    organizationId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'organization',
    resourceId: organizationId,
    capabilities: [capability],
    effect: 'allow',
    cascades: true,
  });
}

describe('work-view routes', () => {
  it('omits Active Project count from Initiative work-view rows', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.initiative).values({
      organizationId: orgId,
      name: 'Count-free Initiative',
      status: 'active',
      statusId: statusId('initiative', 'active'),
    });
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(initiativeRequest()),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly rows?: readonly Record<string, unknown>[] };
    expect(body.rows?.[0]).not.toHaveProperty('activeProjectCount');
  });

  it('returns the target-discriminated Task page through the typed query route', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Route-visible task',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
    });
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(taskRequest()),
    });

    expect(response.status).toBe(200);
    const parsed = WorkViewQueryResponse.parse(await response.json());
    expect(parsed.target).toBe('task');
    if (parsed.target !== 'task') throw new Error('expected a Task response');
    expectTypeOf(parsed.rows).toEqualTypeOf<TaskViewRow[]>();
    expect(parsed.rows.map((row) => row.title)).toContain('Route-visible task');
  });

  it('retains every target variant in the Hono-inferred query response', async () => {
    type WorkViewClient = ReturnType<typeof hc<typeof workViewRoutes>>;
    type QueryResponse = InferResponseType<WorkViewClient['query']['$post'], 200>;
    type FacetResponse = InferResponseType<WorkViewClient['facets']['$post'], 200>;
    type OrderResponse = InferResponseType<WorkViewClient['order']['$patch'], 200>;
    expectTypeOf<QueryResponse>().toEqualTypeOf<WorkViewQueryResponseValue>();
    expectTypeOf<FacetResponse>().toEqualTypeOf<WorkViewFacetResponseValue>();
    expectTypeOf<OrderResponse>().toEqualTypeOf<WorkViewOrderResponseValue>();

    const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);
    const cases = [
      ['task', taskRequest()],
      ['project', projectRequest()],
      ['program', programRequest()],
      ['initiative', initiativeRequest()],
    ] as const;

    for (const [target, request] of cases) {
      const response = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(200);
      expect(WorkViewQueryResponse.parse(await response.json()).target).toBe(target);
    }

    interface RowsByTarget {
      task: TaskViewRow[];
      project: ProjectViewRow[];
      program: ProgramViewRow[];
      initiative: InitiativeViewRow[];
    }
    expectTypeOf<Extract<QueryResponse, { target: 'task' }>['rows']>().toEqualTypeOf<
      RowsByTarget['task']
    >();
    expectTypeOf<Extract<QueryResponse, { target: 'project' }>['rows']>().toEqualTypeOf<
      RowsByTarget['project']
    >();
    expectTypeOf<Extract<QueryResponse, { target: 'program' }>['rows']>().toEqualTypeOf<
      RowsByTarget['program']
    >();
    expectTypeOf<Extract<QueryResponse, { target: 'initiative' }>['rows']>().toEqualTypeOf<
      RowsByTarget['initiative']
    >();
    expectTypeOf<
      Extract<FacetResponse, { target: 'task' }>['buckets'][number]['field']
    >().toEqualTypeOf<
      | 'status'
      | 'priority'
      | 'assignee'
      | 'delegate'
      | 'team'
      | 'project'
      | 'program'
      | 'cycle'
      | 'milestone'
      | 'parent'
      | 'labels'
      | 'title'
      | 'creator'
      | 'startDate'
      | 'dueDate'
      | 'createdAt'
      | 'updatedAt'
      | 'estimate'
      | 'estimateMinutes'
      | 'blocked'
      | 'blocking'
      | 'unfiled'
      | 'archived'
    >();
  });

  it('returns application-owned 400 problems for every malformed or mismatched cursor', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.task).values([
      {
        organizationId: orgId,
        teamId,
        title: 'Cursor first',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      },
      {
        organizationId: orgId,
        teamId,
        title: 'Cursor second',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      },
    ]);
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);
    for (const cursor of ['', 'garbage', 'wv2:%%%', 'wv2:bm90LWpzb24']) {
      const response = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...taskRequest(), cursor }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 'validation_error',
        title: 'Some information needs attention.',
        status: 400,
      });
    }

    const emptyFacetCursor = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['title'],
        definition: taskRequest().definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        cursor: '',
        limit: 10,
      }),
    });
    expect(emptyFacetCursor.status).toBe(400);
    expect(await emptyFacetCursor.json()).toMatchObject({
      code: 'validation_error',
      title: 'Some information needs attention.',
      status: 400,
    });

    const request = taskRequest({ limit: 1 });
    const pageResponse = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
    const page = WorkViewQueryResponse.parse(await pageResponse.json());
    expect(page.target).toBe('task');
    expect(page.nextCursor).not.toBeNull();
    if (!page.nextCursor) throw new Error('expected a cursor seed');

    const tampered = `${page.nextCursor.slice(0, -1)}${page.nextCursor.endsWith('A') ? 'B' : 'A'}`;
    const mismatched = taskRequest({
      limit: 1,
      temporaryFilter: {
        kind: 'predicate',
        field: 'priority',
        operator: 'is',
        operand: 'high',
      },
    });
    for (const [cursor, body] of [
      [tampered, request],
      [page.nextCursor, mismatched],
    ] as const) {
      const response = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...body, cursor }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: 'validation_error',
        title: 'Some information needs attention.',
        status: 400,
      });
    }
  });

  it('returns bounded searchable relation facets with counts and an empty bucket', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const labels = await schema.db
      .insert(schema.label)
      .values([
        { organizationId: orgId, name: 'Facet alpha', color: 'red' },
        { organizationId: orgId, name: 'Facet beta', color: 'blue' },
        { organizationId: orgId, name: 'Facet hidden', color: 'slate' },
      ])
      .returning({ id: schema.label.id });
    const tasks = await schema.db
      .insert(schema.task)
      .values([
        {
          organizationId: orgId,
          teamId,
          title: 'Alpha',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          estimateMinutes: 30,
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Beta',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          estimateMinutes: 30,
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Empty',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Filtered low',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'low',
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Unauthorized private',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          visibility: 'private',
        },
      ])
      .returning({ id: schema.task.id });
    if (
      !labels[0] ||
      !labels[1] ||
      !labels[2] ||
      !tasks[0] ||
      !tasks[1] ||
      !tasks[2] ||
      !tasks[3] ||
      !tasks[4]
    ) {
      throw new Error('facet seed failed');
    }
    await schema.db.insert(schema.taskLabel).values([
      { organizationId: orgId, taskId: tasks[0].id, labelId: labels[0].id },
      { organizationId: orgId, taskId: tasks[1].id, labelId: labels[1].id },
      { organizationId: orgId, taskId: tasks[3].id, labelId: labels[2].id },
      { organizationId: orgId, taskId: tasks[4].id, labelId: labels[2].id },
    ]);
    await schema.db.insert(schema.taskDependency).values({
      organizationId: orgId,
      blockingTaskId: tasks[0].id,
      blockedTaskId: tasks[1].id,
    });
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);
    const active = taskRequest({
      temporaryFilter: {
        kind: 'predicate',
        field: 'priority',
        operator: 'is',
        operand: 'high',
      },
    });

    const firstResponse = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['labels'],
        definition: active.definition,
        temporaryFilter: active.temporaryFilter,
        context: active.context,
        search: 'Facet',
        limit: 1,
      }),
    });

    expect(firstResponse.status).toBe(200);
    const first = WorkViewFacetResponse.parse(await firstResponse.json());
    expect(first.target).toBe('task');
    const bucket = first.buckets[0];
    expect(bucket).toMatchObject({ field: 'labels', emptyCount: 1 });
    expect(bucket?.options).toHaveLength(1);
    expect(bucket?.nextCursor).not.toBeNull();
    expect(first.distinctCount).toBe(3);

    const secondResponse = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['labels'],
        definition: active.definition,
        temporaryFilter: active.temporaryFilter,
        context: active.context,
        search: 'Facet',
        limit: 1,
        cursor: bucket?.nextCursor,
      }),
    });
    const second = WorkViewFacetResponse.parse(await secondResponse.json());
    expect(second.buckets[0]?.options).toHaveLength(1);
    expect(second.buckets[0]?.nextCursor).not.toBeNull();
    const thirdResponse = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['labels'],
        definition: active.definition,
        temporaryFilter: active.temporaryFilter,
        context: active.context,
        search: 'Facet',
        limit: 1,
        cursor: second.buckets[0]?.nextCursor,
      }),
    });
    const third = WorkViewFacetResponse.parse(await thirdResponse.json());
    expect(third.buckets[0]?.options).toHaveLength(1);
    expect(third.buckets[0]?.nextCursor).toBeNull();
    expect([
      ...(bucket?.options ?? []),
      ...(second.buckets[0]?.options ?? []),
      ...(third.buckets[0]?.options ?? []),
    ]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: labels[0].id, count: 1 }),
        expect.objectContaining({ value: labels[1].id, count: 1 }),
        expect.objectContaining({ value: labels[2].id, count: 0 }),
      ]),
    );

    const scalarFields = ['blocked', 'title', 'estimateMinutes'] as const;
    const scalarBuckets = await Promise.all(
      scalarFields.map(async (field) => {
        const scalarResponse = await app.request('/facets', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            target: 'task',
            fields: [field],
            definition: active.definition,
            temporaryFilter: active.temporaryFilter,
            context: active.context,
            limit: 100,
          }),
        });
        expect(scalarResponse.status).toBe(200);
        return WorkViewFacetResponse.parse(await scalarResponse.json()).buckets[0];
      }),
    );
    const byField = new Map(scalarBuckets.map((entry) => [entry?.field, entry]));
    expect(byField.get('blocked')).toMatchObject({
      emptyCount: 0,
      options: expect.arrayContaining([
        expect.objectContaining({ value: true, count: 1 }),
        expect.objectContaining({ value: false, count: 2 }),
      ]),
    });
    expect(byField.get('title')).toMatchObject({
      emptyCount: 0,
      options: expect.arrayContaining([
        expect.objectContaining({ value: 'Alpha', count: 1 }),
        expect.objectContaining({ value: 'Beta', count: 1 }),
        expect.objectContaining({ value: 'Empty', count: 1 }),
      ]),
    });
    expect(byField.get('estimateMinutes')).toMatchObject({
      emptyCount: 1,
      options: [expect.objectContaining({ value: 30, count: 2 })],
    });

    const changedFilterResponse = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['labels'],
        definition: active.definition,
        temporaryFilter: null,
        context: active.context,
        search: 'Facet',
        limit: 1,
        cursor: bucket?.nextCursor,
      }),
    });
    expect(changedFilterResponse.status).toBe(400);
    expect(await changedFilterResponse.json()).toMatchObject({
      code: 'validation_error',
      title: 'Some information needs attention.',
      status: 400,
    });

    const [otherActor] = await schema.db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Grace' })
      .returning({ id: schema.actor.id });
    if (!otherActor) throw new Error('facet actor seed failed');
    const otherApp = appWithActor(workViews, orgId, ['view'], otherActor.id);
    const changedActorResponse = await otherApp.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['labels'],
        definition: active.definition,
        temporaryFilter: active.temporaryFilter,
        context: active.context,
        search: 'Facet',
        limit: 1,
        cursor: bucket?.nextCursor,
      }),
    });
    expect(changedActorResponse.status).toBe(400);
    expect(await changedActorResponse.json()).toMatchObject({
      code: 'validation_error',
      title: 'Some information needs attention.',
      status: 400,
    });
  });

  it('facets without the current field predicate and includes unused authorized options', async () => {
    const local = await seedBaseOrg(schema.db, schema);
    const foreign = await seedBaseOrg(schema.db, schema);
    const [unusedLabel] = await schema.db
      .insert(schema.label)
      .values({ organizationId: local.orgId, name: 'Unused searchable', color: 'green' })
      .returning({ id: schema.label.id });
    await schema.db.insert(schema.label).values({
      organizationId: foreign.orgId,
      name: 'Unused searchable foreign',
      color: 'red',
    });
    if (!unusedLabel) throw new Error('unused facet label seed failed');
    await schema.db.insert(schema.task).values([
      {
        organizationId: local.orgId,
        teamId: local.teamId,
        title: 'Open high',
        state: 'todo',
        statusId: local.statusId('task', 'todo'),
        priority: 'high',
        visibility: 'public',
      },
      {
        organizationId: local.orgId,
        teamId: local.teamId,
        title: 'Done high',
        state: 'done',
        statusId: local.statusId('task', 'done'),
        priority: 'high',
        visibility: 'public',
      },
      {
        organizationId: local.orgId,
        teamId: local.teamId,
        title: 'Done low',
        state: 'done',
        statusId: local.statusId('task', 'done'),
        priority: 'low',
        visibility: 'public',
      },
    ]);
    const definition = {
      ...taskRequest().definition,
      filter: {
        kind: 'all',
        children: [
          { kind: 'predicate', field: 'status', operator: 'is', operand: 'todo' },
          { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
        ],
      },
    };
    const app = appWithActor(workViews, local.orgId, ['view'], local.humanActorId);

    const statusResponse = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['status'],
        definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        limit: 100,
      }),
    });
    expect(statusResponse.status).toBe(200);
    const statusFacets = WorkViewFacetResponse.parse(await statusResponse.json());
    expect(statusFacets.buckets[0]?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'todo', count: 1 }),
        expect.objectContaining({ value: 'done', count: 1 }),
      ]),
    );

    const labelResponse = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['labels'],
        definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        search: 'Unused searchable',
        limit: 100,
      }),
    });
    expect(labelResponse.status).toBe(200);
    const labelFacets = WorkViewFacetResponse.parse(await labelResponse.json());
    expect(labelFacets.buckets[0]?.options).toEqual([
      expect.objectContaining({ value: unusedLabel.id, count: 0 }),
    ]);
  });

  it('returns an authorized unused Task parent when the filtered facet roster is empty', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [visibleParent, privateParent] = await schema.db
      .insert(schema.task)
      .values([
        {
          organizationId: orgId,
          teamId,
          title: 'Searchable unused parent',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Searchable private parent',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'private',
        },
      ])
      .returning({ id: schema.task.id });
    if (!visibleParent || !privateParent) throw new Error('parent facet seed failed');
    const definition = {
      ...taskRequest().definition,
      filter: {
        kind: 'predicate',
        field: 'title',
        operator: 'contains',
        operand: 'no Task has this title',
      },
    };
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['parent'],
        definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        search: 'Searchable',
        limit: 100,
      }),
    });

    expect(response.status).toBe(200);
    const facets = WorkViewFacetResponse.parse(await response.json());
    expect(facets.distinctCount).toBe(0);
    expect(facets.buckets[0]?.options).toEqual([
      expect.objectContaining({ value: visibleParent.id, count: 0 }),
    ]);
    expect(facets.buckets[0]?.options.map((option) => option.value)).not.toContain(
      privateParent.id,
    );
  });

  it('normalizes date facet values to calendar-date operands', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Dated facet Task',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      startDate: new Date('2026-11-02T00:00:00.000Z'),
      visibility: 'public',
    });
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['startDate'],
        definition: taskRequest().definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        limit: 10,
      }),
    });

    expect(response.status).toBe(200);
    const facets = WorkViewFacetResponse.parse(await response.json());
    expect(facets.buckets[0]?.options).toContainEqual({
      value: { kind: 'absolute', value: '2026-11-02' },
      label: '2026-11-02',
      count: 1,
    });
  });

  it('preserves microsecond timestamps in canonical UTC facet operands and round-trips them', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Timestamp facet Task',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!item) throw new Error('timestamp facet Task seed failed');
    await schema.db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Different timestamp Task',
      state: 'todo',
      statusId: statusId('task', 'todo'),
      visibility: 'public',
    });
    await schema.db.execute(sql`update task
      set created_at=('2026-11-02 01:30:45.123456-07:00'::timestamptz at time zone 'UTC')
      where id=${item.id} and organization_id=${orgId}`);
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['createdAt'],
        definition: taskRequest().definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        limit: 10,
      }),
    });

    expect(response.status).toBe(200);
    const facets = WorkViewFacetResponse.parse(await response.json());
    const exactTimestamp = TimestampString.parse('2026-11-02T08:30:45.123456Z');
    const timestampOption = {
      value: { kind: 'absolute' as const, value: exactTimestamp },
      label: '2026-11-02T08:30:45.123456Z',
      count: 1,
    };
    expect(facets.buckets[0]?.options).toContainEqual(timestampOption);

    const queryResponse = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(
        taskRequest({
          definition: {
            ...taskRequest().definition,
            filter: {
              kind: 'predicate',
              field: 'createdAt',
              operator: 'on',
              operand: timestampOption.value,
            },
          },
        }),
      ),
    });

    expect(queryResponse.status).toBe(200);
    const page = WorkViewQueryResponse.parse(await queryResponse.json());
    expect(page.target).toBe('task');
    expect(page.rows.map((row) => row.id)).toEqual([item.id]);
  });

  it('rejects more than one facet field at request validation', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/facets', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        fields: ['status', 'priority'],
        definition: taskRequest().definition,
        temporaryFilter: null,
        context: { kind: 'organization' },
        limit: 10,
      }),
    });

    expect(response.status).toBe(422);
  });

  it('bounds a searchable parent facet to three SQL statements and one option page', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.task).values(
      Array.from({ length: 64 }, (_, index) => ({
        organizationId: orgId,
        teamId,
        title: `Bounded parent ${String(index).padStart(2, '0')}`,
        state: 'todo' as const,
        statusId: statusId('task', 'todo'),
        visibility: 'public' as const,
      })),
    );
    const statements: SQL[] = [];
    const countingDatabase = new Proxy(schema.db, {
      get(target, property, receiver) {
        if (property === 'execute') {
          return (statement: SQL) => {
            statements.push(statement);
            return target.execute(statement);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const request = TaskWorkViewFacetRequest.parse({
      target: 'task',
      fields: ['parent'],
      definition: taskRequest().definition,
      temporaryFilter: null,
      context: { kind: 'organization' },
      search: 'Bounded parent',
      limit: 3,
    });

    const facets = await queryWorkViewFacets({
      database: countingDatabase,
      organizationId: orgId,
      actorId: humanActorId,
      request,
    });

    expect(statements).toHaveLength(3);
    expect(facets.buckets[0]?.options).toHaveLength(3);
    expect(facets.buckets[0]?.nextCursor).not.toBeNull();
    const bucketStatement = statements[2];
    if (!bucketStatement) throw new Error('facet bucket statement was not captured');
    const query = new PgDialect().sqlToQuery(bucketStatement).sql.toLowerCase();
    expect(query).toContain('bounded_catalog');
    expect(query).toMatch(/order by candidate\.key limit/);
  });

  it('returns authorized foreign Initiative facet options from an empty filtered context', async () => {
    const contextOrg = await seedBaseOrg(schema.db, schema);
    const ownerOrg = await seedBaseOrg(schema.db, schema);
    const hiddenOrg = await seedBaseOrg(schema.db, schema);
    await Promise.all([
      schema.db
        .update(schema.organization)
        .set({ name: 'Authorized owner workspace' })
        .where(eq(schema.organization.id, ownerOrg.orgId)),
      schema.db
        .update(schema.organization)
        .set({ name: 'Hidden owner workspace' })
        .where(eq(schema.organization.id, hiddenOrg.orgId)),
    ]);
    const [user] = await schema.db
      .insert(schema.user)
      .values({
        name: 'Portfolio viewer',
        email: `portfolio-facets-${contextOrg.orgId}@example.test`,
      })
      .returning({ id: schema.user.id });
    if (!user) throw new Error('Initiative facet user seed failed');
    await schema.db
      .update(schema.actor)
      .set({ userId: user.id })
      .where(sql`${schema.actor.id} in (${contextOrg.humanActorId}, ${ownerOrg.humanActorId})`);
    const [ownerStatus, hiddenStatus] = await Promise.all([
      schema.db
        .insert(schema.workStatus)
        .values({
          organizationId: ownerOrg.orgId,
          entityType: 'initiative',
          key: 'owner-review',
          name: 'Owner review',
          category: 'started',
          position: 71,
          isDefault: false,
        })
        .returning({ id: schema.workStatus.id }),
      schema.db
        .insert(schema.workStatus)
        .values({
          organizationId: hiddenOrg.orgId,
          entityType: 'initiative',
          key: 'hidden-review',
          name: 'Hidden review',
          category: 'started',
          position: 72,
          isDefault: false,
        })
        .returning({ id: schema.workStatus.id }),
    ]);
    const [root] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: contextOrg.orgId,
        name: 'Portfolio root',
        status: 'active',
        statusId: contextOrg.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const [foreign, hidden] = await Promise.all([
      schema.db
        .insert(schema.initiative)
        .values({
          organizationId: ownerOrg.orgId,
          name: 'Authorized foreign child',
          ownerId: ownerOrg.humanActorId,
          leadTeamId: ownerOrg.teamId,
          status: 'owner-review',
          statusId: ownerStatus[0]?.id ?? '',
        })
        .returning({ id: schema.initiative.id }),
      schema.db
        .insert(schema.initiative)
        .values({
          organizationId: hiddenOrg.orgId,
          name: 'Unauthorized foreign child',
          ownerId: hiddenOrg.humanActorId,
          leadTeamId: hiddenOrg.teamId,
          status: 'hidden-review',
          statusId: hiddenStatus[0]?.id ?? '',
        })
        .returning({ id: schema.initiative.id }),
    ]);
    const [ownerLabel, hiddenLabel] = await Promise.all([
      schema.db
        .insert(schema.label)
        .values({ organizationId: ownerOrg.orgId, name: 'Owner portfolio label', color: 'blue' })
        .returning({ id: schema.label.id }),
      schema.db
        .insert(schema.label)
        .values({ organizationId: hiddenOrg.orgId, name: 'Hidden portfolio label', color: 'red' })
        .returning({ id: schema.label.id }),
    ]);
    const ownerStatusRow = ownerStatus[0];
    const hiddenStatusRow = hiddenStatus[0];
    const foreignInitiative = foreign[0];
    const hiddenInitiative = hidden[0];
    const ownerLabelRow = ownerLabel[0];
    const hiddenLabelRow = hiddenLabel[0];
    if (
      !root ||
      !ownerStatusRow ||
      !hiddenStatusRow ||
      !foreignInitiative ||
      !hiddenInitiative ||
      !ownerLabelRow ||
      !hiddenLabelRow
    ) {
      throw new Error('Initiative facet option seed failed');
    }
    await schema.db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: contextOrg.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: foreignInitiative.id,
      },
      {
        contextOrganizationId: contextOrg.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: hiddenInitiative.id,
      },
    ]);
    await schema.db.insert(schema.initiativeLabel).values([
      {
        organizationId: ownerOrg.orgId,
        initiativeId: foreignInitiative.id,
        labelId: ownerLabelRow.id,
      },
      {
        organizationId: hiddenOrg.orgId,
        initiativeId: hiddenInitiative.id,
        labelId: hiddenLabelRow.id,
      },
    ]);
    const request = initiativeRequest();
    const app = appWithActor(workViews, contextOrg.orgId, ['view'], contextOrg.humanActorId);

    const fields = ['parent', 'owner', 'leadTeam', 'labels', 'organization', 'status'] as const;
    const returnedBuckets = await Promise.all(
      fields.map(async (field) => {
        const response = await app.request('/facets', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            target: 'initiative',
            fields: [field],
            definition: {
              ...request.definition,
              filter: {
                kind: 'predicate',
                field: 'name',
                operator: 'contains',
                operand: 'no Initiative has this name',
              },
            },
            temporaryFilter: null,
            context: { kind: 'initiative', initiativeId: root.id },
            limit: 100,
          }),
        });
        expect(response.status).toBe(200);
        const facets = WorkViewFacetResponse.parse(await response.json());
        if (facets.target !== 'initiative') throw new Error('expected Initiative facets');
        expect(facets.distinctCount).toBe(0);
        const bucket = facets.buckets[0];
        if (!bucket) throw new Error('expected Initiative facet bucket');
        return bucket;
      }),
    );
    const buckets = new Map(returnedBuckets.map((bucket) => [bucket.field, bucket]));
    const assertZeroOption = (
      field: (typeof fields)[number],
      value: unknown,
      label: string,
    ): void => {
      expect(buckets.get(field)?.options).toContainEqual({ value, label, count: 0 });
    };
    assertZeroOption('parent', foreignInitiative.id, 'Authorized foreign child');
    assertZeroOption('owner', { kind: 'actor', actorId: ownerOrg.humanActorId }, 'Ada');
    assertZeroOption('leadTeam', ownerOrg.teamId, 'Core');
    assertZeroOption('labels', ownerLabelRow.id, 'Owner portfolio label');
    assertZeroOption('organization', ownerOrg.orgId, 'Authorized owner workspace');
    assertZeroOption('status', 'owner-review', 'Owner review');
    const forbiddenValues = [
      hiddenInitiative.id,
      hiddenOrg.humanActorId,
      hiddenOrg.teamId,
      hiddenLabelRow.id,
      hiddenOrg.orgId,
      'hidden-review',
    ];
    const returnedValues = returnedBuckets.flatMap((bucket) =>
      bucket.options.map((option) =>
        typeof option.value === 'object' && option.value !== null && 'actorId' in option.value
          ? option.value.actorId
          : option.value,
      ),
    );
    expect(returnedValues).not.toEqual(expect.arrayContaining(forbiddenValues));
  });

  it('keeps distinctCount on the full active filter for every single-field facet', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.task).values([
      {
        organizationId: orgId,
        teamId,
        title: 'High todo',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        priority: 'high',
        visibility: 'public',
      },
      ...['High done one', 'High done two'].map((title) => ({
        organizationId: orgId,
        teamId,
        title,
        state: 'done' as const,
        statusId: statusId('task', 'done'),
        priority: 'high' as const,
        visibility: 'public' as const,
      })),
      ...['Low todo one', 'Low todo two', 'Low todo three'].map((title) => ({
        organizationId: orgId,
        teamId,
        title,
        state: 'todo' as const,
        statusId: statusId('task', 'todo'),
        priority: 'low' as const,
        visibility: 'public' as const,
      })),
    ]);
    const definition = {
      ...taskRequest().definition,
      filter: {
        kind: 'all',
        children: [
          { kind: 'predicate', field: 'status', operator: 'is', operand: 'todo' },
          { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
        ],
      },
    };
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);
    const read = async (field: 'status' | 'priority') => {
      const response = await app.request('/facets', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'task',
          fields: [field],
          definition,
          temporaryFilter: null,
          context: { kind: 'organization' },
          limit: 100,
        }),
      });
      expect(response.status).toBe(200);
      return WorkViewFacetResponse.parse(await response.json());
    };

    const status = await read('status');
    const priority = await read('priority');
    expect(status.distinctCount).toBe(1);
    expect(priority.distinctCount).toBe(1);
  });

  it('uses the session Hub timezone for DST query and facet boundaries and cursor identity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-08T07:30:00.000Z'));
    try {
      const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
      const [user] = await schema.db
        .insert(schema.user)
        .values({ name: 'Pacific planner', email: `pacific-${orgId}@example.test` })
        .returning({ id: schema.user.id });
      if (!user) throw new Error('timezone user seed failed');
      await schema.db
        .update(schema.actor)
        .set({ userId: user.id })
        .where(eq(schema.actor.id, humanActorId));
      await schema.db.insert(schema.hub).values({
        userId: user.id,
        preferences: { timezone: 'America/Los_Angeles' },
      });
      const rows = await schema.db
        .insert(schema.task)
        .values([
          {
            organizationId: orgId,
            teamId,
            title: 'Pacific Saturday one',
            state: 'todo',
            statusId: statusId('task', 'todo'),
            dueDate: new Date('2026-03-07T12:00:00.000Z'),
            visibility: 'public',
          },
          {
            organizationId: orgId,
            teamId,
            title: 'Pacific Saturday two',
            state: 'done',
            statusId: statusId('task', 'done'),
            dueDate: new Date('2026-03-07T18:00:00.000Z'),
            visibility: 'public',
          },
          {
            organizationId: orgId,
            teamId,
            title: 'UTC Sunday',
            state: 'todo',
            statusId: statusId('task', 'todo'),
            dueDate: new Date('2026-03-08T12:00:00.000Z'),
            visibility: 'public',
          },
        ])
        .returning({ id: schema.task.id, title: schema.task.title });
      expect(rows).toHaveLength(3);
      const definition = {
        ...taskRequest().definition,
        filter: {
          kind: 'predicate',
          field: 'dueDate',
          operator: 'on',
          operand: { kind: 'preset', value: 'today' },
        },
      };
      const app = appWithActor(workViews, orgId, ['view'], humanActorId, fakeSession(user.id));
      const queryResponse = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ...taskRequest({ limit: 1 }),
          definition,
        }),
      });
      expect(queryResponse.status).toBe(200);
      const firstPage = WorkViewQueryResponse.parse(await queryResponse.json());
      if (firstPage.target !== 'task') throw new Error('expected timezone Task page');
      expect(firstPage.rows[0]?.title).toMatch(/^Pacific Saturday/);
      expect(firstPage.nextCursor).not.toBeNull();

      const facetResponse = await app.request('/facets', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'task',
          fields: ['status'],
          definition,
          temporaryFilter: null,
          context: { kind: 'organization' },
          limit: 1,
        }),
      });
      expect(facetResponse.status).toBe(200);
      const facets = WorkViewFacetResponse.parse(await facetResponse.json());
      expect(facets.distinctCount).toBe(2);
      expect(facets.buckets[0]?.nextCursor).not.toBeNull();

      await schema.db
        .update(schema.hub)
        .set({ preferences: { timezone: 'UTC' } })
        .where(eq(schema.hub.userId, user.id));
      const replayQuery = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ...taskRequest({ limit: 1 }),
          definition,
          cursor: firstPage.nextCursor,
        }),
      });
      expect(replayQuery.status).toBe(400);
      const replayFacet = await app.request('/facets', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'task',
          fields: ['status'],
          definition,
          temporaryFilter: null,
          context: { kind: 'organization' },
          limit: 1,
          cursor: facets.buckets[0]?.nextCursor,
        }),
      });
      expect(replayFacet.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists manual order and routes a mutable priority drop through the work mutation', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Move me',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        priority: 'low',
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!item) throw new Error('order seed failed');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);

    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'priority',
        groupValue: 'high',
        beforeId: null,
        afterId: null,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ target: 'task', itemId: item.id });
    const [storedTask] = await schema.db
      .select({ priority: schema.task.priority })
      .from(schema.task)
      .where(and(eq(schema.task.organizationId, orgId), eq(schema.task.id, item.id)));
    expect(storedTask?.priority).toBe('high');
    const [storedOrder] = await schema.db
      .select()
      .from(schema.workItemOrder)
      .where(
        and(
          eq(schema.workItemOrder.organizationId, orgId),
          eq(schema.workItemOrder.contextType, 'organization'),
          eq(schema.workItemOrder.contextId, orgId),
          eq(schema.workItemOrder.target, 'task'),
          eq(schema.workItemOrder.itemId, item.id),
        ),
      );
    expect(storedOrder?.rank).toMatch(/^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*$/);
  });

  it('rejects a context contributor changing labels on a foreign-owned Initiative', async () => {
    const contextOrg = await seedBaseOrg(schema.db, schema);
    const ownerOrg = await seedBaseOrg(schema.db, schema);
    const [user] = await schema.db
      .insert(schema.user)
      .values({
        name: 'Cross-owner planner',
        email: `cross-owner-${contextOrg.orgId}@example.test`,
      })
      .returning({ id: schema.user.id });
    if (!user) throw new Error('cross-owner user seed failed');
    await schema.db
      .update(schema.actor)
      .set({ userId: user.id })
      .where(sql`${schema.actor.id} in (${contextOrg.humanActorId}, ${ownerOrg.humanActorId})`);
    const [root] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: contextOrg.orgId,
        name: 'Context root',
        status: 'active',
        statusId: contextOrg.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const [foreignInitiative] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: ownerOrg.orgId,
        name: 'Foreign child',
        status: 'active',
        statusId: ownerOrg.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const [foreignLabel] = await schema.db
      .insert(schema.label)
      .values({ organizationId: ownerOrg.orgId, name: 'Owner label', color: 'blue' })
      .returning({ id: schema.label.id });
    const [localLabel] = await schema.db
      .insert(schema.label)
      .values({ organizationId: contextOrg.orgId, name: 'Context label', color: 'red' })
      .returning({ id: schema.label.id });
    if (!root || !foreignInitiative || !foreignLabel || !localLabel) {
      throw new Error('cross-owner Initiative seed failed');
    }
    await schema.db.insert(schema.initiativeHierarchyLink).values({
      contextOrganizationId: contextOrg.orgId,
      parentInitiativeId: root.id,
      childInitiativeId: foreignInitiative.id,
      createdBy: contextOrg.humanActorId,
    });
    await schema.db.insert(schema.initiativeLabel).values({
      organizationId: ownerOrg.orgId,
      initiativeId: foreignInitiative.id,
      labelId: foreignLabel.id,
    });
    await grantOrganizationCapability(contextOrg.orgId, contextOrg.humanActorId, 'contribute');
    const app = appWithActor(workViews, contextOrg.orgId, ['contribute'], contextOrg.humanActorId);

    const visible = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ...initiativeRequest(),
        context: { kind: 'initiative', initiativeId: root.id },
      }),
    });
    expect(visible.status).toBe(200);
    const page = WorkViewQueryResponse.parse(await visible.json());
    if (page.target !== 'initiative') throw new Error('expected Initiative page');
    expect(page.rows.map((row) => row.id)).toContain(foreignInitiative.id);

    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'initiative',
        itemId: foreignInitiative.id,
        context: { kind: 'initiative', initiativeId: root.id },
        groupField: 'labels',
        sourceGroupValue: null,
        groupValue: localLabel.id,
        beforeId: null,
        afterId: null,
      }),
    });

    expect(response.status).toBe(404);
    const attached = await schema.db
      .select({ labelId: schema.initiativeLabel.labelId })
      .from(schema.initiativeLabel)
      .where(
        and(
          eq(schema.initiativeLabel.organizationId, ownerOrg.orgId),
          eq(schema.initiativeLabel.initiativeId, foreignInitiative.id),
        ),
      );
    expect(attached).toEqual([{ labelId: foreignLabel.id }]);
  });

  it('rejects computed and read-only group changes before it reads an item', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'project',
        itemId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        context: { kind: 'organization' },
        groupField: 'progress',
        groupValue: 0.5,
        beforeId: null,
        afterId: null,
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'validation_error',
      title: 'Some information needs attention.',
    });
  });

  it('rejects an order neighbor outside the authorized context', async () => {
    const current = await seedBaseOrg(schema.db, schema);
    const foreign = await seedBaseOrg(schema.db, schema);
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: current.orgId,
        teamId: current.teamId,
        title: 'Current item',
        state: 'todo',
        statusId: current.statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    const [foreignItem] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: foreign.orgId,
        teamId: foreign.teamId,
        title: 'Foreign neighbor',
        state: 'todo',
        statusId: foreign.statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!item || !foreignItem) throw new Error('neighbor seed failed');
    await grantOrganizationCapability(current.orgId, current.humanActorId, 'contribute');
    await schema.db.insert(schema.workItemOrder).values({
      organizationId: current.orgId,
      contextType: 'organization',
      contextId: current.orgId,
      target: 'task',
      itemId: foreignItem.id,
      rank: FractionalRank.parse('Z0'),
    });
    const app = appWithActor(workViews, current.orgId, ['contribute'], current.humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: null,
        groupValue: null,
        beforeId: foreignItem.id,
        afterId: null,
      }),
    });
    expect(response.status).toBe(404);
  });

  it('moves a Project primary Team without violating the compatibility edge', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [nextTeam, unrelatedTeam] = await schema.db
      .insert(schema.team)
      .values([
        { organizationId: orgId, name: 'Next', key: `N${orgId.slice(-3)}` },
        { organizationId: orgId, name: 'Unrelated', key: `U${orgId.slice(-3)}` },
      ])
      .returning({ id: schema.team.id });
    const [item] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        teamId,
        name: 'Move teams',
        status: 'planned',
        statusId: statusId('project', 'planned'),
        visibility: 'public',
      })
      .returning({ id: schema.project.id });
    if (!nextTeam || !unrelatedTeam || !item) throw new Error('Project Team seed failed');
    await schema.db.insert(schema.projectTeam).values([
      { organizationId: orgId, projectId: item.id, teamId, isPrimary: true },
      {
        organizationId: orgId,
        projectId: item.id,
        teamId: unrelatedTeam.id,
        isPrimary: false,
      },
    ]);
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'project',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'teams',
        sourceGroupValue: teamId,
        groupValue: nextTeam.id,
        beforeId: null,
        afterId: null,
      }),
    });
    expect(response.status).toBe(200);
    const teams = await schema.db
      .select({ teamId: schema.projectTeam.teamId, isPrimary: schema.projectTeam.isPrimary })
      .from(schema.projectTeam)
      .where(eq(schema.projectTeam.projectId, item.id));
    expect(teams).toContainEqual({ teamId: nextTeam.id, isPrimary: true });
    expect(teams).toContainEqual({ teamId: unrelatedTeam.id, isPrimary: false });
    expect(teams.map((entry) => entry.teamId)).not.toContain(teamId);
    expect(teams.filter((entry) => entry.isPrimary)).toHaveLength(1);

    const remove = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'project',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'teams',
        sourceGroupValue: nextTeam.id,
        groupValue: null,
        beforeId: null,
        afterId: null,
      }),
    });
    expect(remove.status).toBe(200);
    const [storedProject] = await schema.db
      .select({ teamId: schema.project.teamId })
      .from(schema.project)
      .where(eq(schema.project.id, item.id));
    const remainingTeams = await schema.db
      .select({ teamId: schema.projectTeam.teamId, isPrimary: schema.projectTeam.isPrimary })
      .from(schema.projectTeam)
      .where(eq(schema.projectTeam.projectId, item.id));
    expect(storedProject?.teamId).toBe(unrelatedTeam.id);
    expect(remainingTeams).toEqual([{ teamId: unrelatedTeam.id, isPrimary: true }]);
    const query = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(projectRequest()),
    });
    const page = WorkViewQueryResponse.parse(await query.json());
    if (page.target !== 'project') throw new Error('expected Project page');
    const projected = page.rows.find((row) => row.id === item.id);
    expect(projected?.teams).toEqual([unrelatedTeam.id]);
  });

  it('keeps the Project primary Team edge consistent across secondary and empty moves', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [secondarySource, secondaryDestination, unrelated] = await schema.db
      .insert(schema.team)
      .values([
        { organizationId: orgId, name: 'Secondary source', key: `S${orgId.slice(-3)}` },
        { organizationId: orgId, name: 'Secondary destination', key: `D${orgId.slice(-3)}` },
        { organizationId: orgId, name: 'Unrelated Team', key: `U${orgId.slice(-3)}` },
      ])
      .returning({ id: schema.team.id });
    const [item] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        teamId,
        name: 'Primary invariant Project',
        status: 'planned',
        statusId: statusId('project', 'planned'),
        visibility: 'public',
      })
      .returning({ id: schema.project.id });
    if (!secondarySource || !secondaryDestination || !unrelated || !item) {
      throw new Error('Project primary invariant seed failed');
    }
    await schema.db.insert(schema.projectTeam).values([
      { organizationId: orgId, projectId: item.id, teamId, isPrimary: true },
      {
        organizationId: orgId,
        projectId: item.id,
        teamId: secondarySource.id,
        isPrimary: false,
      },
      {
        organizationId: orgId,
        projectId: item.id,
        teamId: secondaryDestination.id,
        isPrimary: false,
      },
      { organizationId: orgId, projectId: item.id, teamId: unrelated.id, isPrimary: false },
    ]);
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const move = async (sourceGroupValue: string, groupValue: string | null): Promise<void> => {
      const response = await app.request('/order', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'project',
          itemId: item.id,
          context: { kind: 'organization' },
          groupField: 'teams',
          sourceGroupValue,
          groupValue,
          beforeId: null,
          afterId: null,
        }),
      });
      expect(response.status).toBe(200);
    };
    const read = async () => {
      const [projectRow] = await schema.db
        .select({ teamId: schema.project.teamId })
        .from(schema.project)
        .where(eq(schema.project.id, item.id));
      const teams = await schema.db
        .select({ teamId: schema.projectTeam.teamId, isPrimary: schema.projectTeam.isPrimary })
        .from(schema.projectTeam)
        .where(eq(schema.projectTeam.projectId, item.id));
      return { teamId: projectRow?.teamId ?? null, teams };
    };
    const expectInvariant = (state: Awaited<ReturnType<typeof read>>): void => {
      const primaries = state.teams.filter((team) => team.isPrimary);
      if (state.teamId === null) {
        expect(primaries).toHaveLength(0);
      } else {
        expect(primaries).toEqual([{ teamId: state.teamId, isPrimary: true }]);
      }
    };

    await move(secondarySource.id, teamId);
    const secondaryToPrimary = await read();
    expectInvariant(secondaryToPrimary);
    expect(secondaryToPrimary.teams.map((team) => team.teamId)).toEqual(
      expect.arrayContaining([teamId, secondaryDestination.id, unrelated.id]),
    );
    expect(secondaryToPrimary.teams.map((team) => team.teamId)).not.toContain(secondarySource.id);

    await move(teamId, secondaryDestination.id);
    const primaryToSecondary = await read();
    expectInvariant(primaryToSecondary);
    expect(primaryToSecondary.teamId).toBe(secondaryDestination.id);
    expect(primaryToSecondary.teams.map((team) => team.teamId)).not.toContain(teamId);
    expect(primaryToSecondary.teams.map((team) => team.teamId)).toContain(unrelated.id);

    await move(secondaryDestination.id, null);
    const promotedRemaining = await read();
    expectInvariant(promotedRemaining);
    expect(promotedRemaining.teamId).toBe(unrelated.id);
    expect(promotedRemaining.teams).toEqual([{ teamId: unrelated.id, isPrimary: true }]);

    await move(unrelated.id, null);
    const removedLast = await read();
    expectInvariant(removedLast);
    expect(removedLast.teamId).toBeNull();
    expect(removedLast.teams).toEqual([]);
  });

  it('requires assign for assignee and delegate group drops', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [assignee, item] = await Promise.all([
      schema.db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Assigned' })
        .returning({ id: schema.actor.id })
        .then(([row]) => row),
      schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Assignment gate',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        })
        .returning({ id: schema.task.id })
        .then(([row]) => row),
    ]);
    if (!assignee || !item) throw new Error('assignment seed failed');
    const [taskGrant] = await schema.db
      .insert(schema.grant)
      .values({
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: humanActorId,
        resourceKind: 'task',
        resourceId: item.id,
        capabilities: ['contribute'],
        effect: 'allow',
        cascades: false,
      })
      .returning({ id: schema.grant.id });
    if (!taskGrant) throw new Error('assignment grant seed failed');
    const contributor = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const assigner = appWithActor(workViews, orgId, ['assign'], humanActorId);
    for (const groupField of ['assignee', 'delegate']) {
      const request = {
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField,
        groupValue: { kind: 'actor', actorId: assignee.id },
        beforeId: null,
        afterId: null,
      };
      expect(
        (
          await contributor.request('/order', {
            method: 'PATCH',
            headers: JSON_HEADERS,
            body: JSON.stringify(request),
          })
        ).status,
      ).toBe(403);
      await schema.db
        .update(schema.grant)
        .set({ capabilities: ['assign'] })
        .where(eq(schema.grant.id, taskGrant.id));
      expect(
        (
          await assigner.request('/order', {
            method: 'PATCH',
            headers: JSON_HEADERS,
            body: JSON.stringify(request),
          })
        ).status,
      ).toBe(200);
      await schema.db
        .update(schema.grant)
        .set({ capabilities: ['contribute'] })
        .where(eq(schema.grant.id, taskGrant.id));
    }
  });

  it('accepts Team-scoped labels from the Task Team and any valid Project Team', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [secondaryTeam] = await schema.db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Secondary', key: `S${Date.now()}` })
      .returning({ id: schema.team.id });
    if (!secondaryTeam) throw new Error('secondary Team seed failed');
    const [taskLabel, primaryProjectLabel, projectLabel] = await schema.db
      .insert(schema.label)
      .values([
        { organizationId: orgId, teamId, name: 'Task Team label', color: 'red' },
        { organizationId: orgId, teamId, name: 'Primary Project Team label', color: 'green' },
        {
          organizationId: orgId,
          teamId: secondaryTeam.id,
          name: 'Project Team label',
          color: 'blue',
        },
      ])
      .returning({ id: schema.label.id });
    const [item, projectItem] = await Promise.all([
      schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Team label Task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        })
        .returning({ id: schema.task.id })
        .then(([row]) => row),
      schema.db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          teamId,
          name: 'Multi-Team Project',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id })
        .then(([row]) => row),
    ]);
    if (!taskLabel || !primaryProjectLabel || !projectLabel || !item || !projectItem) {
      throw new Error('Team label subject seed failed');
    }
    await schema.db.insert(schema.projectTeam).values({
      organizationId: orgId,
      projectId: projectItem.id,
      teamId: secondaryTeam.id,
      isPrimary: false,
    });
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    for (const request of [
      { target: 'task', itemId: item.id, labelId: taskLabel.id },
      { target: 'project', itemId: projectItem.id, labelId: primaryProjectLabel.id },
      { target: 'project', itemId: projectItem.id, labelId: projectLabel.id },
    ]) {
      const response = await app.request('/order', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: request.target,
          itemId: request.itemId,
          context: { kind: 'organization' },
          groupField: 'labels',
          sourceGroupValue: null,
          groupValue: request.labelId,
          beforeId: null,
          afterId: null,
        }),
      });
      expect(response.status).toBe(200);
    }
    const [taskLinks, projectLinks] = await Promise.all([
      schema.db
        .select({ labelId: schema.taskLabel.labelId })
        .from(schema.taskLabel)
        .where(eq(schema.taskLabel.taskId, item.id)),
      schema.db
        .select({ labelId: schema.projectLabel.labelId })
        .from(schema.projectLabel)
        .where(eq(schema.projectLabel.projectId, projectItem.id)),
    ]);
    expect(taskLinks).toEqual([{ labelId: taskLabel.id }]);
    expect(projectLinks).toEqual(
      expect.arrayContaining([{ labelId: primaryProjectLabel.id }, { labelId: projectLabel.id }]),
    );
    expect(projectLinks).toHaveLength(2);
  });

  it('moves and removes one Task label while preserving unrelated memberships', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [source, unrelated, destination] = await schema.db
      .insert(schema.label)
      .values([
        { organizationId: orgId, name: 'Source', color: 'red' },
        { organizationId: orgId, name: 'Unrelated', color: 'blue' },
        { organizationId: orgId, name: 'Destination', color: 'green' },
      ])
      .returning({ id: schema.label.id });
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Multi-label Task',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!source || !unrelated || !destination || !item) throw new Error('label move seed failed');
    await schema.db.insert(schema.taskLabel).values([
      { organizationId: orgId, taskId: item.id, labelId: source.id },
      { organizationId: orgId, taskId: item.id, labelId: unrelated.id },
    ]);
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const move = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'labels',
        sourceGroupValue: source.id,
        groupValue: destination.id,
        beforeId: null,
        afterId: null,
      }),
    });
    expect(move.status).toBe(200);
    const query = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(taskRequest()),
    });
    const page = WorkViewQueryResponse.parse(await query.json());
    if (page.target !== 'task') throw new Error('expected Task label page');
    expect(page.rows.find((row) => row.id === item.id)?.labels.sort()).toEqual(
      [unrelated.id, destination.id].sort(),
    );

    const remove = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'labels',
        sourceGroupValue: destination.id,
        groupValue: null,
        beforeId: null,
        afterId: null,
      }),
    });
    expect(remove.status).toBe(200);
    const links = await schema.db
      .select({ labelId: schema.taskLabel.labelId })
      .from(schema.taskLabel)
      .where(eq(schema.taskLabel.taskId, item.id));
    expect(links).toEqual([{ labelId: unrelated.id }]);
  });

  it('requires canonical Task grants for order and assignment mutations', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [assignee, item] = await Promise.all([
      schema.db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Grant assignee' })
        .returning({ id: schema.actor.id })
        .then(([row]) => row),
      schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Grant-gated order',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        })
        .returning({ id: schema.task.id })
        .then(([row]) => row),
    ]);
    if (!assignee || !item) throw new Error('Task grant seed failed');
    const [taskGrant] = await schema.db
      .insert(schema.grant)
      .values({
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: humanActorId,
        resourceKind: 'task',
        resourceId: item.id,
        capabilities: ['view'],
        effect: 'allow',
        cascades: false,
      })
      .returning({ id: schema.grant.id });
    if (!taskGrant) throw new Error('Task grant was not seeded');
    const orderBody = {
      target: 'task',
      itemId: item.id,
      context: { kind: 'organization' },
      groupField: null,
      groupValue: null,
      beforeId: null,
      afterId: null,
    };
    const injectedContributor = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    expect(
      (
        await injectedContributor.request('/order', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(orderBody),
        })
      ).status,
    ).toBe(403);

    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['contribute'] })
      .where(eq(schema.grant.id, taskGrant.id));
    const subjectContributor = appWithActor(workViews, orgId, ['view'], humanActorId);
    expect(
      (
        await subjectContributor.request('/order', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(orderBody),
        })
      ).status,
    ).toBe(200);
    const assignmentBody = {
      ...orderBody,
      groupField: 'assignee',
      groupValue: { kind: 'actor', actorId: assignee.id },
    };
    expect(
      (
        await subjectContributor.request('/order', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(assignmentBody),
        })
      ).status,
    ).toBe(403);

    await schema.db
      .update(schema.grant)
      .set({ capabilities: ['assign'] })
      .where(eq(schema.grant.id, taskGrant.id));
    expect(
      (
        await subjectContributor.request('/order', {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(assignmentBody),
        })
      ).status,
    ).toBe(200);
  });

  it('emits the canonical Task status event for a status group drop', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Status event',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!item) throw new Error('status seed failed');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'status',
        groupValue: 'done',
        beforeId: null,
        afterId: null,
      }),
    });
    expect(response.status).toBe(200);
    const events = await schema.db
      .select({ kind: schema.event.kind, detail: schema.event.detail })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.docketEntityId, item.id)));
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'completed',
        detail: expect.objectContaining({ fromState: 'todo', toState: 'done' }),
      }),
    );
  });

  it('rejects a Task milestone from another Project', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [firstProject, secondProject] = await schema.db
      .insert(schema.project)
      .values([
        {
          organizationId: orgId,
          teamId,
          name: 'Task Project',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        },
        {
          organizationId: orgId,
          teamId,
          name: 'Other Project',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        },
      ])
      .returning({ id: schema.project.id });
    if (!firstProject || !secondProject) throw new Error('milestone Projects were not seeded');
    const [otherMilestone, item] = await Promise.all([
      schema.db
        .insert(schema.milestone)
        .values({
          organizationId: orgId,
          projectId: secondProject.id,
          name: 'Wrong Project milestone',
        })
        .returning({ id: schema.milestone.id })
        .then(([row]) => row),
      schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          projectId: firstProject.id,
          title: 'Milestone-scoped Task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        })
        .returning({ id: schema.task.id })
        .then(([row]) => row),
    ]);
    if (!otherMilestone || !item) throw new Error('milestone Task was not seeded');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'milestone',
        groupValue: otherMilestone.id,
        beforeId: null,
        afterId: null,
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'validation_error',
      fieldErrors: { milestoneId: [{ code: 'invalid_value' }] },
    });
    const [unchanged] = await schema.db
      .select({ milestoneId: schema.task.milestoneId })
      .from(schema.task)
      .where(eq(schema.task.id, item.id));
    expect(unchanged?.milestoneId).toBeNull();
  });

  it('moves a Task onto a valid destination-Team status through the canonical transition', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [destinationTeam] = await schema.db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Destination', key: `D${orgId.slice(-4)}` })
      .returning({ id: schema.team.id });
    if (!destinationTeam) throw new Error('destination Team was not seeded');
    const [destinationStatus] = await schema.db
      .insert(schema.workStatus)
      .values({
        organizationId: orgId,
        teamId: destinationTeam.id,
        entityType: 'task',
        key: 'queue',
        name: 'Queue',
        category: 'unstarted',
        position: 0,
        isDefault: true,
      })
      .returning({ id: schema.workStatus.id });
    if (!destinationStatus) throw new Error('destination status was not seeded');
    const completedAt = new Date('2026-08-20T20:00:00.000Z');
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Move across workflows',
        state: 'done',
        statusId: statusId('task', 'done'),
        completedAt,
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!item) throw new Error('Team-transition Task was not seeded');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'team',
        groupValue: destinationTeam.id,
        beforeId: null,
        afterId: null,
      }),
    });
    expect(response.status).toBe(200);
    const [moved] = await schema.db
      .select({
        teamId: schema.task.teamId,
        statusId: schema.task.statusId,
        state: schema.task.state,
        completedAt: schema.task.completedAt,
        canceledAt: schema.task.canceledAt,
      })
      .from(schema.task)
      .where(eq(schema.task.id, item.id));
    expect(moved).toEqual({
      teamId: destinationTeam.id,
      statusId: destinationStatus.id,
      state: 'queue',
      completedAt: null,
      canceledAt: null,
    });
    const events = await schema.db
      .select({ kind: schema.event.kind, detail: schema.event.detail })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.docketEntityId, item.id)));
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'status_change',
        detail: expect.objectContaining({ fromState: 'done', toState: 'queue' }),
      }),
    );
  });

  it('treats a same-Team Task drop as rank-only without a status transition', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const completedAt = new Date('2026-08-20T20:00:00.000Z');
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Stay on Team',
        state: 'done',
        statusId: statusId('task', 'done'),
        completedAt,
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!item) throw new Error('same-Team Task was not seeded');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: item.id,
        context: { kind: 'organization' },
        groupField: 'team',
        groupValue: teamId,
        beforeId: null,
        afterId: null,
      }),
    });
    expect(response.status).toBe(200);
    const [unchanged] = await schema.db
      .select({
        teamId: schema.task.teamId,
        statusId: schema.task.statusId,
        state: schema.task.state,
        completedAt: schema.task.completedAt,
        canceledAt: schema.task.canceledAt,
      })
      .from(schema.task)
      .where(eq(schema.task.id, item.id));
    expect(unchanged).toEqual({
      teamId,
      statusId: statusId('task', 'done'),
      state: 'done',
      completedAt,
      canceledAt: null,
    });
    const statusEvents = await schema.db
      .select({ id: schema.event.id })
      .from(schema.event)
      .where(
        and(
          eq(schema.event.organizationId, orgId),
          eq(schema.event.docketEntityId, item.id),
          eq(schema.event.kind, 'status_change'),
        ),
      );
    expect(statusEvents).toHaveLength(0);
  });

  it('rolls back the group mutation when the rank write fails', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [item] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Atomic reorder',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        priority: 'low',
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!item) throw new Error('atomic reorder seed failed');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    await schema.db.execute(
      sql.raw(`
      create function fail_task6_order_write() returns trigger language plpgsql as $$
      begin raise exception 'forced order failure'; end $$
    `),
    );
    await schema.db.execute(
      sql.raw(`create trigger fail_task6_order_write before insert or update on work_item_order
        for each row execute function fail_task6_order_write()`),
    );
    try {
      const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
      const response = await app.request('/order', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'task',
          itemId: item.id,
          context: { kind: 'organization' },
          groupField: 'priority',
          groupValue: 'high',
          beforeId: null,
          afterId: null,
        }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ title: 'Something went wrong on our side.' });
      const [unchanged] = await schema.db
        .select({ priority: schema.task.priority })
        .from(schema.task)
        .where(eq(schema.task.id, item.id));
      expect(unchanged?.priority).toBe('low');
    } finally {
      await schema.db.execute(
        sql.raw(`drop trigger if exists fail_task6_order_write on work_item_order`),
      );
      await schema.db.execute(sql.raw(`drop function if exists fail_task6_order_write()`));
    }
  });

  it('clears nullable Task Project and Initiative lead-Team group values', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [project, task, initiative] = await Promise.all([
      schema.db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          teamId,
          name: 'Clearable Project',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id })
        .then(([row]) => row),
      schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Clear Project',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        })
        .returning({ id: schema.task.id })
        .then(([row]) => row),
      schema.db
        .insert(schema.initiative)
        .values({
          organizationId: orgId,
          name: 'Clear Team',
          status: 'active',
          statusId: statusId('initiative', 'active'),
          leadTeamId: teamId,
        })
        .returning({ id: schema.initiative.id })
        .then(([row]) => row),
    ]);
    if (!project || !task || !initiative) throw new Error('nullable group seed failed');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    await schema.db
      .update(schema.task)
      .set({ projectId: project.id })
      .where(eq(schema.task.id, task.id));
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    for (const request of [
      { target: 'task', itemId: task.id, groupField: 'project' },
      { target: 'initiative', itemId: initiative.id, groupField: 'leadTeam' },
    ]) {
      const response = await app.request('/order', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ...request,
          context: { kind: 'organization' },
          groupValue: null,
          beforeId: null,
          afterId: null,
        }),
      });
      expect(response.status).toBe(200);
    }
    const [clearedTask] = await schema.db
      .select({ projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, task.id));
    const [clearedInitiative] = await schema.db
      .select({ leadTeamId: schema.initiative.leadTeamId })
      .from(schema.initiative)
      .where(eq(schema.initiative.id, initiative.id));
    expect(clearedTask?.projectId).toBeNull();
    expect(clearedInitiative?.leadTeamId).toBeNull();
  });

  it('uses manual rank inside an explicit priority sort and preserves continuation order', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const items = await schema.db
      .insert(schema.task)
      .values(
        ['First by id', 'Middle by id', 'Last by id'].map((title) => ({
          organizationId: orgId,
          teamId,
          title,
          state: 'todo' as const,
          statusId: statusId('task', 'todo'),
          priority: 'high' as const,
          visibility: 'public' as const,
        })),
      )
      .returning({ id: schema.task.id, title: schema.task.title });
    const orderedById = [...items].sort((left, right) => left.id.localeCompare(right.id));
    const first = orderedById[0];
    const middle = orderedById[1];
    const moved = orderedById[2];
    if (!first || !middle || !moved) throw new Error('priority order seed failed');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const reorder = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: moved.id,
        context: { kind: 'organization' },
        groupField: null,
        groupValue: null,
        beforeId: first.id,
        afterId: null,
      }),
    });
    expect(reorder.status).toBe(200);
    for (const direction of ['asc', 'desc'] as const) {
      const request = taskRequest({
        definition: {
          ...taskRequest().definition,
          arrangement: {
            groupBy: null,
            subGroupBy: null,
            orderBy: [{ field: 'priority', direction }],
          },
        },
        limit: 2,
      });
      const firstPageResponse = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
      });
      const firstPage = WorkViewQueryResponse.parse(await firstPageResponse.json());
      if (firstPage.target !== 'task') throw new Error('expected Task priority page');
      expect(firstPage.rows.map((row) => row.id)).toEqual([moved.id, first.id]);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPageResponse = await app.request('/query', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...request, cursor: firstPage.nextCursor }),
      });
      const secondPage = WorkViewQueryResponse.parse(await secondPageResponse.json());
      if (secondPage.target !== 'task') throw new Error('expected Task priority continuation');
      expect(secondPage.rows.map((row) => row.id)).toEqual([middle.id]);
    }
  });

  it('materializes unranked neighbors before placing a moved item between them', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const items = await schema.db
      .insert(schema.task)
      .values(
        ['Unranked first', 'Unranked second', 'Unranked moved'].map((title) => ({
          organizationId: orgId,
          teamId,
          title,
          state: 'todo' as const,
          statusId: statusId('task', 'todo'),
          visibility: 'public' as const,
        })),
      )
      .returning({ id: schema.task.id });
    const ordered = [...items].sort((left, right) => left.id.localeCompare(right.id));
    const after = ordered[0];
    const before = ordered[1];
    const moved = ordered[2];
    if (!after || !before || !moved) throw new Error('unranked order seed failed');
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: moved.id,
        context: { kind: 'organization' },
        groupField: null,
        groupValue: null,
        beforeId: before.id,
        afterId: after.id,
      }),
    });
    expect(response.status).toBe(200);
    const ranks = await schema.db
      .select({ itemId: schema.workItemOrder.itemId, rank: schema.workItemOrder.rank })
      .from(schema.workItemOrder)
      .where(eq(schema.workItemOrder.organizationId, orgId));
    const byItem = new Map(ranks.map((entry) => [entry.itemId, entry.rank]));
    const afterRank = byItem.get(after.id);
    const beforeRank = byItem.get(before.id);
    const movedRank = byItem.get(moved.id);
    if (!afterRank || !beforeRank || !movedRank) throw new Error('neighbors were not materialized');
    expect(afterRank < movedRank).toBe(true);
    expect(movedRank < beforeRank).toBe(true);

    const query = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(taskRequest()),
    });
    const page = WorkViewQueryResponse.parse(await query.json());
    if (page.target !== 'task') throw new Error('expected Task manual-order page');
    expect(page.rows.map((row) => row.id)).toEqual([after.id, moved.id, before.id]);
  });

  it('serializes overlapping context reorders without overwriting either rank', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [after, firstMoved, secondMoved, before] = await schema.db
      .insert(schema.task)
      .values(
        ['Concurrent after', 'Concurrent first', 'Concurrent second', 'Concurrent before'].map(
          (title) => ({
            organizationId: orgId,
            teamId,
            title,
            state: 'todo' as const,
            statusId: statusId('task', 'todo'),
            visibility: 'public' as const,
          }),
        ),
      )
      .returning({ id: schema.task.id });
    if (!after || !firstMoved || !secondMoved || !before) {
      throw new Error('concurrent order seed failed');
    }
    await schema.db.insert(schema.workItemOrder).values([
      {
        organizationId: orgId,
        contextType: 'organization',
        contextId: orgId,
        target: 'task',
        itemId: after.id,
        rank: FractionalRank.parse('A'),
      },
      {
        organizationId: orgId,
        contextType: 'organization',
        contextId: orgId,
        target: 'task',
        itemId: before.id,
        rank: FractionalRank.parse('M'),
      },
    ]);
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const move = (itemId: string) =>
      app.request('/order', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'task',
          itemId,
          context: { kind: 'organization' },
          groupField: null,
          groupValue: null,
          beforeId: before.id,
          afterId: after.id,
        }),
      });

    const [firstResponse, secondResponse] = await Promise.all([
      move(firstMoved.id),
      move(secondMoved.id),
    ]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const rows = await schema.db
      .select({ itemId: schema.workItemOrder.itemId, rank: schema.workItemOrder.rank })
      .from(schema.workItemOrder)
      .where(sql`${schema.workItemOrder.itemId} in (${firstMoved.id}, ${secondMoved.id})`);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.rank)).size).toBe(2);
    for (const row of rows) {
      expect(row.rank > 'A' && row.rank < 'M').toBe(true);
    }
  });

  it('materializes one unranked neighbor beside an existing persisted neighbor', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [after, moved, before] = await schema.db
      .insert(schema.task)
      .values(
        ['Unranked after', 'Single-neighbor moved', 'Persisted before'].map((title) => ({
          organizationId: orgId,
          teamId,
          title,
          state: 'todo' as const,
          statusId: statusId('task', 'todo'),
          visibility: 'public' as const,
        })),
      )
      .returning({ id: schema.task.id });
    if (!after || !moved || !before) throw new Error('single-neighbor rank seed failed');
    await schema.db.insert(schema.workItemOrder).values({
      organizationId: orgId,
      contextType: 'organization',
      contextId: orgId,
      target: 'task',
      itemId: before.id,
      rank: FractionalRank.parse('M'),
    });
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: moved.id,
        context: { kind: 'organization' },
        groupField: null,
        groupValue: null,
        beforeId: before.id,
        afterId: after.id,
      }),
    });
    expect(response.status).toBe(200);
    const rows = await schema.db
      .select({ itemId: schema.workItemOrder.itemId, rank: schema.workItemOrder.rank })
      .from(schema.workItemOrder)
      .where(eq(schema.workItemOrder.organizationId, orgId));
    const ranks = new Map(rows.map((row) => [row.itemId, row.rank]));
    const afterRank = ranks.get(after.id);
    const movedRank = ranks.get(moved.id);
    const beforeRank = ranks.get(before.id);
    if (!afterRank || !movedRank || !beforeRank) throw new Error('single neighbor was not ranked');
    expect(afterRank < movedRank).toBe(true);
    expect(movedRank < beforeRank).toBe(true);
  });

  it('rebalances an exhausted persisted tail before materializing two unranked neighbors', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [tail, after, moved, before] = await schema.db
      .insert(schema.task)
      .values(
        ['Exhausted tail', 'Fresh after', 'Fresh moved', 'Fresh before'].map((title) => ({
          organizationId: orgId,
          teamId,
          title,
          state: 'todo' as const,
          statusId: statusId('task', 'todo'),
          visibility: 'public' as const,
        })),
      )
      .returning({ id: schema.task.id });
    if (!tail || !after || !moved || !before) throw new Error('exhausted-tail seed failed');
    await schema.db.insert(schema.workItemOrder).values({
      organizationId: orgId,
      contextType: 'organization',
      contextId: orgId,
      target: 'task',
      itemId: tail.id,
      rank: FractionalRank.parse('z'.repeat(128)),
    });
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: moved.id,
        context: { kind: 'organization' },
        groupField: null,
        groupValue: null,
        beforeId: before.id,
        afterId: after.id,
      }),
    });
    expect(response.status).toBe(200);
    const rows = await schema.db
      .select({ itemId: schema.workItemOrder.itemId, rank: schema.workItemOrder.rank })
      .from(schema.workItemOrder)
      .where(eq(schema.workItemOrder.organizationId, orgId));
    const ranks = new Map(rows.map((row) => [row.itemId, row.rank]));
    const tailRank = ranks.get(tail.id);
    const afterRank = ranks.get(after.id);
    const movedRank = ranks.get(moved.id);
    const beforeRank = ranks.get(before.id);
    if (!tailRank || !afterRank || !movedRank || !beforeRank) {
      throw new Error('exhausted-tail neighbors were not ranked');
    }
    expect(tailRank < afterRank).toBe(true);
    expect(afterRank < movedRank).toBe(true);
    expect(movedRank < beforeRank).toBe(true);
    for (const rank of ranks.values()) expect(FractionalRank.safeParse(rank).success).toBe(true);
  });

  it('rebalances exhausted prepend and append ranks without breaking cursor continuation', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const createTask = async (title: string): Promise<string> => {
      const [created] = await schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title,
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        })
        .returning({ id: schema.task.id });
      if (!created) throw new Error('rank stress Task was not seeded');
      return created.id;
    };
    const move = async (
      itemId: string,
      beforeId: string | null,
      afterId: string | null,
    ): Promise<void> => {
      const response = await app.request('/order', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          target: 'task',
          itemId,
          context: { kind: 'organization' },
          groupField: null,
          groupValue: null,
          beforeId,
          afterId,
        }),
      });
      expect(response.status).toBe(200);
    };

    const appended: string[] = [];
    let last = await createTask('Append 0');
    appended.push(last);
    await move(last, null, null);
    for (let index = 1; index < 132; index += 1) {
      const itemId = await createTask(`Append ${index}`);
      await move(itemId, null, last);
      appended.push(itemId);
      last = itemId;
    }

    const prepended: string[] = [];
    let first = appended[0];
    if (!first) throw new Error('append order unexpectedly empty');
    for (let index = 0; index < 24; index += 1) {
      const itemId = await createTask(`Prepend ${index}`);
      await move(itemId, first, null);
      prepended.push(itemId);
      first = itemId;
    }
    const expected = [...prepended].reverse().concat(appended);
    const stored = await schema.db
      .select({ itemId: schema.workItemOrder.itemId, rank: schema.workItemOrder.rank })
      .from(schema.workItemOrder)
      .where(eq(schema.workItemOrder.organizationId, orgId));
    expect(stored).toHaveLength(expected.length);
    for (const entry of stored) {
      expect(FractionalRank.safeParse(entry.rank).success).toBe(true);
      expect(entry.rank.length).toBeLessThanOrEqual(128);
      expect(entry.rank.endsWith('.')).toBe(false);
    }

    const request = taskRequest({ limit: 100 });
    const firstResponse = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
    const firstPage = WorkViewQueryResponse.parse(await firstResponse.json());
    if (firstPage.target !== 'task') throw new Error('expected first rank stress page');
    expect(firstPage.rows.map((row) => row.id)).toEqual(expected.slice(0, 100));
    expect(firstPage.nextCursor).not.toBeNull();
    const secondResponse = await app.request('/query', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...request, cursor: firstPage.nextCursor }),
    });
    const secondPage = WorkViewQueryResponse.parse(await secondResponse.json());
    if (secondPage.target !== 'task') throw new Error('expected second rank stress page');
    expect(secondPage.rows.map((row) => row.id)).toEqual(expected.slice(100));
    expect(secondPage.nextCursor).toBeNull();
  });

  it('rebalances a bounded persisted neighborhood before assigning an exhausted rank', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await grantOrganizationCapability(orgId, humanActorId, 'contribute');
    const taskStatusId = statusId('task', 'todo');
    const oldWrite = new Date('2020-01-01T00:00:00.000Z');
    const itemId = (position: number): string => `B${String(position).padStart(25, '0')}`;
    await schema.db.execute(sql`insert into task (
        id, organization_id, team_id, title, state, status_id, visibility
      )
      select 'B' || lpad(series::text, 25, '0'), ${orgId}, ${teamId},
        'Rank neighborhood ' || series, 'todo', ${taskStatusId}, 'public'
      from generate_series(1, 180) series`);
    await schema.db.execute(sql`insert into work_item_order (
        organization_id, context_type, context_id, target, item_id, rank, updated_at
      )
      select ${orgId}, 'organization', ${orgId}, 'task',
        'B' || lpad(series::text, 25, '0'),
        'R' || lpad((series * 1000)::text, 20, '0'), ${oldWrite}
      from generate_series(1, 180) series`);
    const afterId = itemId(90);
    const beforeId = itemId(91);
    const movedId = itemId(130);
    const exhaustedRank = `R${String(90 * 1000).padStart(20, '0')}`;
    await schema.db.execute(
      sql`update work_item_order set rank=${exhaustedRank}, updated_at=${oldWrite}
      where organization_id=${orgId} and item_id between ${itemId(71)} and ${itemId(110)}`,
    );

    const app = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const response = await app.request('/order', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        target: 'task',
        itemId: movedId,
        context: { kind: 'organization' },
        groupField: null,
        groupValue: null,
        beforeId,
        afterId,
      }),
    });
    expect(response.status).toBe(200);
    const rewritten = await schema.db
      .select({ itemId: schema.workItemOrder.itemId })
      .from(schema.workItemOrder)
      .where(
        and(
          eq(schema.workItemOrder.organizationId, orgId),
          gt(schema.workItemOrder.updatedAt, oldWrite),
        ),
      );
    expect(rewritten.length).toBeGreaterThan(1);
    expect(rewritten.length).toBeLessThanOrEqual(129);
  });

  it('authorizes an Initiative reorder by exact points inside a large hierarchy context', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const activeStatusId = statusId('initiative', 'active');
    await schema.db.execute(sql`insert into initiative (
        id, organization_id, name, status, status_id
      )
      select 'N' || lpad(series::text, 25, '0'), ${orgId}, 'Noise ' || series,
        'active', ${activeStatusId}
      from generate_series(1, 20000) series`);
    const [root, after, before, moved] = await schema.db
      .insert(schema.initiative)
      .values(
        ['Large root', 'Large after', 'Large before', 'Large moved'].map((name) => ({
          organizationId: orgId,
          name,
          status: 'active' as const,
          statusId: activeStatusId,
        })),
      )
      .returning({ id: schema.initiative.id });
    if (!root || !after || !before || !moved) throw new Error('large Initiative seed failed');
    await schema.db.insert(schema.initiativeHierarchyLink).values(
      [after.id, before.id, moved.id].map((childInitiativeId) => ({
        contextOrganizationId: orgId,
        parentInitiativeId: root.id,
        childInitiativeId,
      })),
    );
    const oldWrite = new Date('2020-01-01T00:00:00.000Z');
    await schema.db.insert(schema.workItemOrder).values([
      {
        organizationId: orgId,
        contextType: 'initiative',
        contextId: root.id,
        target: 'initiative',
        itemId: after.id,
        rank: FractionalRank.parse('A'),
        updatedAt: oldWrite,
      },
      {
        organizationId: orgId,
        contextType: 'initiative',
        contextId: root.id,
        target: 'initiative',
        itemId: before.id,
        rank: FractionalRank.parse('C'),
        updatedAt: oldWrite,
      },
      {
        organizationId: orgId,
        contextType: 'initiative',
        contextId: root.id,
        target: 'initiative',
        itemId: moved.id,
        rank: FractionalRank.parse('Z'),
        updatedAt: oldWrite,
      },
    ]);
    const originalExecute = schema.db.execute.bind(schema.db);
    const execute = vi.fn(originalExecute);
    const database = new Proxy(schema.db, {
      get(target, property, receiver) {
        if (property === 'execute') return execute;
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await reorderWorkView({
      database,
      organizationId: orgId,
      actorId: humanActorId,
      capabilities: ['contribute'],
      request: WorkViewOrderRequest.parse({
        target: 'initiative',
        itemId: moved.id,
        context: { kind: 'initiative', initiativeId: root.id },
        groupField: null,
        groupValue: null,
        beforeId: before.id,
        afterId: after.id,
      }),
    });
    const statements = execute.mock.calls.map(([statement]) =>
      new PgDialect().sqlToQuery(statement as SQL).sql.toLowerCase(),
    );
    expect(
      statements.some((statement) => statement.includes('authorized_base as materialized')),
    ).toBe(false);
    expect(
      statements.some(
        (statement) => statement.includes('from initiative e') && statement.includes('e.id in'),
      ),
    ).toBe(true);
    const changed = await schema.db
      .select({ itemId: schema.workItemOrder.itemId })
      .from(schema.workItemOrder)
      .where(
        and(
          eq(schema.workItemOrder.organizationId, orgId),
          gt(schema.workItemOrder.updatedAt, oldWrite),
        ),
      );
    expect(changed).toEqual([{ itemId: moved.id }]);
  });

  it('requires manage to update a target-specific organization default', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
    const definition = projectRequest().definition;
    const contributor = appWithActor(workViews, orgId, ['contribute'], humanActorId);
    const forbidden = await contributor.request('/defaults/project', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ definition }),
    });
    expect(forbidden.status).toBe(403);

    const manager = appWithActor(workViews, orgId, ['manage'], humanActorId);
    const updated = await manager.request('/defaults/project', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ definition }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      target: 'project',
      definition: { target: 'project' },
      updatedBy: humanActorId,
    });

    const read = await contributor.request('/defaults/project');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ target: 'project', definition });
  });

  it('returns an owned 500 when a stored organization default violates its output contract', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
    await schema.db.execute(sql`
      insert into organization_work_view_default (
        organization_id,
        target,
        definition,
        updated_by
      ) values (
        ${orgId},
        'task',
        ${JSON.stringify(projectRequest().definition)}::jsonb,
        ${humanActorId}
      )
    `);
    const app = appWithActor(workViews, orgId, ['view'], humanActorId);

    const response = await app.request('/defaults/task');

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      status: 500,
      code: 'internal',
      title: 'Something went wrong on our side.',
    });
    expect(body).not.toHaveProperty('fieldErrors');
    expect(JSON.stringify(body)).not.toContain('definition');
  });

  it('returns an owned 500 when an organization default mutation returns corrupt output', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
    await schema.db.execute(
      sql.raw(`
        create function corrupt_task6_default_output() returns trigger language plpgsql as $$
        begin
          new.definition := '{}'::jsonb;
          return new;
        end $$
      `),
    );
    await schema.db.execute(
      sql.raw(`
        create trigger corrupt_task6_default_output
        before insert or update on organization_work_view_default
        for each row execute function corrupt_task6_default_output()
      `),
    );
    try {
      const manager = appWithActor(workViews, orgId, ['manage'], humanActorId);
      const response = await manager.request('/defaults/project', {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ definition: projectRequest().definition }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toMatchObject({
        status: 500,
        code: 'internal',
        title: 'Something went wrong on our side.',
      });
      expect(body).not.toHaveProperty('fieldErrors');
      expect(JSON.stringify(body)).not.toContain('definition');
    } finally {
      await schema.db.execute(
        sql.raw(
          `drop trigger if exists corrupt_task6_default_output on organization_work_view_default`,
        ),
      );
      await schema.db.execute(sql.raw(`drop function if exists corrupt_task6_default_output()`));
    }
  });

  it('rejects a default definition that does not match the target path', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema);
    const manager = appWithActor(workViews, orgId, ['manage'], humanActorId);
    const response = await manager.request('/defaults/program', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ definition: taskRequest().definition }),
    });
    expect(response.status).toBe(422);
  });
});
