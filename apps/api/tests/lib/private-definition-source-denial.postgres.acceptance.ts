import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { sql } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import {
  createCanonicalPrivateDefinition,
  appendCanonicalPrivateDefinition,
} from '../../src/lib/recurrence/private-definition-publication';
import { canonicalDefinitionDetail } from '../../src/lib/recurrence/canonical-definition';
import {
  getPrivatePublicationDb as getDb,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';
vi.mock('../support/db', () => ({ getMigratedDb: async () => await import('@docket/db') }));
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
  expect(process.env['DATABASE_URL']).toMatch(/^postgres(?:ql)?:/);
  await schema.db.execute(
    sql.raw(
      `DO $$ BEGIN CREATE ROLE history_oct25_authored_restricted NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    ),
  );
  await schema.db.execute(
    sql.raw(
      `GRANT USAGE ON SCHEMA public TO history_oct25_authored_restricted; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO history_oct25_authored_restricted; REVOKE ALL ON process_definition,process_revision,process_step,process_project_spec,process_milestone_spec,process_task_spec,process_task_label_spec,process_project_label_spec,process_dependency,process_instance,process_instance_project,process_instance_milestone,process_instance_task FROM history_oct25_authored_restricted`,
    ),
  );
});
async function fixture() {
  const base = await seedPrivatePublicationActor(schema.db, schema);
  return {
    ...base,
    definition: ProcessDefinitionCreate.parse({
      name: 'Restricted private authoring',
      tasks: [{ key: 'one', title: 'Private Task', teamId: base.teamId }],
    }),
  };
}
async function restricted<T>(
  f: Awaited<ReturnType<typeof fixture>>,
  operation: (tx: DbModule.Database) => Promise<T>,
): Promise<T> {
  return schema.db.transaction(async (tx) => {
    await tx.execute(sql.raw('SET LOCAL ROLE history_oct25_authored_restricted'));
    await tx.execute(
      sql`select set_config('docket.organization_id',${f.orgId},true),set_config('docket.actor_id',${f.humanActorId},true)`,
    );
    return operation(tx);
  });
}
it('reads and appends an existing authored canonical head with every normalized source table denied', async () => {
  const f = await fixture(),
    created = await createCanonicalPrivateDefinition(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definition: f.definition,
    });
  const input = {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definitionId: created.definitionId,
  };
  expect(
    (await restricted(f, (tx) => canonicalDefinitionDetail(tx, input)))?.revision.tasks[0]?.title,
  ).toBe('Private Task');
  expect(
    (
      await restricted(f, (tx) =>
        appendCanonicalPrivateDefinition(tx, { ...input, definition: f.definition }),
      )
    ).revisionNumber,
  ).toBe(2);
});
it('creates a fresh authored canonical head with normalized source tables denied', async () => {
  const f = await fixture();
  const created = await restricted(f, (tx) =>
    createCanonicalPrivateDefinition(tx, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definition: f.definition,
    }),
  );
  expect(created.revisionNumber).toBe(1);
});

afterAll(async () => {
  const database = await import('@docket/db');
  await database.closeDb();
});
