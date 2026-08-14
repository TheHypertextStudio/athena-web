/**
 * `@docket/api` — `task.assignToCycle` files a task into its team's current cycle, but only
 * when it has no cycle yet.
 *
 * @remarks
 * Mirrors `apply-label.test.ts`'s handler-under-test pattern: build the registry, run one
 * action directly against a seeded task, and assert the resulting row.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { buildAutomationRegistry as BuildAutomationRegistry } from '../../../src/lib/automation/handlers';
import { getDb, seedBaseOrg } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let buildAutomationRegistry!: typeof BuildAutomationRegistry;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ buildAutomationRegistry } = await import('../../../src/lib/automation/handlers'));
});

/** Run the `task.assignToCycle` handler for one task. */
async function assignToCycle(orgId: string, taskId: string): Promise<void> {
  const registry = buildAutomationRegistry({ mailApplier: () => Promise.resolve() });
  const handler = registry.get('task.assignToCycle');
  expect(handler).toBeDefined();
  await handler?.run(
    { event: { kind: 'created', subjectType: 'task', subjectId: taskId, organizationId: orgId } },
    {},
  );
}

/** The stored `cycleId` for a task. */
async function cycleOf(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ cycleId: schema.task.cycleId })
    .from(schema.task)
    .where(eq(schema.task.id, taskId));
  return row!.cycleId;
}

describe('task.assignToCycle', () => {
  it('assigns the task to whichever cycle covers today', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [cycle] = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 1,
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        createdBy: humanActorId,
      })
      .returning({ id: schema.cycle.id });
    const [row] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'T', state: 'todo', createdBy: humanActorId })
      .returning({ id: schema.task.id });

    await assignToCycle(orgId, row!.id);
    expect(await cycleOf(row!.id)).toBe(cycle!.id);
  });

  it('leaves the task in triage when no cycle covers today', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [row] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'T', state: 'todo', createdBy: humanActorId })
      .returning({ id: schema.task.id });

    await assignToCycle(orgId, row!.id);
    expect(await cycleOf(row!.id)).toBeNull();
  });

  it('never overwrites a cycle someone assigned by hand', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const manual = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 1,
        startsAt: new Date('2020-01-01T00:00:00.000Z'),
        endsAt: new Date('2020-01-14T00:00:00.000Z'),
        status: 'completed',
        createdBy: humanActorId,
      })
      .returning({ id: schema.cycle.id });
    // The current cycle exists too, but the task already has an explicit assignment.
    await db.insert(schema.cycle).values({
      organizationId: orgId,
      teamId,
      number: 2,
      startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'active',
      createdBy: humanActorId,
    });
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'T',
        state: 'todo',
        cycleId: manual[0]!.id,
        createdBy: humanActorId,
      })
      .returning({ id: schema.task.id });

    await assignToCycle(orgId, row!.id);
    expect(await cycleOf(row!.id)).toBe(manual[0]!.id);
  });
});
