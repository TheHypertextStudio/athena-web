import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { Database } from '../src/client';
import { fullSchema } from '../src/client';
import { genId } from '../src/id';
import { prepareBlueprintRetainedFixture } from '../tests/fixtures/work-template-blueprint-migration';
import { migrateWithWorkTemplateCheckpoint } from '../src/migrate-work-templates';
import { migrationRows } from '../src/work-template-blueprint-migration/query';
import {
  copyStorageContext,
  seedCopyStorageWorkspace,
  insertCopyMetadata,
  insertCopyStorageFixture,
  publishCopyStorageFixture,
  type CopyStorageFixture,
} from '../tests/fixtures/work-template-copy';

const target = process.env['WORK_TEMPLATE_COPY_PG_URL'];
assert.ok(target, 'Set WORK_TEMPLATE_COPY_PG_URL to the exclusively leased task database.');
const url = new URL(target);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '16432');
assert.equal(url.pathname, '/athena_identity_test');
const client = postgres(target, { max: 3, prepare: false, onnotice: () => undefined });
const database = drizzle(client, { schema: fullSchema });
let readerCreated = false;
const reader = `copy_reader_${genId().toLowerCase()}`;
const folder = resolve(import.meta.dirname, '../drizzle');
try {
  const options = {
    migrationsFolder: folder,
    applySqlMigrations: (path: string) => migrate(database, { migrationsFolder: path }),
  };
  if (process.env['WORK_TEMPLATE_COPY_PG_RESET'] === '1') {
    await client.unsafe(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public',
    );
    await prepareBlueprintRetainedFixture(database, options);
  }
  const beforeJournal =
    await client`select hash,created_at from drizzle.__drizzle_migrations order by id`;
  assert.ok(beforeJournal.length <= 167, 'Requires task-owned migration journal');
  await migrateWithWorkTemplateCheckpoint(database, options);
  const afterJournal =
    await client`select hash,created_at from drizzle.__drizzle_migrations order by id`;
  assert.equal(afterJournal.length, 167);
  assert.deepEqual([...afterJournal].slice(0, beforeJournal.length), [...beforeJournal]);
  const workspace = await seedCopyStorageWorkspace(database);
  const fixture = await database.transaction((tx) => insertCopyStorageFixture(tx, workspace));
  const [counts] = await migrationRows<{ versions: number; steps: number }>(
    database,
    sql`select (select count(*)::integer from work_type_version where work_type_id=${fixture.destinationId}) as versions,(select count(*)::integer from blueprint_step where version_id=${fixture.reservedId}) as steps`,
  );
  assert.deepEqual(counts, { versions: 0, steps: 0 });
  await rejectsIncomplete(fixture);
  await rejectsIdentityTheft(fixture);
  await provesRestrictedProjection(fixture);
  await database.transaction((tx) => publishCopyStorageFixture(tx, fixture));
  await provesLaterVersion(fixture);
  await provesVoidTombstone();
  await provesPurge(fixture);
  console.log(
    'PASS PostgreSQL18 copy storage: private zero-publications; incomplete/deferred refusal; exact ID theft guards; restricted-role acceptor privacy/minimal teammate projection; version1 consumption/version2; void tombstones; account/workspace purge.',
  );
} finally {
  await cleanupReader();
  await client.end();
}
async function rejectsIncomplete(f: CopyStorageFixture): Promise<void> {
  await assert.rejects(
    database.transaction(async (tx) => {
      await copyStorageContext(tx, f);
      await insertCopyMetadata(tx, {
        ...f,
        bundleId: genId(),
        entryId: genId(),
        destinationId: genId(),
        reservedId: genId(),
        receiptId: genId(),
      });
    }),
  );
  await assert.rejects(
    database.transaction(async (tx) => {
      await copyStorageContext(tx, f);
      await tx.execute(sql`update template set scope='organization' where id=${f.destinationId}`);
    }),
  );
}
async function rejectsIdentityTheft(f: CopyStorageFixture): Promise<void> {
  await assert.rejects(database.transaction((tx) => publishCopyStorageFixture(tx, f, genId())));
  await assert.rejects(
    database.transaction(async (tx) => {
      await copyStorageContext(tx, f);
      await tx.execute(
        sql`insert into template(id,organization_id,target_type,name,scope,payload,draft_definition) select ${f.reservedId},organization_id,target_type,name,scope,payload,draft_definition from template where id=${f.destinationId}`,
      );
    }),
  );
  await assert.rejects(
    database.transaction(async (tx) => {
      await copyStorageContext(tx, f);
      await tx.execute(
        sql`update work_template_copy_entry set source_identity='{}' where id=${f.entryId}`,
      );
    }),
  );
}
async function provesRestrictedProjection(f: CopyStorageFixture): Promise<void> {
  const foreign = await seedCopyStorageWorkspace(database);
  await client.unsafe(
    `CREATE ROLE "${reader}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${reader}"; GRANT SELECT ON work_template_copy_bundle,work_template_copy_entry TO "${reader}"; GRANT EXECUTE ON FUNCTION docket_template_copy_reservation(text,text) TO "${reader}"`,
  );
  readerCreated = true;
  await restricted(f, async (tx) => {
    assert.equal(
      (await migrationRows(tx, sql`select id from work_template_copy_bundle`)).length,
      1,
    );
    assert.equal((await migrationRows(tx, sql`select id from work_template_copy_entry`)).length, 1);
    await assert.rejects(
      tx.transaction((inner) => inner.execute(sql`select draft_definition from template`)),
    );
    await assert.rejects(
      tx.transaction((inner) => inner.execute(sql`select "after" from change_set_entry`)),
    );
  });
  await restricted(foreign, async (tx) => {
    assert.equal(
      (
        await migrationRows(
          tx,
          sql`select id from work_template_copy_bundle where id=${f.bundleId}`,
        )
      ).length,
      0,
    );
    await assert.rejects(
      tx.transaction((inner) =>
        inner.execute(
          sql`select * from docket_template_copy_reservation(${f.organizationId},${f.destinationId})`,
        ),
      ),
    );
  });
  await provesTeammateProjection(f);
}
async function restricted(
  f: CopyStorageFixture | { organizationId: string; actorId: string; userId: string },
  run: (tx: Database) => Promise<void>,
): Promise<void> {
  await database.transaction(async (tx) => {
    await copyStorageContext(tx, f);
    await tx.execute(sql.raw(`SET LOCAL ROLE "${reader}"`));
    await run(tx);
  });
}
async function provesTeammateProjection(f: CopyStorageFixture): Promise<void> {
  const actorId = genId(),
    teamId = genId();
  await database.execute(
    sql`insert into actor(id,organization_id,kind,display_name) values(${actorId},${f.organizationId},'human','Teammate')`,
  );
  await database.execute(
    sql`insert into "grant"(id,organization_id,subject_kind,subject_id,resource_kind,resource_id,capabilities,effect) values(${genId()},${f.organizationId},'actor',${actorId},'organization',${f.organizationId},'["manage"]','allow')`,
  );
  await database.execute(
    sql`insert into team(id,organization_id,name,key) values(${teamId},${f.organizationId},'Shared copies',${teamId})`,
  );
  await database.execute(
    sql`insert into team_member(team_id,organization_id,actor_id) values(${teamId},${f.organizationId},${actorId}),(${teamId},${f.organizationId},${f.actorId})`,
  );
  await database.execute(
    sql`update template set scope='team',team_id=${teamId} where id=${f.destinationId}`,
  );
  await restricted({ ...f, actorId }, async (tx) => {
    assert.equal(
      (
        await migrationRows(
          tx,
          sql`select id from work_template_copy_bundle where id=${f.bundleId}`,
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await migrationRows(
          tx,
          sql`select source_identity from work_template_copy_entry where id=${f.entryId}`,
        )
      ).length,
      0,
    );
    const rows = await migrationRows(
      tx,
      sql`select * from docket_template_copy_reservation(${f.organizationId},${f.destinationId})`,
    );
    assert.deepEqual(
      [...rows],
      [
        {
          entry_id: f.entryId,
          reserved_first_version_id: f.reservedId,
          reservation_state: 'pending',
        },
      ],
    );
  });
  await database.execute(sql`delete from team_member where actor_id=${actorId}`);
  await restricted({ ...f, actorId }, async (tx) => {
    await assert.rejects(
      tx.transaction((inner) =>
        inner.execute(
          sql`select * from docket_template_copy_reservation(${f.organizationId},${f.destinationId})`,
        ),
      ),
    );
  });
}
async function provesLaterVersion(f: CopyStorageFixture): Promise<void> {
  const id = genId();
  await database.execute(
    sql`insert into work_type_version(id,organization_id,work_type_id,number,definition,published_by_actor_id) select ${id},organization_id,id,2,draft_definition,null from template where id=${f.destinationId}`,
  );
  assert.notEqual(id, f.reservedId);
  const [entry] = await migrationRows<{ state: string; id: string }>(
    database,
    sql`select reservation_state as state,consumed_version_id as id from work_template_copy_entry where id=${f.entryId}`,
  );
  assert.deepEqual(entry, { state: 'consumed', id: f.reservedId });
}
async function provesVoidTombstone(): Promise<void> {
  const workspace = await seedCopyStorageWorkspace(database);
  const f = await database.transaction((tx) => insertCopyStorageFixture(tx, workspace));
  await database.transaction(async (tx) => {
    await copyStorageContext(tx, f);
    await tx.execute(
      sql`update work_template_copy_entry set reservation_state='void',live_work_type_id=null where id=${f.entryId}`,
    );
    await tx.execute(sql`delete from template where id=${f.destinationId}`);
    await tx.execute(
      sql`update work_template_copy_bundle set state='undone',undone_at=now(),undo_outcomes='[{"entryKey":"root","outcome":"deleted"}]' where id=${f.bundleId}`,
    );
  });
  await assert.rejects(
    database.execute(sql`delete from work_template_copy_entry where id=${f.entryId}`),
  );
  const definition = WorkTemplateDefinition.parse({
    name: 'Stolen',
    payload: { targetType: 'task' },
  });
  await assert.rejects(
    database.transaction(async (tx) => {
      await copyStorageContext(tx, f);
      await tx.execute(
        sql`insert into template(id,organization_id,target_type,name,scope,payload,draft_definition) values(${f.destinationId},${f.organizationId},'task',${definition.name},'personal',${JSON.stringify(definition.payload)}::jsonb,${JSON.stringify(definition)}::jsonb)`,
      );
    }),
  );
}
async function provesPurge(f: CopyStorageFixture): Promise<void> {
  await database.execute(sql`delete from "user" where id=${f.userId}`);
  const [saved] = await migrationRows<{
    actor: string | null;
    audit: string;
    receipt: string | null;
    auditReceipt: string;
  }>(
    database,
    sql`select accepting_actor_id as actor,accepting_actor_key as audit,receipt_id as receipt,receipt_key as "auditReceipt" from work_template_copy_bundle where id=${f.bundleId}`,
  );
  assert.deepEqual(saved, {
    actor: null,
    audit: f.actorId,
    receipt: null,
    auditReceipt: f.receiptId,
  });
  assert.equal(
    (await migrationRows(database, sql`select id from work_type_version where id=${f.reservedId}`))
      .length,
    1,
  );
  await database.execute(sql`delete from organization where id=${f.organizationId}`);
  assert.equal(
    (
      await migrationRows(
        database,
        sql`select id from work_template_copy_entry where id=${f.entryId}`,
      )
    ).length,
    0,
  );
}

async function cleanupReader(): Promise<void> {
  if (readerCreated) {
    await client.unsafe(`DROP OWNED BY "${reader}"`);
    await client.unsafe(`DROP ROLE "${reader}"`);
  }
}
