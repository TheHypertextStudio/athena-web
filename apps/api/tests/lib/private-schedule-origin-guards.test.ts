import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { assertDefined } from '@docket/test-utils';
import { rawResultRows } from '../../src/lib/raw-result';
import { getPrivatePublicationDb } from '../support/private-publication-fixture';
import { installPrivateAliasReferenceCandidate } from '../support/private-alias-reference-candidate';
import {
  publishAndRunCommunityDinner,
  type PrivateScheduleRun,
} from '../support/private-schedule-run-fixture';

let schema: typeof DbModule;
let dinner: PrivateScheduleRun;
beforeAll(async () => {
  schema = await getPrivatePublicationDb();
  await installPrivateAliasReferenceCandidate(schema.db);
  await schema.db.execute(sql`select docket_enforce_private_alias_references()`);
  dinner = await publishAndRunCommunityDinner(schema);
});

async function generatedMilestone() {
  const [row] = await schema.db
    .select()
    .from(schema.milestone)
    .where(eq(schema.milestone.id, assertDefined(dinner.run.milestoneIdsByKey['prep'])));
  return assertDefined(row);
}
function alias(key: string): string {
  return assertDefined(dinner.publication.stepIdsByKey[key]);
}

it('keeps a generated private origin immutable', async () => {
  const milestone = await generatedMilestone();
  await expect(
    schema.db
      .update(schema.milestone)
      .set({ privateStepAlias: alias('dinner') })
      .where(eq(schema.milestone.id, milestone.id)),
  ).rejects.toMatchObject({ cause: { constraint: 'work_private_origin_immutable' } });
});

it('refuses work that claims a registered step of another kind or path', async () => {
  const milestone = await generatedMilestone();
  const copy = { ...milestone, id: schema.genId() };
  await expect(
    schema.db.insert(schema.milestone).values({ ...copy, privateStepAlias: alias('menu') }),
  ).rejects.toMatchObject({ cause: { constraint: 'work_private_origin' } });
  await expect(
    schema.db.insert(schema.milestone).values({ ...copy, blueprintPath: ['menu'] }),
  ).rejects.toMatchObject({ cause: { constraint: 'work_private_origin' } });
});

it('refuses half a private origin and an origin from an unregistered invocation', async () => {
  const milestone = await generatedMilestone();
  await expect(
    schema.db
      .insert(schema.milestone)
      .values({ ...milestone, id: schema.genId(), privateStepAlias: null }),
  ).rejects.toMatchObject({ cause: { constraint: 'milestone_private_origin_pair' } });
  await expect(
    schema.db
      .insert(schema.milestone)
      .values({ ...milestone, id: schema.genId(), privateInvocationId: schema.genId() }),
  ).rejects.toMatchObject({ cause: { constraint: 'work_private_origin' } });
});

it('accepts registered steps only as the invocation describes them and keeps them with it', async () => {
  const step = {
    invocationId: dinner.invocationId,
    organizationId: dinner.orgId,
    rootKey: 'dinner',
    kind: 'task' as const,
  };
  await expect(
    schema.db
      .insert(schema.privateStep)
      .values({ ...step, stepAlias: schema.genId(), path: ['menu'], parentAlias: alias('dinner') }),
  ).rejects.toMatchObject({ cause: { constraint: 'private_step_mapping' } });
  const registered = and(
    eq(schema.privateStep.invocationId, dinner.invocationId),
    eq(schema.privateStep.stepAlias, alias('shop')),
  );
  await expect(
    schema.db
      .update(schema.privateStep)
      .set({ path: ['other'] })
      .where(registered),
  ).rejects.toMatchObject({ cause: { constraint: 'private_step_immutable' } });
  await expect(schema.db.delete(schema.privateStep).where(registered)).rejects.toMatchObject({
    cause: { constraint: 'private_step_retention' },
  });
});

it('reports the private structure schema as ready', async () => {
  const [state] = rawResultRows<{ ready: boolean }>(
    await schema.db.execute(sql`select docket_private_structure_schema_ready() as ready`),
  );
  expect(state?.ready).toBe(true);
});
