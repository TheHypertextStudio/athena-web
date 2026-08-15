/**
 * `@docket/api` — `task.applyLabel` obeys label-group exclusivity.
 *
 * @remarks
 * A rule is the caller most likely to violate that invariant at scale: it fires unattended, on
 * every matching event, with nobody watching the picker. The handler used to insert the join row
 * directly, which meant an automation could stack `Type: Bug` on top of `Type: Feature` and
 * quietly break the single-choice promise the settings page makes.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { buildAutomationRegistry as BuildAutomationRegistry } from '../../../src/lib/automation/handlers';
import { getDb, seedBaseOrg } from '../../support/routes-harness';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let buildAutomationRegistry!: typeof BuildAutomationRegistry;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ buildAutomationRegistry } = await import('../../../src/lib/automation/handlers'));
});

/** Run the `task.applyLabel` handler for one task + label. */
async function applyLabel(orgId: string, taskId: string, labelId: string): Promise<void> {
  const registry = buildAutomationRegistry({ mailApplier: () => Promise.resolve() });
  const handler = registry.get('task.applyLabel');
  expect(handler).toBeDefined();
  await handler?.run(
    {
      event: {
        kind: 'task.created',
        subjectType: 'task',
        subjectId: taskId,
        organizationId: orgId,
      },
    },
    { labelId },
  );
}

/** The label ids currently attached to a task. */
async function labelsOn(taskId: string): Promise<string[]> {
  const rows = await db
    .select({ labelId: schema.taskLabel.labelId })
    .from(schema.taskLabel)
    .where(eq(schema.taskLabel.taskId, taskId));
  return rows.map((r) => r.labelId).sort();
}

describe('task.applyLabel', () => {
  it('swaps within an exclusive group rather than stacking both members', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [group] = await db
      .insert(schema.labelGroup)
      .values({ organizationId: orgId, name: 'Type', exclusive: true })
      .returning();
    const mk = async (name: string): Promise<string> => {
      const [row] = await db
        .insert(schema.label)
        .values({ organizationId: orgId, name, color: 'blue', groupId: assertDefined(group).id })
        .returning();
      return assertDefined(row).id;
    };
    const feature = await mk('feature');
    const bug = await mk('bug');

    const [row] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'T', state: 'todo', createdBy: humanActorId })
      .returning();
    const taskId = assertDefined(row).id;

    await applyLabel(orgId, taskId, feature);
    await applyLabel(orgId, taskId, bug);

    // The rule that fired last wins, exactly as the last click in a picker would.
    expect(await labelsOn(taskId)).toEqual([bug]);
  });

  it('leaves ungrouped labels alone, so applying two accumulates', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const mk = async (name: string): Promise<string> => {
      const [row] = await db
        .insert(schema.label)
        .values({ organizationId: orgId, name, color: 'blue' })
        .returning();
      return assertDefined(row).id;
    };
    const a = await mk('urgent');
    const b = await mk('customer');

    const [row] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'T', state: 'todo', createdBy: humanActorId })
      .returning();
    const taskId = assertDefined(row).id;

    await applyLabel(orgId, taskId, a);
    await applyLabel(orgId, taskId, b);
    expect(await labelsOn(taskId)).toEqual([a, b].sort());
  });

  it('stays idempotent — re-applying a label the task already has changes nothing', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [labelRow] = await db
      .insert(schema.label)
      .values({ organizationId: orgId, name: 'repeat', color: 'blue' })
      .returning();
    const [row] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'T', state: 'todo', createdBy: humanActorId })
      .returning();

    await applyLabel(orgId, assertDefined(row).id, assertDefined(labelRow).id);
    await applyLabel(orgId, assertDefined(row).id, assertDefined(labelRow).id);
    expect(await labelsOn(assertDefined(row).id)).toEqual([assertDefined(labelRow).id]);
  });

  it('no-ops on a label from another org rather than writing across tenants', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const [foreign] = await db
      .insert(schema.label)
      .values({ organizationId: other.orgId, name: 'foreign', color: 'blue' })
      .returning();
    const [row] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'T', state: 'todo', createdBy: humanActorId })
      .returning();

    await applyLabel(orgId, assertDefined(row).id, assertDefined(foreign).id);
    expect(await labelsOn(assertDefined(row).id)).toEqual([]);
  });
});

describe('task.applyLabel — a label narrowed to another team', () => {
  it('does not throw when the task already carries one', async () => {
    // Narrowing a label to a team is non-destructive by design: subjects outside that team keep
    // it. Resolving the existing set strictly would therefore throw on exactly the state the
    // scoping feature creates, and the handler contract is that a rule may misfire but must
    // never throw. This is the regression that pairing those two decisions produced.
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Elsewhere', key: 'ELS' })
      .returning();

    const [stranded] = await db
      .insert(schema.label)
      .values({
        organizationId: orgId,
        name: 'stranded',
        color: 'blue',
        teamId: assertDefined(otherTeam).id,
      })
      .returning();
    const [fresh] = await db
      .insert(schema.label)
      .values({ organizationId: orgId, name: 'fresh', color: 'green' })
      .returning();

    const [row] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title: 'T', state: 'todo', createdBy: humanActorId })
      .returning();
    // The attachment predates the narrowing, exactly as the settings action leaves it.
    await db.insert(schema.taskLabel).values({
      taskId: assertDefined(row).id,
      labelId: assertDefined(stranded).id,
      organizationId: orgId,
    });

    await expect(
      applyLabel(orgId, assertDefined(row).id, assertDefined(fresh).id),
    ).resolves.toBeUndefined();
    // The stranded label survives — the rule adds, it does not tidy up after scoping.
    expect(await labelsOn(assertDefined(row).id)).toEqual(
      [assertDefined(stranded).id, assertDefined(fresh).id].sort(),
    );
  });
});
