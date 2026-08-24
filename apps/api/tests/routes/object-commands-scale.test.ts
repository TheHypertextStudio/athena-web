import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { PGlite } from '@electric-sql/pglite';

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
    const client = Reflect.get(db, '$client') as Pick<PGlite, 'query'>;
    const queries = vi.spyOn(client, 'query');
    const request = async (body: Record<string, unknown>): Promise<Response> =>
      app.request('/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': String(body['commandId']),
        },
        body: JSON.stringify(body),
      });

    const forwardStart = queries.mock.calls.length;
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
    const forwardQueries = queries.mock.calls.length - forwardStart;
    expect(forward.status).toBe(200);
    const payload = (await forward.json()) as { receipt: Record<string, unknown> };

    const replayStart = queries.mock.calls.length;
    const replay = await request({
      commandId: 'maximum-scale-label-undo',
      direction: 'undo',
      receipt: payload.receipt,
    });
    const replayQueries = queries.mock.calls.length - replayStart;
    expect(replay.status).toBe(200);
    expect(forwardQueries).toBeLessThanOrEqual(60);
    expect(replayQueries).toBeLessThanOrEqual(40);
    queries.mockRestore();
  });
});
