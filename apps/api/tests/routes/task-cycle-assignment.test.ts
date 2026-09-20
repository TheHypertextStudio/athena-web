import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type tasksRouter from '../../src/routes/tasks';
import { appWithActor, getDb, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

describe('task cycle assignment', () => {
  it('rejects cross-team cycles and a stale cadence selection', async () => {
    const { orgId, teamId, humanActorId } = await seedTaskAccessOrg(db, schema, 'contribute');
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Task', teamId }),
    });
    const taskId = ((await created.json()) as { id: string }).id;
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Other', key: `OTH${Date.now()}` })
      .returning({ id: schema.team.id });
    const [targetCycle] = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId: assertDefined(otherTeam).id,
        number: 99,
        startsAt: new Date('2027-01-01T00:00:00.000Z'),
        endsAt: new Date('2027-01-07T23:59:59.999Z'),
        createdBy: humanActorId,
      })
      .returning({ id: schema.cycle.id });
    const cycleId = assertDefined(targetCycle).id;

    for (const [path, body] of [
      ['/', { title: 'Wrong cycle team', teamId, cycleId }],
      [`/${taskId}`, { cycleId }],
      [`/${taskId}`, { cycleId, cycleCadenceRevision: 99 }],
    ] as const) {
      const response = await writer.request(path, {
        method: path === '/' ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'cadence_changed' });
    }
  });
});
