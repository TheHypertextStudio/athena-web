import type * as DbModule from '@docket/db';
import { beforeAll, expect, it } from 'vitest';
import { getDb, seedTask, seedTaskAccessOrg } from '../support/routes-harness';
import { serializableTx } from '../../src/lib/serializable-tx';
import { closesWorkspaceDependencyCycle } from '../../src/lib/work-dependency-forest';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
it('evaluates an explicit dependency reversal against retained edges after the reviewed removal', async () => {
  const f = await seedTaskAccessOrg(schema.db, schema, 'manage');
  const a = await seedTask(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    teamId: f.teamId,
    title: 'A',
    state: 'todo',
  });
  const b = await seedTask(schema.db, schema, f.statusId, {
    organizationId: f.orgId,
    teamId: f.teamId,
    title: 'B',
    state: 'todo',
  });
  await schema.db
    .insert(schema.taskDependency)
    .values({ organizationId: f.orgId, blockingTaskId: a.id, blockedTaskId: b.id });
  await serializableTx(async (tx) => {
    expect(
      await closesWorkspaceDependencyCycle(tx, f.orgId, 'task', [{ from: b.id, to: a.id }]),
    ).toBe(true);
    expect(
      await closesWorkspaceDependencyCycle(
        tx,
        f.orgId,
        'task',
        [{ from: b.id, to: a.id }],
        [{ from: a.id, to: b.id }],
      ),
    ).toBe(false);
  });
});
