import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { revertMilestone as RevertMilestone } from '../../src/mcp/milestone-undo';
import { getDb, one, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let revertMilestone!: typeof RevertMilestone;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  revertMilestone = (await import('../../src/mcp/milestone-undo')).revertMilestone;
});

/** A project with one milestone on it. */
async function seedMilestone() {
  const base = await seedBaseOrg(db, schema);
  const projectId = one(
    await db
      .insert(schema.project)
      .values({
        organizationId: base.orgId,
        name: 'Proj',
        teamId: base.teamId,
        status: 'planned',
        statusId: base.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id }),
  ).id;
  const row = one(
    await db
      .insert(schema.milestone)
      .values({ organizationId: base.orgId, projectId, name: 'Beta' })
      .returning(),
  );
  return { orgId: base.orgId, projectId, row };
}

describe('revertMilestone', () => {
  it('leaves a milestone that is already back, or whose project is gone', async () => {
    const { orgId, projectId, row } = await seedMilestone();
    const before = { projectId, name: 'Beta', description: null, targetDate: null, sort: 0 };

    expect(
      await revertMilestone({ entityId: row.id, op: 'delete', before, after: null }, orgId),
    ).toMatchObject({ reverted: false, reason: 'already_present' });

    await db.delete(schema.project).where(eq(schema.project.id, projectId));
    expect(
      await revertMilestone({ entityId: row.id, op: 'delete', before, after: null }, orgId),
    ).toMatchObject({ reverted: false, reason: 'gone' });
    expect(
      await revertMilestone({ entityId: row.id, op: 'delete', before: null, after: null }, orgId),
    ).toMatchObject({ reverted: false, reason: 'no_prior_state' });
    expect(
      await revertMilestone({ entityId: row.id, op: 'update', before, after: null }, orgId),
    ).toMatchObject({ reverted: false, reason: 'gone' });
  });

  it('refuses to reverse a milestone edited since, or an entry with nothing to restore', async () => {
    const { orgId, row } = await seedMilestone();
    expect(
      await revertMilestone(
        { entityId: row.id, op: 'update', before: null, after: { name: 'Something else' } },
        orgId,
      ),
    ).toMatchObject({ reverted: false, reason: 'changed_since' });
    expect(
      await revertMilestone({ entityId: row.id, op: 'update', before: null, after: null }, orgId),
    ).toMatchObject({ reverted: false, reason: 'no_prior_state' });
  });
});
