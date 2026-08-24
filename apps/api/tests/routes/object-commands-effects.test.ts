import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';

import type objectCommandsRouter from '../../src/routes/object-commands';
import type * as SearchWriteThroughModule from '../../src/search/write-through';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';

const effectConcurrency = vi.hoisted(() => ({ active: 0, maximum: 0 }));

vi.mock('../../src/search/write-through', async (importOriginal) => {
  const actual = await importOriginal<typeof SearchWriteThroughModule>();
  const record = async (): Promise<void> => {
    effectConcurrency.active += 1;
    effectConcurrency.maximum = Math.max(effectConcurrency.maximum, effectConcurrency.active);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    effectConcurrency.active -= 1;
  };
  return { ...actual, enqueueSearchDelete: record, enqueueSearchUpsert: record };
});
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let objectCommands!: typeof objectCommandsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  objectCommands = (await import('../../src/routes/object-commands')).default;
});

describe('object command consequences', () => {
  it('runs no more than ten post-commit effects at once', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const projects = await db
      .insert(schema.project)
      .values(
        Array.from({ length: 25 }, (_, index) => ({
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          createdBy: seeded.humanActorId,
          name: `Effect Project ${index}`,
          status: 'planned',
          statusId: seeded.statusId('project', 'planned'),
        })),
      )
      .returning({ id: schema.project.id });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const response = await app.request('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'bounded-effect-command',
      },
      body: JSON.stringify({
        commandId: 'bounded-effect-command',
        objectKind: 'project',
        objectIds: projects.map((row) => row.id),
        operation: { type: 'replace_property', property: 'priority', value: 'high' },
      }),
    });
    expect(response.status).toBe(200);
    expect(effectConcurrency.maximum).toBe(10);
    expect(effectConcurrency.active).toBe(0);
  });
});
