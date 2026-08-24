import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import type * as AfterResponseModule from '../../src/lib/after-response';
import { EntityWriteBus, type EntityWriteEvent } from '../../src/events/entity-write-bus';
import { setEntityWriteBus } from '../../src/events/entity-write-registry';
import {
  enqueueObjectCommandEffectJob,
  processObjectCommandEffectJobs,
} from '../../src/lib/object-command-effects';
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

describe('object command effect outbox', () => {
  it('exposes a durable command-effect job table', () => {
    expect(Reflect.get(schema, 'objectCommandEffectJob')).toBeDefined();
  });

  it('commits a pending consequence job beside the object mutation', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const [projectRow] = await db
      .insert(schema.project)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        createdBy: seeded.humanActorId,
        name: 'Durable consequence',
        status: 'planned',
        statusId: seeded.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    if (!projectRow) throw new Error('outbox fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);

    const response = await app.request('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `outbox-${projectRow.id}`,
      },
      body: JSON.stringify({
        commandId: `outbox-${projectRow.id}`,
        objectKind: 'project',
        objectIds: [projectRow.id],
        operation: { type: 'replace_property', property: 'priority', value: 'high' },
      }),
    });

    expect(response.status).toBe(200);
    expect(
      await db
        .select({
          commandId: schema.objectCommandEffectJob.commandId,
          status: schema.objectCommandEffectJob.status,
        })
        .from(schema.objectCommandEffectJob)
        .where(eq(schema.objectCommandEffectJob.organizationId, seeded.orgId)),
    ).toEqual([{ commandId: `outbox-${projectRow.id}`, status: 'pending' }]);
  });

  it('exposes a worker that can drain committed consequence jobs', async () => {
    const effects = await import('../../src/lib/object-command-effects');
    expect(Reflect.get(effects, 'processObjectCommandEffectJobs')).toBeTypeOf('function');
  });

  it('treats a duplicate durable consequence enqueue as an idempotent no-op', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const commandId = `duplicate-outbox-${seeded.orgId}`;
    const payload = {
      version: 1 as const,
      organizationId: seeded.orgId,
      actorId: seeded.humanActorId,
      commandId,
      occurredAt: new Date().toISOString(),
      effects: [
        {
          kind: 'entity_write' as const,
          sourceTable: 'project' as const,
          entityId: 'project-idempotent',
          operation: 'upsert' as const,
        },
      ],
    };

    const result = await db.transaction(async (tx) => ({
      first: await enqueueObjectCommandEffectJob(tx, payload),
      duplicate: await enqueueObjectCommandEffectJob(tx, payload),
    }));

    try {
      expect(result.first).toEqual(expect.any(String));
      expect(result.duplicate).toBeNull();
      expect(
        await db
          .select({ id: schema.objectCommandEffectJob.id })
          .from(schema.objectCommandEffectJob)
          .where(eq(schema.objectCommandEffectJob.commandId, commandId)),
      ).toHaveLength(1);
    } finally {
      await db
        .delete(schema.objectCommandEffectJob)
        .where(eq(schema.objectCommandEffectJob.commandId, commandId));
    }
  });

  it('publishes a committed consequence after the request process loses deferred work', async () => {
    await db.delete(schema.objectCommandEffectJob);
    const writes: EntityWriteEvent[] = [];
    setEntityWriteBus(
      new EntityWriteBus().subscribe({
        name: 'durable-command-effect-test',
        handle: async (event) => {
          writes.push(event);
        },
      }),
    );
    try {
      const seeded = await seedTaskAccessOrg(db, schema, 'manage');
      const [projectRow] = await db
        .insert(schema.project)
        .values({
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          createdBy: seeded.humanActorId,
          name: 'Recovered consequence',
          status: 'planned',
          statusId: seeded.statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id });
      if (!projectRow) throw new Error('outbox recovery fixture insert failed');
      const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
      const commandId = `recover-outbox-${projectRow.id}`;
      const response = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': commandId },
        body: JSON.stringify({
          commandId,
          objectKind: 'project',
          objectIds: [projectRow.id],
          operation: { type: 'replace_property', property: 'priority', value: 'high' },
        }),
      });
      expect(response.status).toBe(200);
      expect(writes).toEqual([]);

      expect(await processObjectCommandEffectJobs({ limit: 10 })).toEqual({
        processed: 1,
        succeeded: 1,
        failed: 0,
      });
      expect(writes).toEqual([
        {
          organizationId: seeded.orgId,
          sourceTable: 'project',
          entityId: projectRow.id,
          operation: 'upsert',
        },
      ]);
      expect(
        await db
          .select({ status: schema.objectCommandEffectJob.status })
          .from(schema.objectCommandEffectJob)
          .where(eq(schema.objectCommandEffectJob.commandId, commandId)),
      ).toEqual([{ status: 'succeeded' }]);
    } finally {
      setEntityWriteBus(undefined);
    }
  });

  it('recovers Task state, assignment, and Project status consequences', async () => {
    await db.delete(schema.objectCommandEffectJob);
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Recover every Task consequence',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    const [projectRow] = await db
      .insert(schema.project)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        createdBy: seeded.humanActorId,
        name: 'Recover Project status',
        status: 'planned',
        statusId: seeded.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    if (!taskRow || !projectRow) throw new Error('outbox consequence fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const request = async (body: Record<string, unknown>): Promise<Response> =>
      app.request('/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': String(body['commandId']),
        },
        body: JSON.stringify(body),
      });

    expect(
      (
        await request({
          commandId: `recover-state-${taskRow.id}`,
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: { type: 'replace_property', property: 'state', value: 'done' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request({
          commandId: `recover-assignment-${taskRow.id}`,
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: {
            type: 'replace_property',
            property: 'assigneeId',
            value: seeded.humanActorId,
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request({
          commandId: `recover-project-status-${projectRow.id}`,
          objectKind: 'project',
          objectIds: [projectRow.id],
          operation: { type: 'replace_property', property: 'status', value: 'active' },
        })
      ).status,
    ).toBe(200);
    expect(
      await db.select().from(schema.event).where(eq(schema.event.organizationId, seeded.orgId)),
    ).toEqual([]);

    expect(await processObjectCommandEffectJobs({ limit: 10 })).toEqual({
      processed: 3,
      succeeded: 3,
      failed: 0,
    });
    const events = await db
      .select({ kind: schema.event.kind })
      .from(schema.event)
      .where(eq(schema.event.organizationId, seeded.orgId));
    expect(events).toEqual(
      expect.arrayContaining([
        { kind: 'completed' },
        { kind: 'assignment' },
        { kind: 'status_change' },
      ]),
    );
    const audit = await db
      .select({ metadata: schema.auditEvent.metadata })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, taskRow.id));
    expect(audit.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'state', from: 'Backlog', to: 'Done' }),
        expect.objectContaining({ field: 'assigneeId', to: 'Ada' }),
      ]),
    );
  });
});
