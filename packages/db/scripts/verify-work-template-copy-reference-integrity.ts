import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import type { Database } from '../src/client';
import { fullSchema } from '../src/client';
import { genId } from '../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../src/migrate-work-templates';
import { prepareBlueprintRetainedFixture } from '../tests/fixtures/work-template-blueprint-migration';
import { migrationRows } from '../src/work-template-blueprint-migration/query';
import { insertCopyReferencingDefinition } from '../tests/fixtures/work-template-copy-reference-integrity';
import {
  copyStorageContext,
  insertCopyStorageFixture,
  seedCopyStorageWorkspace,
  type CopyStorageFixture,
} from '../tests/fixtures/work-template-copy';

const target = process.env['WORK_TEMPLATE_COPY_PG_URL'];
assert.ok(target);
const url = new URL(target);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '16432');
assert.equal(url.pathname, '/athena_identity_test');
const options = { max: 1, prepare: false, onnotice: () => undefined };
const client = postgres(target, options);
const undo = postgres(target, options);
const writer = postgres(target, options);
const database = drizzle(client, { schema: fullSchema });
const organizations: string[] = [];
try {
  if (process.env['WORK_TEMPLATE_COPY_PG_RESET'] === '1') {
    await client.unsafe(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public',
    );
    await prepareBlueprintRetainedFixture(database, {
      migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
      applySqlMigrations: (folder) => migrate(database, { migrationsFolder: folder }),
    });
  }
  const before = await client`select hash,created_at from drizzle.__drizzle_migrations order by id`;
  await migrateWithWorkTemplateCheckpoint(database, {
    migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
    applySqlMigrations: (folder) => migrate(database, { migrationsFolder: folder }),
  });
  const after = await client`select hash,created_at from drizzle.__drizzle_migrations order by id`;
  assert.equal(after.length, 168);
  assert.deepEqual([...after].slice(0, before.length), [...before]);
  await staleSnapshotRace('insert');
  await staleSnapshotRace('renewal');
  await undoFirstRace();
  await lockInversion();
  await eliminationProof();
  await restrictedProof();
  console.log(
    'PASS actual PostgreSQL18 reference epoch: READ COMMITTED insert/renewal commits force stale SERIALIZABLE Undo40001; restricted private usage and pending/receipt metadata.',
  );
} finally {
  await undo.unsafe('ROLLBACK').catch(() => undefined);
  await writer.unsafe('ROLLBACK').catch(() => undefined);
  for (const organizationId of organizations)
    await client`delete from organization where id=${organizationId}`;
  await Promise.all([client.end(), undo.end(), writer.end()]);
}
async function fixture(): Promise<CopyStorageFixture> {
  const workspace = await seedCopyStorageWorkspace(database);
  organizations.push(workspace.organizationId);
  return database.transaction((tx) => insertCopyStorageFixture(tx, workspace));
}
async function staleSnapshotRace(mode: 'insert' | 'renewal'): Promise<void> {
  const f = await fixture();
  const draftId = genId();
  const payload = { kind: 'task', workTypeId: f.destinationId, workTypeVersionId: f.reservedId };
  if (mode === 'renewal')
    await client`insert into composer_draft(id,organization_id,owner_user_id,kind,payload,expires_at) values(${draftId},${f.organizationId},${f.userId},'task',${JSON.stringify(payload)}::text::jsonb,'2000-01-01')`;
  await undo.unsafe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await undo`select id from work_template_copy_bundle where id=${f.bundleId} for update`;
  await writer.unsafe('BEGIN ISOLATION LEVEL READ COMMITTED');
  if (mode === 'insert')
    await writer`insert into composer_draft(id,organization_id,owner_user_id,kind,payload,expires_at) values(${draftId},${f.organizationId},${f.userId},'task',${JSON.stringify(payload)}::text::jsonb,now()+interval '1 day')`;
  else
    await writer`update composer_draft set expires_at=now()+interval '1 day' where id=${draftId}`;
  await writer.unsafe('COMMIT');
  await assert.rejects(
    undo`select id from work_template_copy_entry where bundle_id=${f.bundleId} order by destination_work_type_id,id for update`,
    { code: '40001' },
  );
  await undo.unsafe('ROLLBACK');
  await database.transaction(
    async (tx) => {
      await copyStorageContext(tx, f);
      const [result] = await migrationRows<{ used: boolean }>(
        tx,
        sql`select docket_copy_bundle_member_in_use(${f.organizationId},${f.bundleId},'root') as used`,
      );
      assert.equal(result?.used, true);
    },
    { isolationLevel: 'serializable' },
  );
  const [epoch] = await client<
    { reference_epoch: string }[]
  >`select reference_epoch from work_template_copy_entry where id=${f.entryId}`;
  assert.equal(Number(epoch?.reference_epoch), 1);
}
async function restrictedProof(): Promise<void> {
  const f = await fixture();
  await database.execute(
    sql`insert into composer_draft(id,organization_id,owner_user_id,kind,payload,expires_at) values(${genId()},${f.organizationId},${f.userId},'task',${JSON.stringify({ kind: 'task', workTypeId: f.destinationId, workTypeVersionId: f.reservedId })}::jsonb,now()+interval '1 day')`,
  );
  const role = `copy_refs_${genId().toLowerCase()}`;
  await client.unsafe(
    `CREATE ROLE "${role}" NOLOGIN; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT EXECUTE ON FUNCTION docket_copy_template_in_use(text,text),docket_template_copy_pending_selection(text,text),docket_copy_receipt_registered(text,text),docket_copy_bundle_member_in_use(text,text,text) TO "${role}"`,
  );
  try {
    await database.transaction(async (tx) => {
      await copyStorageContext(tx, f);
      await tx.execute(sql.raw(`SET LOCAL ROLE "${role}"`));
      for (const table of ['plan_draft', 'composer_draft', 'template', 'change_set_entry'])
        await assert.rejects(
          tx.transaction((inner) => inner.execute(sql.raw(`select * from ${table}`))),
          (error: unknown) => sqlState(error) === '42501',
        );
      const [used] = await migrationRows(
        tx,
        sql`select docket_copy_template_in_use(${f.organizationId},${f.destinationId}) as used`,
      );
      assert.deepEqual(used, { used: true });
      const [pending] = await migrationRows(
        tx,
        sql`select * from docket_template_copy_pending_selection(${f.organizationId},${f.destinationId})`,
      );
      assert.deepEqual(pending, {
        reserved_first_version_id: f.reservedId,
        reservation_state: 'pending',
      });
      const [registered] = await migrationRows<{ value: boolean }>(
        tx,
        sql`select docket_copy_receipt_registered(${f.organizationId},${f.receiptId}) as value`,
      );
      assert.equal(registered?.value, true);
      const [unknown] = await migrationRows<{ value: boolean }>(
        tx,
        sql`select docket_copy_receipt_registered(${f.organizationId},${genId()}) as value`,
      );
      assert.equal(unknown?.value, false);
      await assert.rejects(
        tx.transaction((inner) =>
          inner.execute(
            sql`select docket_copy_reference_exists(${f.organizationId},${f.destinationId})`,
          ),
        ),
        (error: unknown) => sqlState(error) === '42501',
      );
    });
    await restrictedViewer(f, role);
  } finally {
    await client.unsafe(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
  }
}

function sqlState(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error) return error.code;
  return 'cause' in error ? sqlState(error.cause) : undefined;
}

