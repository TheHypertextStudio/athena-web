import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { preparePrivateIdentityNamespace } from '../../src/work-template-identity-namespace';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
function pending(head: string, revision: string) {
  return {
    kind: 'private_definition',
    revision: 1,
    state: 'pending_draft',
    creationMode: 'all_at_once',
    roots: [],
    sourceMappings: [],
    dependencies: [],
    timing: { kind: 'field_timing', revision: 2, rules: [] },
    absentFields: [],
    titlePolicy: { kind: 'legacy_title', revision: 1 },
    titles: [],
    completionPolicy: { kind: 'legacy_authored_tasks', revision: 1, tasks: [] },
    authoring: {
      kind: 'process_definition',
      revision: 1,
      definitionAlias: head,
      revisionAlias: revision,
      definition: {
        name: 'Preexisting identity collision',
        creationMode: 'all_at_once',
        tasks: [],
        milestones: [],
        dependencies: [],
      },
    },
  };
}
async function insertPending(
  database: Database,
  organizationId: string,
  head: string,
  number: number,
): Promise<void> {
  const revision = genId(),
    invocation = genId(),
    document = pending(head, revision);
  await database.execute(
    sql`insert into work_template_blueprint_invocation(id,organization_id,owner_actor_id,manifest,overrides) values(${invocation},${organizationId},null,${JSON.stringify(document)}::jsonb,'[]'::jsonb)`,
  );
  await database.execute(
    sql`insert into work_template_invocation_revision(id,organization_id,head_id,invocation_id,number,state,creation_mode,origin,projection,created_at,authored_payload_hash) values(${revision},${organizationId},${head},${invocation},${number},'pending_draft','all_at_once','authored',docket_authored_invocation_projection(${JSON.stringify(document)}::jsonb),now(),docket_schedule_fingerprint(${JSON.stringify(document)}::jsonb))`,
  );
}
async function state(database: Database, id: string) {
  return (
    await migrationRows<{ origin: string | null; review: string | null }>(
      database,
      sql`select identity_origin as origin,identity_review as review from work_template_invocation_head where id=${id}`,
    )
  )[0];
}
async function ready(database: Database): Promise<boolean> {
  return (
    (
      await migrationRows<{ ready: boolean }>(
        database,
        sql`select docket_private_identity_namespace_ready() as ready`,
      )
    )[0]?.ready ?? false
  );
}
async function seedPredecessor(database: Database) {
  const organizationId = genId(),
    sourceIds = [genId(), genId(), genId()],
    collision = sourceIds[2];
  if (!collision) throw new Error('Missing collision fixture identity');
  await database.execute(
    sql`insert into organization(id,name,slug) values(${organizationId},'Private identity fixture',${'identity-' + organizationId.toLowerCase()})`,
  );
  for (const id of sourceIds)
    await database.execute(
      sql`insert into process_definition(id,organization_id,name,status) values(${id},${organizationId},'Retained original','draft')`,
    );
  await database.execute(
    sql`insert into work_template_invocation_head(id,organization_id,name,status) values(${collision},${organizationId},'Preexisting identity collision','draft')`,
  );
  await insertPending(database, organizationId, collision, 1);
  const originalRevision = genId(),
    originalInvocation = genId();
  await database.execute(
    sql`insert into process_revision(id,organization_id,definition_id,number) values(${originalRevision},${organizationId},${collision},1)`,
  );
  const original = {
    kind: 'pending_draft',
    legacyProcessRevisionId: originalRevision,
    roots: [],
    steps: [],
    dependencies: [],
  };
  await database.execute(
    sql`insert into work_template_blueprint_invocation(id,organization_id,owner_actor_id,manifest,overrides) values(${originalInvocation},${organizationId},null,${JSON.stringify(original)}::jsonb,'[]'::jsonb)`,
  );
  await database.execute(
    sql`insert into work_template_blueprint_conversion(organization_id,legacy_process_revision_id,invocation_id,source_fingerprint) values(${organizationId},${originalRevision},${originalInvocation},docket_blueprint_source_fingerprint(${originalRevision}))`,
  );

  const before = await migrationRows(
    database,
    sql`select to_jsonb(d) as body from process_definition d where organization_id=${organizationId} order by id`,
  );
  return { organizationId, collision, before };
}
async function proveInterruptedReservation(
  database: Database,
  organizationId: string,
): Promise<string> {
  expect(await ready(database)).toBe(false);
  await expect(
    database.execute(
      sql`insert into work_template_invocation_head(id,organization_id,name) values(${genId()},${organizationId},'Too early authored')`,
    ),
  ).rejects.toThrow();
  const interruption = new Error('Interrupt after a durable identity reservation');
  await expect(
    preparePrivateIdentityNamespace(database, {
      batchSize: 1,
      onPrivateIdentityBatch: async (progress) => {
        if (progress.reserved === 1) {
          expect(
            (
              await migrationRows<{ count: number }>(
                database,
                sql`select count(*)::integer as count from work_template_invocation_head where identity_origin='retained'`,
              )
            )[0]?.count,
          ).toBe(1);
          throw interruption;
        }
      },
    }),
  ).rejects.toBe(interruption);
  expect(await ready(database)).toBe(false);
  await expect(
    database.execute(
      sql`update work_template_identity_namespace set ready_at=now(),review_code=null,unreserved_source_count=0,reserved_source_count=0,coverage_hash=docket_schedule_fingerprint('{}'::jsonb) where singleton`,
    ),
  ).rejects.toThrow();
  const lower = '00000000000000000000000000';
  await database.execute(
    sql`insert into process_definition(id,organization_id,name) values(${lower},${organizationId},'Lower committed source')`,
  );
  expect(await state(database, lower)).toEqual({ origin: 'retained', review: null });
  return lower;
}
async function proveUnresolvedCollision(
  database: Database,
  organizationId: string,
  collision: string,
): Promise<void> {
  const result = await preparePrivateIdentityNamespace(database, { batchSize: 1 });
  expect(result).toMatchObject({ ready: true, deferred: 1 });
  expect(await state(database, collision)).toEqual({ origin: null, review: 'identity_collision' });
  expect(await ready(database)).toBe(true);
  await expect(
    database.execute(
      sql`update work_template_invocation_head set identity_origin='authored',identity_review=null,revision=revision+1 where id=${collision}`,
    ),
  ).rejects.toThrow();
  await expect(
    database.transaction((tx) => insertPending(tx, organizationId, collision, 2)),
  ).rejects.toThrow();
  expect(await state(database, collision)).toEqual({ origin: null, review: 'identity_collision' });
}
async function proveImmutableCoverage(
  database: Database,
  organizationId: string,
  lower: string,
  before: unknown,
): Promise<void> {
  const namespace = await migrationRows(
    database,
    sql`select * from work_template_identity_namespace`,
  );
  expect(
    (
      await migrationRows<{ valid: boolean }>(
        database,
        sql`select reserved_source_count=4 and coverage_hash=docket_schedule_fingerprint(jsonb_build_object('kind','identity_namespace_coverage','revision',1,'reservedSourceCount',4,'missingReservations',0,'reservationTrigger',1)) as valid from work_template_identity_namespace`,
      )
    )[0]?.valid,
  ).toBe(true);
  await expect(
    database.execute(
      sql`update work_template_identity_namespace set ready_at=ready_at+interval '1 second' where singleton`,
    ),
  ).rejects.toThrow();
  expect((await preparePrivateIdentityNamespace(database, { batchSize: 1 })).deferred).toBe(1);
  expect(
    await migrationRows(database, sql`select * from work_template_identity_namespace`),
  ).toEqual(namespace);
  expect(
    await migrationRows(
      database,
      sql`select to_jsonb(d) as body from process_definition d where organization_id=${organizationId} and id<>${lower} order by id`,
    ),
  ).toEqual(before);
  expect(
    (
      await migrationRows<{ count: number }>(
        database,
        sql`select count(*)::integer as count from pg_constraint where conname='recurrence_series_definition_id_process_definition_id_fk'`,
      )
    )[0]?.count,
  ).toBe(1);
  expect(
    (
      await migrationRows<{ count: number }>(
        database,
        sql`select ((select count(*) from task)+(select count(*) from project)+(select count(*) from process_occurrence where accepted_claim is not null))::integer as count`,
      )
    )[0]?.count,
  ).toBe(0);
}
/** Prove bounded namespace preparation with interruptions, lower IDs and non-adoptable explicit collisions. */
export async function exercisePrivateIdentityNamespace(
  database: Database,
  phases: {
    readonly predecessor: () => Promise<void>;
    readonly expansion: () => Promise<void>;
    readonly registration: () => Promise<{ readonly deferred: number }>;
  },
): Promise<void> {
  await phases.predecessor();
  const original = await seedPredecessor(database);
  await phases.expansion();
  const lower = await proveInterruptedReservation(database, original.organizationId);
  await proveUnresolvedCollision(database, original.organizationId, original.collision);
  expect((await phases.registration()).deferred).toBe(1);
  expect(await state(database, original.collision)).toEqual({
    origin: null,
    review: 'identity_collision',
  });
  await proveImmutableCoverage(database, original.organizationId, lower, original.before);
}
