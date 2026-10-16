import { afterAll, beforeAll, expect, it } from 'vitest';
import postgres from 'postgres';
import { db, closeDb, genId, setDatabaseQueryObserver } from '@docket/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { editWorkTemplateDraft } from '../../src/lib/templates/service';
import {
  seedCopyStorageWorkspace,
  insertCopyStorageFixture,
} from './work-template-copy-reference-fixture';
import { copyReferenceDefinition } from './work-template-copy-reference-documents';

const target = process.env['WORK_TEMPLATE_COPY_PG_URL'] ?? '';
const control = postgres(target, { max: 1, prepare: false, onnotice: () => undefined });
const undo = postgres(target, { max: 1, prepare: false, onnotice: () => undefined });
const tenants: string[] = [];
beforeAll(() => {
  const url = new URL(target);
  expect([url.hostname, url.port, url.pathname]).toEqual([
    '127.0.0.1',
    '16432',
    '/athena_identity_test',
  ]);
  expect(process.env['DATABASE_URL']).toBe(target);
});
afterAll(async () => {
  setDatabaseQueryObserver(undefined);
  await undo.unsafe('ROLLBACK');
  for (const id of tenants) await control`delete from organization where id=${id}`;
  await closeDb();
  await Promise.all([control.end(), undo.end()]);
});
it('retries actual canonical draft edit after a source-row/entry-lock deadlock without duplicate revisions', async () => {
  const workspace = await seedCopyStorageWorkspace(db);
  tenants.push(workspace.organizationId);
  const f = await db.transaction((tx) => insertCopyStorageFixture(tx, workspace));
  const sourceId = genId();
  await control`insert into template(id,organization_id,target_type,name,scope,owner_actor_id,payload,draft_definition) values(${sourceId},${f.organizationId},'task','Source','personal',${f.actorId},'{"targetType":"task"}','{"name":"Source","payload":{"targetType":"task"}}')`;
  await undo.unsafe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await undo.unsafe("SET LOCAL deadlock_timeout='10s'");
  await undo`select id from work_template_copy_bundle where id=${f.bundleId} for update`;
  await undo`select id from work_template_copy_entry where bundle_id=${f.bundleId} order by destination_work_type_id,id for update`;
  const [backend] = await undo<{ pid: number }[]>`select pg_backend_pid() as pid`;
  let updates = 0;
  setDatabaseQueryObserver((query, params) => {
    if (query.startsWith('update "template"') && params.includes(sourceId)) updates++;
  });
  const edit = editWorkTemplateDraft({ orgId: f.organizationId, actorId: f.actorId }, sourceId, {
    expectedRevision: 0,
    definition: copyReferenceDefinition(f),
  });
  await waitForBlockedEditor(Number(backend?.pid));
  await undo`select id from template where id=${sourceId} for no key update`;
  await undo.unsafe('COMMIT');
  const updated = await edit;
  expect(updated.draftRevision).toBe(1);
  expect(updates).toBe(2);
  const [epoch] = await control<
    { reference_epoch: string }[]
  >`select reference_epoch from work_template_copy_entry where id=${f.entryId}`;
  expect(Number(epoch?.reference_epoch)).toBe(1);
  const rows: unknown = await db.execute(
    sql`select draft_revision from template where id=${sourceId}`,
  );
  expect(z.array(z.object({ draft_revision: z.number() })).parse(rows)[0]?.draft_revision).toBe(1);
});
async function waitForBlockedEditor(undoPid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const rows =
      await control`select pid from pg_stat_activity where wait_event_type='Lock' and ${undoPid}=any(pg_blocking_pids(pid))`;
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Canonical editor did not reach the actual entry row lock');
}
