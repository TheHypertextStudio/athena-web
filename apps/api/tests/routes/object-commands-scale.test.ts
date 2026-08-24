import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as AfterResponseModule from '../../src/lib/after-response';
import type objectCommandsRouter from '../../src/routes/object-commands';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';

vi.mock('../../src/lib/after-response', async (importOriginal) => {
  const actual = await importOriginal<typeof AfterResponseModule>();
  return { ...actual, deferAfterResponse: vi.fn() };
});

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let objectCommands!: typeof objectCommandsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  objectCommands = (await import('../../src/routes/object-commands')).default;
});

afterEach(() => {
  schema.setDatabaseQueryObserver(undefined);
});

describe('object command scale', () => {
  it('keeps maximum relation commands and replay within bounded query counts', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const projects = await db
      .insert(schema.project)
      .values(
        Array.from({ length: 500 }, (_, index) => ({
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          createdBy: seeded.humanActorId,
          name: `Scale Project ${index}`,
          status: 'planned',
          statusId: seeded.statusId('project', 'planned'),
        })),
      )
      .returning({ id: schema.project.id });
    const labels = await db
      .insert(schema.label)
      .values(
        Array.from({ length: 10 }, (_, index) => ({
          organizationId: seeded.orgId,
          name: `Scale Label ${index}`,
          color: 'blue' as const,
        })),
      )
      .returning({ id: schema.label.id });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    let queryCount = 0;
    schema.setDatabaseQueryObserver(() => {
      queryCount += 1;
    });
    const request = async (body: Record<string, unknown>): Promise<Response> =>
      app.request('/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': String(body['commandId']),
        },
        body: JSON.stringify(body),
      });

    const forwardStart = queryCount;
    const forward = await request({
      commandId: 'maximum-scale-label-command',
      objectKind: 'project',
      objectIds: projects.map((row) => row.id),
      operation: {
        type: 'add_association',
        association: 'label',
        associationIds: labels.map((row) => row.id),
      },
    });
    const forwardQueries = queryCount - forwardStart;
    expect(forward.status).toBe(200);
    const payload = (await forward.json()) as { receipt: Record<string, unknown> };

    const replayStart = queryCount;
    const replay = await request({
      commandId: 'maximum-scale-label-undo',
      direction: 'undo',
      receipt: payload.receipt,
    });
    const replayQueries = queryCount - replayStart;
    expect(replay.status).toBe(200);
    expect(forwardQueries).toBeGreaterThan(0);
    expect(replayQueries).toBeGreaterThan(0);
    expect(forwardQueries).toBeLessThanOrEqual(60);
    expect(replayQueries).toBeLessThanOrEqual(40);
  });

  it('keeps 500-Project scalar, status, timeframe, and replay commands bounded', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const projects = await db
      .insert(schema.project)
      .values(
        Array.from({ length: 500 }, (_, index) => ({
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          createdBy: seeded.humanActorId,
          name: `Scalar Project ${index}`,
          status: 'planned',
          statusId: seeded.statusId('project', 'planned'),
        })),
      )
      .returning({ id: schema.project.id });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    let queryCount = 0;
    schema.setDatabaseQueryObserver(() => {
      queryCount += 1;
    });
    const request = async (body: Record<string, unknown>): Promise<Response> =>
      app.request('/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': String(body['commandId']),
        },
        body: JSON.stringify(body),
      });
    const measured = async (
      body: Record<string, unknown>,
    ): Promise<{ readonly response: Response; readonly count: number }> => {
      const start = queryCount;
      const response = await request(body);
      return { response, count: queryCount - start };
    };
    const ids = projects.map((row) => row.id);

    const scalar = await measured({
      commandId: 'scale-project-scalar',
      objectKind: 'project',
      objectIds: ids,
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    expect(scalar.response.status).toBe(200);
    expect(scalar.count).toBeGreaterThan(0);
    expect(scalar.count).toBeLessThanOrEqual(80);
    const scalarPayload = (await scalar.response.json()) as { receipt: Record<string, unknown> };

    const status = await measured({
      commandId: 'scale-project-status',
      objectKind: 'project',
      objectIds: ids,
      operation: { type: 'replace_property', property: 'status', value: 'active' },
    });
    expect(status.response.status).toBe(200);
    expect(status.count).toBeGreaterThan(0);
    expect(status.count).toBeLessThanOrEqual(100);

    const timeframe = await measured({
      commandId: 'scale-project-timeframe',
      objectKind: 'project',
      objectIds: ids,
      operation: {
        type: 'replace_property',
        property: 'startTimeframe',
        value: { date: '2026-07-01', resolution: 'quarter' },
      },
    });
    expect(timeframe.response.status).toBe(200);
    expect(timeframe.count).toBeGreaterThan(0);
    expect(timeframe.count).toBeLessThanOrEqual(80);

    const replay = await measured({
      commandId: 'scale-project-scalar-undo',
      direction: 'undo',
      receipt: scalarPayload.receipt,
    });
    expect(replay.response.status).toBe(200);
    expect(replay.count).toBeGreaterThan(0);
    expect(replay.count).toBeLessThanOrEqual(100);
  });

  it('keeps 500-Task status, milestone, and hierarchy commands bounded', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const [projectRow] = await db
      .insert(schema.project)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        createdBy: seeded.humanActorId,
        name: 'Task scale Project',
        status: 'planned',
        statusId: seeded.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    if (!projectRow) throw new Error('Task scale Project insert failed');
    const [parent] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        projectId: projectRow.id,
        title: 'Bulk parent',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!parent) throw new Error('Task scale parent insert failed');
    const tasks = await db
      .insert(schema.task)
      .values(
        Array.from({ length: 500 }, (_, index) => ({
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          projectId: projectRow.id,
          title: `Scale Task ${index}`,
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        })),
      )
      .returning({ id: schema.task.id });
    const [milestoneRow] = await db
      .insert(schema.milestone)
      .values({
        organizationId: seeded.orgId,
        projectId: projectRow.id,
        name: 'Scale milestone',
      })
      .returning({ id: schema.milestone.id });
    if (!milestoneRow) throw new Error('Task scale milestone insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    let queryCount = 0;
    schema.setDatabaseQueryObserver(() => {
      queryCount += 1;
    });
    const request = async (body: Record<string, unknown>): Promise<number> => {
      const start = queryCount;
      const response = await app.request('/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': String(body['commandId']),
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return queryCount - start;
    };
    const ids = tasks.map((row) => row.id);

    const statusQueries = await request({
      commandId: 'scale-task-status',
      objectKind: 'task',
      objectIds: ids,
      operation: { type: 'replace_property', property: 'state', value: 'done' },
    });
    expect(statusQueries).toBeGreaterThan(0);
    expect(statusQueries).toBeLessThanOrEqual(100);
    const milestoneQueries = await request({
      commandId: 'scale-task-milestone',
      objectKind: 'task',
      objectIds: ids,
      operation: {
        type: 'replace_property',
        property: 'milestoneId',
        value: milestoneRow.id,
      },
    });
    expect(milestoneQueries).toBeGreaterThan(0);
    expect(milestoneQueries).toBeLessThanOrEqual(80);
    const hierarchyQueries = await request({
      commandId: 'scale-task-hierarchy',
      objectKind: 'task',
      objectIds: ids,
      operation: { type: 'change_parent', parentId: parent.id },
    });
    expect(hierarchyQueries).toBeGreaterThan(0);
    expect(hierarchyQueries).toBeLessThanOrEqual(100);
  });
});
