import { expect } from 'vitest';
import { sql } from 'drizzle-orm';
import * as schema from '@docket/db';
import { preparePrivateAliasReferences, type Database } from '@docket/db';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { appendPublishedProcessRevision } from '../../src/lib/recurrence/process-definition';
import { rawResultRows } from '../../src/lib/raw-result';
import { seedPrivatePublicationActor } from './private-publication-fixture';
async function oldForeignKeys(database: Database) {
  return rawResultRows<{ count: number }>(
    await database.execute(
      sql`select count(*)::integer as count from pg_constraint where contype='f' and conrelid in('recurrence_series'::regclass,'recurrence_series_revision'::regclass,'calendar_process_binding'::regclass) and confrelid in('process_definition'::regclass,'process_revision'::regclass)`,
    ),
  )[0]?.count;
}

/** Prove committed deferral, lower-ID rescan, checked source registration, exact byte retention and conditional reference admission. */
export async function exercisePrivateAliasReferenceCheckpoint(
  database: Database,
  registerOriginals: () => Promise<void>,
): Promise<void> {
  const f = await seedPrivatePublicationActor(database, schema);
  const first = schema.genId(),
    lower = '00000000000000000000000018';
  await database.insert(schema.processDefinition).values({
    id: first,
    organizationId: f.orgId,
    createdBy: f.humanActorId,
    name: 'Needs actual publication',
    status: 'draft',
  });
  await expect(
    preparePrivateAliasReferences(database, {
      onPrivateAliasReferenceCheckpoint: () => {
        throw new Error('interrupt after committed disposition');
      },
    }),
  ).rejects.toThrow('interrupt after committed disposition');
  expect(await oldForeignKeys(database)).toBe(3);
  await database.insert(schema.processDefinition).values({
    id: lower,
    organizationId: f.orgId,
    createdBy: f.humanActorId,
    name: 'Lower source identity',
    status: 'draft',
  });
  expect(await preparePrivateAliasReferences(database)).toMatchObject({
    enforced: false,
    reason: 'head_unregistered',
    sourceDefinitions: 2,
    unresolvedHeads: 2,
  });
  expect(await oldForeignKeys(database)).toBe(3);
  const definition = ProcessDefinitionCreate.parse({
    name: 'Actually published',
    tasks: [{ key: 'one', title: 'Exact Task', teamId: f.teamId }],
  });
  for (const definitionId of [first, lower])
    await appendPublishedProcessRevision(database, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definitionId,
      revision: definition,
    });
  await registerOriginals();
  const originals = await database.select().from(schema.blueprintConversion);
  let observedAfterCommit = false;
  expect(
    await preparePrivateAliasReferences(database, {
      onPrivateAliasReferenceCheckpoint: async (progress) => {
        observedAfterCommit =
          rawResultRows<{ ready: boolean }>(
            await database.execute(sql`select docket_private_alias_references_enforced() as ready`),
          )[0]?.ready === progress.enforced;
      },
    }),
  ).toMatchObject({
    enforced: true,
    reason: 'enforced',
    sourceDefinitions: 2,
    sourceRevisions: 2,
    unresolvedHeads: 0,
    unresolvedRevisions: 0,
    unresolvedSeries: 0,
    unresolvedCalendars: 0,
    retainedInstances: 0,
  });
  expect(observedAfterCommit).toBe(true);
  expect(await oldForeignKeys(database)).toBe(0);
  expect(await database.select().from(schema.blueprintConversion)).toEqual(originals);
  expect(await preparePrivateAliasReferences(database)).toMatchObject({
    enforced: true,
    sourceDefinitions: 2,
  });
}