async function waitForLock(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await client<
      { wait_event_type: string | null }[]
    >`select wait_event_type from pg_stat_activity where pid=${pid}`;
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Expected an actual PostgreSQL row-lock wait');
}
async function undoFirstRace(): Promise<void> {
  const f = await fixture(),
    draftId = genId();
  const payload = JSON.stringify({
    kind: 'task',
    workTypeId: f.destinationId,
    workTypeVersionId: f.reservedId,
  });
  await undo.unsafe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await undo`select id from work_template_copy_bundle where id=${f.bundleId} for update`;
  await undo`select id from work_template_copy_entry where bundle_id=${f.bundleId} order by destination_work_type_id,id for update`;
  await undo`select id from template where id=${f.destinationId} for no key update`;
  await writer.unsafe('BEGIN ISOLATION LEVEL READ COMMITTED');
  const [backend] = await writer<{ pid: number }[]>`select pg_backend_pid() as pid`;
  const insert =
    writer`insert into composer_draft(id,organization_id,owner_user_id,kind,payload,expires_at) values(${draftId},${f.organizationId},${f.userId},'task',${payload}::text::jsonb,now()+interval '1 day')`.then(
      () => null,
      (error: unknown) => error,
    );
  await waitForLock(Number(backend?.pid));
  await undo`update work_template_copy_entry set reservation_state='void',live_work_type_id=null where id=${f.entryId}`;
  await undo`delete from template where id=${f.destinationId}`;
  const outcomes = JSON.stringify([{ entryKey: 'root', outcome: 'deleted' }]);
  await undo`update work_template_copy_bundle set state='undone',undone_at=now(),undo_outcomes=${outcomes}::text::jsonb where id=${f.bundleId}`;
  await undo.unsafe('COMMIT');
  assert.equal(sqlState(await insert), '23503');
  await writer.unsafe('ROLLBACK');
  assert.equal((await client`select id from composer_draft where id=${draftId}`).length, 0);
  assert.equal((await client`select id from template where id=${f.destinationId}`).length, 0);
}
async function lockInversion(): Promise<void> {
  const f = await fixture(),
    sourceId = genId();
  await client`insert into template(id,organization_id,target_type,name,scope,owner_actor_id,payload,draft_definition) values(${sourceId},${f.organizationId},'task','Source','personal',${f.actorId},'{"targetType":"task"}','{"name":"Source","payload":{"targetType":"task"}}')`;
  await writer.unsafe('BEGIN ISOLATION LEVEL READ COMMITTED');
  await writer.unsafe("SET LOCAL deadlock_timeout='30ms'");
  await writer`select id from template where id=${sourceId} for update`;
  await undo.unsafe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await undo.unsafe("SET LOCAL deadlock_timeout='10s'");
  await undo`select id from work_template_copy_bundle where id=${f.bundleId} for update`;
  await undo`select id from work_template_copy_entry where bundle_id=${f.bundleId} order by destination_work_type_id,id for update`;
  const [backend] = await writer<{ pid: number }[]>`select pg_backend_pid() as pid`;
  const document = JSON.stringify({
    name: 'Source',
    payload: { targetType: 'task' },
    blueprint: {
      steps: [
        {
          key: 'child',
          kind: 'task',
          template: {
            workTypeId: f.destinationId,
            selection: { kind: 'pinned', workTypeVersionId: f.reservedId },
          },
        },
      ],
      dependencies: [],
    },
  });
  const edit =
    writer`update template set draft_definition=${document}::text::jsonb where id=${sourceId}`.then(
      () => null,
      (error: unknown) => error,
    );
  await waitForLock(Number(backend?.pid));
  const lock = undo`select id from template where id=${sourceId} for no key update`.then(
    () => null,
    (error: unknown) => error,
  );
  assert.equal(sqlState(await edit), '40P01');
  assert.equal(await lock, null);
  await writer.unsafe('ROLLBACK');
  await undo.unsafe('ROLLBACK');
  await writer.unsafe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await writer`update template set draft_definition=${document}::text::jsonb where id=${sourceId}`;
  await writer.unsafe('COMMIT');
  const [epoch] = await client<
    { reference_epoch: string }[]
  >`select reference_epoch from work_template_copy_entry where id=${f.entryId}`;
  assert.equal(Number(epoch?.reference_epoch), 1);
}

