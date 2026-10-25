import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillScheduleHistoryImports } from '../../src/work-schedule-history-import';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintFixtureMigration,
  type BlueprintRetainedFixture,
} from './work-template-blueprint-migration';

/** Build a populated predecessor, including terminal original work, without running the new checkpoint. */
export async function prepareHistoryImportPredecessor(
  database: Database,
  options: BlueprintFixtureMigration,
): Promise<BlueprintRetainedFixture> {
  const fixture = await prepareBlueprintRetainedFixture(database, options);
  await database.execute(
    sql`update process_instance set status='completed',completed_at='2026-10-21' where revision_id=${fixture.forestRevisionId}`,
  );
  await database.execute(
    sql`update process_occurrence set status='completed' where id in(select occurrence_id from process_instance where revision_id=${fixture.forestRevisionId})`,
  );
  await withMigrationPrefix(
    options.migrationsFolder,
    '0167_work_template_copy_reference_integrity',
    (folder) =>
      migrateWithWorkTemplateCheckpoint(database, { ...options, migrationsFolder: folder }),
  );
  return fixture;
}
/** Insert an exact unbound original instance with oversized private tombstones; origins remain unknown. */
export async function addOversizedHistory(
  database: Database,
  fixture: BlueprintRetainedFixture,
  id = genId(),
): Promise<string> {
  const instance = genId();
  await database.execute(
    sql`insert into process_instance(id,organization_id,definition_id,revision_id,status,created_by) select ${instance},organization_id,definition_id,id,'completed',null from process_revision where id=${fixture.forestRevisionId}`,
  );
  await database.execute(sql`
    insert into process_occurrence(id,organization_id,scheduled_for,run_kind,legacy_instance_id,status,blueprint_invocation_id,historical_archive,historical_archive_hash)
    select ${id},i.organization_id,'2001-01-01','historical',i.id,'completed',v.invocation_id,a.archive,docket_schedule_fingerprint(a.archive)
    from process_instance i join work_template_invocation_revision v on v.id=i.revision_id and v.organization_id=i.organization_id
    cross join lateral (select jsonb_build_object('revision',1,'instance',to_jsonb(i),'references',(
      select jsonb_agg(jsonb_build_object('kind','task','workId','deleted-' || position,'deleted',true) order by position) from generate_series(1,601) position)) as archive) a
    where i.id=${instance}`);
  return id;
}
async function originalFacts(database: Database): Promise<unknown> {
  return migrationRows(
    database,
    sql`
    select 'occurrence' as kind,id,to_jsonb(o)-'imported_history_receipt'-'imported_history_receipt_hash'-'history_import_review' as fact from process_occurrence o
    union all select 'conversion',legacy_process_revision_id,to_jsonb(c) from work_template_blueprint_conversion c
    union all select 'instance',id,to_jsonb(i) from process_instance i
    union all select 'task',id,to_jsonb(t) from task t
    union all select 'project',id,to_jsonb(p) from project p
    union all select 'milestone',id,to_jsonb(m) from milestone m order by kind,id`,
  );
}
/** Prove after-commit interruption, complete oversized paging, immutable facts and safe repeated retry. */
export async function exerciseHistoryImportCheckpoint(
  database: Database,
  options: BlueprintFixtureMigration,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  await options.applySqlMigrations(options.migrationsFolder);
  await addOversizedHistory(database, fixture);
  const before = await originalFacts(database);
  const stopped = new Error('Observer stopped after committed history');
  await assert.rejects(
    backfillScheduleHistoryImports(database, {
      batchSize: 1,
      onScheduleHistoryImportBatch: async (progress) => {
        assert.equal(progress.prepared, 1);
        const [committed] = await migrationRows<{ count: number }>(
          database,
          sql`select count(*)::integer as count from process_occurrence where imported_history_receipt is not null`,
        );
        assert.equal(committed?.count, 1);
        throw stopped;
      },
    }),
    (error) => error === stopped,
  );
  assert.deepEqual(await originalFacts(database), before);
  assert.deepEqual(await backfillScheduleHistoryImports(database, { batchSize: 1 }), {
    prepared: 1,
    deferred: 0,
  });
  const rows = await migrationRows<{
    receipt: {
      referenceCount: number;
      execution: string;
      continuation: string;
      reviewIssueCount: number;
    };
    accepted: unknown;
    creator: unknown;
  }>(
    database,
    sql`select imported_history_receipt as receipt,accepted_claim as accepted,created_by as creator from process_occurrence order by id`,
  );
  assert.deepEqual(
    rows.map((row) => row.receipt.referenceCount).sort((a, b) => a - b),
    [3, 601],
  );
  for (const row of rows) {
    assert.equal(row.receipt.execution, 'nonexecuting');
    assert.equal(row.receipt.continuation, 'never');
    assert.equal(row.accepted, null);
    assert.ok(row.receipt.reviewIssueCount > 0);
  }
  assert.deepEqual(await backfillScheduleHistoryImports(database), { prepared: 0, deferred: 0 });
  assert.deepEqual(await originalFacts(database), before);
  console.log(
    'PASS committed interruption/resume,601 references, unknown origins, no work/authority/continuation writes',
  );
}
