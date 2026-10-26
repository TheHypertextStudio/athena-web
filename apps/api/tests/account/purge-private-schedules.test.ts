import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { purgeUser } from '../../src/account/lifecycle';
import {
  getPrivatePublicationDb,
  requiredPrivateRow,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';
import { installPrivateAliasReferenceCandidate } from '../support/private-alias-reference-candidate';
import { publishAndRunCommunityDinner } from '../support/private-schedule-run-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getPrivatePublicationDb();
  await installPrivateAliasReferenceCandidate(schema.db);
  await schema.db.execute(sql`select docket_enforce_private_alias_references()`);
});

it('purges an owned workspace with a private run, its registered steps and generated work only', async () => {
  const dinner = await publishAndRunCommunityDinner(schema);
  const other = await seedPrivatePublicationActor(schema.db, schema);
  const owner = requiredPrivateRow(
    await schema.db
      .insert(schema.user)
      .values({ name: 'Dinner host', email: `dinner-purge-${schema.genId()}@example.test` })
      .returning(),
  );
  await schema.db.insert(schema.hub).values({ userId: owner.id });
  await schema.db
    .update(schema.actor)
    .set({ userId: owner.id })
    .where(eq(schema.actor.id, dinner.actorId));
  await expect(
    schema.db
      .delete(schema.blueprintInvocation)
      .where(eq(schema.blueprintInvocation.id, dinner.invocationId)),
  ).rejects.toThrow();

  await purgeUser(schema.db, owner.id, [dinner.orgId]);

  for (const table of [
    schema.privateStep,
    schema.task,
    schema.milestone,
    schema.project,
    schema.processOccurrence,
    schema.recurrenceSeries,
    schema.blueprintInvocation,
    schema.invocationHead,
  ]) {
    expect(
      await schema.db
        .select({ organizationId: table.organizationId })
        .from(table)
        .where(eq(table.organizationId, dinner.orgId)),
    ).toEqual([]);
  }
  expect(
    await schema.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, other.orgId)),
  ).toEqual([{ id: other.orgId }]);
});