async function restrictedViewer(f: CopyStorageFixture, role: string): Promise<void> {
  await database.execute(
    sql`update "grant" set capabilities='["view"]' where organization_id=${f.organizationId}`,
  );
  await database.transaction(async (tx) => {
    await copyStorageContext(tx, f);
    await tx.execute(sql.raw(`SET LOCAL ROLE "${role}"`));
    assert.equal(
      (
        await migrationRows(
          tx,
          sql`select * from docket_template_copy_pending_selection(${f.organizationId},${f.destinationId})`,
        )
      ).length,
      1,
    );
    await assert.rejects(
      tx.transaction((inner) =>
        inner.execute(
          sql`select docket_copy_bundle_member_in_use(${f.organizationId},${f.bundleId},'root')`,
        ),
      ),
      (e: unknown) => sqlState(e) === '42501',
    );
    await assert.rejects(
      tx.transaction((inner) =>
        inner.execute(
          sql`select docket_change_set_has_copy_bundle(${f.organizationId},${f.receiptId})`,
        ),
      ),
      (e: unknown) => sqlState(e) === '42501',
    );
  });
  const foreign = await seedCopyStorageWorkspace(database);
  organizations.push(foreign.organizationId);
  await database.transaction(async (tx) => {
    await copyStorageContext(tx, foreign);
    await tx.execute(sql.raw(`SET LOCAL ROLE "${role}"`));
    const [registered] = await migrationRows(
      tx,
      sql`select docket_copy_receipt_registered(${foreign.organizationId},${f.receiptId}) as registered`,
    );
    assert.deepEqual(registered, { registered: false });
    await assert.rejects(
      tx.transaction((inner) =>
        inner.execute(
          sql`select * from docket_template_copy_pending_selection(${foreign.organizationId},${f.destinationId})`,
        ),
      ),
      (e: unknown) => sqlState(e) === '42501',
    );
  });
  await assert.rejects(
    database.execute(
      sql`update work_template_copy_entry set reference_epoch=reference_epoch+1 where id=${f.entryId}`,
    ),
    (e: unknown) => sqlState(e) === '42501',
  );
}
async function eliminationProof(): Promise<void> {
  const f = await fixture();
  const parent = await insertCopyReferencingDefinition(database, f);
  const eliminate = async (tx: Database): Promise<void> => {
    await copyStorageContext(tx, f);
    await tx.execute(
      sql`select id from work_template_copy_entry where bundle_id=${f.bundleId} order by destination_work_type_id,id for update`,
    );
    const [before] = await migrationRows(
      tx,
      sql`select docket_copy_bundle_member_in_use(${f.organizationId},${f.bundleId},'root') as used`,
    );
    assert.deepEqual(before, { used: true });
    await tx.execute(sql`delete from template where id=${parent}`);
    const [after] = await migrationRows(
      tx,
      sql`select docket_copy_bundle_member_in_use(${f.organizationId},${f.bundleId},'root') as used`,
    );
    assert.deepEqual(after, { used: false });
    await tx.execute(
      sql`update work_template_copy_entry set reservation_state='void',live_work_type_id=null where id=${f.entryId}`,
    );
    await tx.execute(sql`delete from template where id=${f.destinationId}`);
    await tx.execute(
      sql`update work_template_copy_bundle set state='undone',undone_at=now(),undo_outcomes='[{"entryKey":"root","outcome":"deleted"}]' where id=${f.bundleId}`,
    );
  };
  await assert.rejects(
    database.transaction(
      async (tx) => {
        await eliminate(tx);
        throw new Error('Rollback all tentative removals');
      },
      { isolationLevel: 'serializable' },
    ),
    /Rollback all/,
  );
  assert.equal(
    (await client`select id from template where id in (${parent},${f.destinationId})`).length,
    2,
  );
  await database.transaction((tx) => eliminate(tx), { isolationLevel: 'serializable' });
  assert.equal(
    (await client`select id from template where id in (${parent},${f.destinationId})`).length,
    0,
  );
}
