import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type objectCommandsRouter from '../../src/routes/object-commands';
import { appWithActor, getDb, one, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let objectCommands!: typeof objectCommandsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  objectCommands = (await import('../../src/routes/object-commands')).default;
});

describe('object command cycle assignment', () => {
  it('rejects a cycle owned by another team', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
    const otherTeams = await db
      .insert(schema.team)
      .values({ organizationId: seeded.orgId, name: 'Other Team', key: `OT${Date.now()}` })
      .returning({ id: schema.team.id });
    const otherCycles = await db
      .insert(schema.cycle)
      .values({
        organizationId: seeded.orgId,
        teamId: one(otherTeams).id,
        number: Math.floor(Math.random() * 1_000_000),
        startsAt: new Date('2027-01-01T00:00:00.000Z'),
        endsAt: new Date('2027-01-07T23:59:59.999Z'),
      })
      .returning({ id: schema.cycle.id });
    const taskRows = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Keep this task on its team cadence',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    const response = await appWithActor(
      objectCommands,
      seeded.orgId,
      ['manage'],
      seeded.humanActorId,
    ).request('/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'reject-cross-team-cycle',
      },
      body: JSON.stringify({
        commandId: 'reject-cross-team-cycle',
        objectKind: 'task',
        objectIds: [one(taskRows).id],
        operation: {
          type: 'replace_property',
          property: 'cycleId',
          value: one(otherCycles).id,
        },
      }),
    });

    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(409);
    expect(payload).toMatchObject({ code: 'cadence_changed' });
  });
});
