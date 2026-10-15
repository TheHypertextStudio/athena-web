import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { genId } from '../src/id';
import { fullSchema } from '../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../src/migrate-work-templates';
import {
  backfillWorkScheduleArchives,
  verifyWorkScheduleArchives,
} from '../src/work-schedule-archive';
import { prepareBlueprintRetainedFixture } from '../tests/fixtures/work-template-blueprint-migration';
import {
  exerciseSchedulePrivacy,
  exerciseOwnedSchedulePrivacy,
} from '../tests/fixtures/work-schedule-privacy';
import { exerciseScheduleClaims } from '../tests/fixtures/work-schedule-storage';
import { exerciseRetainedSchedulePrivacy } from '../tests/fixtures/work-schedule-retained-privacy';
import { exerciseNativeScheduleDates } from '../tests/fixtures/work-schedule-native-dates';

const url = process.env['WORK_SCHEDULE_PG_URL'];
assert.ok(url, 'Set WORK_SCHEDULE_PG_URL to the task-owned PostgreSQL18 database.');
const target = new URL(url);
assert.ok(
  target.hostname === '127.0.0.1' &&
    target.port === '16432' &&
    target.pathname === '/athena_identity_test',
  'Only the task-owned loopback16432/athena_identity_test may be reset.',
);
const client = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
const database = drizzle(client, { schema: fullSchema });
const folder = resolve(import.meta.dirname, '../drizzle');
const options = {
  migrationsFolder: folder,
  applySqlMigrations: (path: string) => migrate(database, { migrationsFolder: path }),
};
async function expandIfUnjournaled(): Promise<void> {
  const journal = JSON.parse(await readFile(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const migration of [
    '0160_schedule_invocation_heads_expand',
    '0161_schedule_private_scope',
    '0163_schedule_retained_privacy',
  ]) {
    if (journal.entries.some((entry) => entry.tag === migration)) continue;
    const expansion = await readFile(resolve(folder, `${migration}.sql`), 'utf8');
    for (const statement of expansion.split('--> statement-breakpoint'))
      if (statement.trim()) await client.unsafe(statement);
  }
}
async function reset(): Promise<void> {
  await client.unsafe(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public',
  );
}
try {
  await reset();
  await migrateWithWorkTemplateCheckpoint(database, options);
  await expandIfUnjournaled();
  const completeJournal = JSON.parse(
    await readFile(resolve(folder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  const [applied] =
    await client`select count(*)::integer as count from drizzle.__drizzle_migrations`;
  assert.equal(applied?.['count'], completeJournal.entries.length);
  console.log(`PASS exact migration journal cardinality: ${completeJournal.entries.length}`);
  await backfillWorkScheduleArchives(database);
  console.log('PASS fresh complete journal + canonical expansion');
  await reset();
  const fixture = await prepareBlueprintRetainedFixture(database, options);
  const historical = genId();
  await client`insert into process_instance(id,organization_id,definition_id,revision_id,status,triggered_at,completed_at,created_by) select ${historical},organization_id,definition_id,id,'completed','2001-01-01'::timestamp,'2001-01-02'::timestamp,null from process_revision where id=${fixture.forestRevisionId}`;
  const journal = JSON.parse(await readFile(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const journaled = journal.entries.some(
    (entry) => entry.tag === '0160_schedule_invocation_heads_expand',
  );
  if (journaled)
    await assert.rejects(
      migrateWithWorkTemplateCheckpoint(database, {
        ...options,
        batchSize: 1,
        onScheduleArchiveBatch: () => {
          throw new Error('interrupted after commit');
        },
      }),
      /interrupted after commit/,
    );
  else await migrateWithWorkTemplateCheckpoint(database, options);
  await expandIfUnjournaled();
  const original =
    await client`select c.legacy_process_revision_id,c.source_fingerprint,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`;
  if (!journaled)
    await assert.rejects(
      backfillWorkScheduleArchives(database, {
        batchSize: 1,
        onScheduleArchiveBatch: () => {
          throw new Error('interrupted after commit');
        },
      }),
      /interrupted after commit/,
    );
  await backfillWorkScheduleArchives(database, { batchSize: 1 });
  await verifyWorkScheduleArchives(database);
  const after =
    await client`select c.legacy_process_revision_id,c.source_fingerprint,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`;
  assert.deepEqual(after, original);
  await exerciseScheduleClaims(database, fixture);
  await exerciseNativeScheduleDates(database, fixture);
  const [receipt] =
    await client`select run_kind,series_id,series_revision_id,created_by,blueprint_invocation_id,status::text from process_occurrence where legacy_instance_id=${historical}`;
  assert.ok(
    receipt?.['run_kind'] === 'historical' &&
      receipt['series_id'] === null &&
      receipt['series_revision_id'] === null &&
      receipt['created_by'] === null &&
      receipt['blueprint_invocation_id'] !== null &&
      receipt['status'] === 'completed',
  );
  await exerciseSchedulePrivacy(database, fixture);
  await exerciseOwnedSchedulePrivacy(database, fixture);
  await exerciseRetainedSchedulePrivacy(database, fixture);
  await client`update process_definition set description='Mutation after committed archival' where id=(select definition_id from process_revision where id=${fixture.forestRevisionId})`;
  await assert.rejects(verifyWorkScheduleArchives(database), /stale/);
  console.log(
    'PASS populated upgrade, interrupted/resumed archives, unchanged invocation JSON/fingerprint, immutable claims/fallback, failure/retry CAS, source-mutation refusal',
  );
} finally {
  await client.end();
}
